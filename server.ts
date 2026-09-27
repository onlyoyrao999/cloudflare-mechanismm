import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { analyzeData, predictNextDraw } from "./src/data/analyzer.js";
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const PORT = 3000;

// Persistent file storage paths (Simulating Cloudflare KV persistent space)
const kvSpaceFilePath = path.resolve("src/data/kv_space.json");
const historyFilePath = path.resolve("src/data/history.json");
const timestampPath = path.resolve("src/data/last_check.txt");

interface KVPredictionEntry {
  basePeriod: string;
  targetPeriod: string;
  predictedNumbers: number[];
  activeTargets?: any[];
  reasoning: {
    triggerLocking: string;
    edgeDeduction: string;
    omissionConclusion: string;
  };
  isAIPowered: boolean;
  status: "pending" | "verified";
  createdAt: number;
  actualNumbers?: number[];
  isSuccessful?: boolean;
  hitNumbers?: number[];
}

interface KVStore {
  predictions: Record<string, KVPredictionEntry>;
}

// Read KV Store
function getKVStore(): KVStore {
  try {
    if (fs.existsSync(kvSpaceFilePath)) {
      const data = fs.readFileSync(kvSpaceFilePath, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error reading kv_space.json:", error);
  }
  return { predictions: {} };
}

// Write to KV Store
function saveKVStore(store: KVStore) {
  try {
    const dir = path.dirname(kvSpaceFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(kvSpaceFilePath, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    console.error("Error saving kv_space.json:", error);
  }
}

// Retrieve persistent prediction for a specific target period
function getKVPrediction(targetPeriod: string): KVPredictionEntry | null {
  const store = getKVStore();
  const entry = store.predictions[targetPeriod];
  if (entry && Array.isArray(entry.predictedNumbers) && entry.predictedNumbers.length === 6) {
    return entry;
  }
  return null;
}

// Lock and save prediction into KV Space
function saveKVPrediction(targetPeriod: string, entry: KVPredictionEntry) {
  const store = getKVStore();
  store.predictions[targetPeriod] = entry;
  saveKVStore(store);
}

// Sync KV predictions with newly drawn records
function syncKVVerifications(rawRecords: { period: string; numbers: number[] }[]) {
  const store = getKVStore();
  let updated = false;

  for (const record of rawRecords) {
    const period = record.period;
    const entry = store.predictions[period];
    if (entry && entry.status === "pending") {
      const actualNumbers = record.numbers;
      const hitNumbers = entry.predictedNumbers.filter(n => actualNumbers.includes(n));
      entry.actualNumbers = actualNumbers;
      entry.hitNumbers = hitNumbers;
      entry.isSuccessful = hitNumbers.length === 0;
      entry.status = "verified";
      updated = true;
      console.log(`[KV Space] Verified period ${period}: ${entry.isSuccessful ? "SUCCESS (0 hits)" : `MISS (${hitNumbers.join(",")})`}`);
    }
  }

  if (updated) {
    saveKVStore(store);
  }
}

app.use(express.json());

function getRecords(): { period: string; numbers: number[] }[] {
  try {
    if (fs.existsSync(historyFilePath)) {
      const data = fs.readFileSync(historyFilePath, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error reading history file:", error);
  }
  return [];
}

function saveRecords(records: { period: string; numbers: number[] }[]) {
  try {
    const dir = path.dirname(historyFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(historyFilePath, JSON.stringify(records, null, 2), "utf8");
  } catch (error) {
    console.error("Error saving history file:", error);
  }
}

// Scraping function for live lottery results
async function scrapeLatest() {
  try {
    const url = "https://macaujc.ddcdn.cloudns.org/";
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const text = await res.text();
    const lines = text.split("\n");
    const recordsMap = new Map<string, number[]>();

    const existing = getRecords();
    for (const r of existing) {
      recordsMap.set(r.period, r.numbers);
    }

    let addedCount = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^(\d+):\s*\[(.*?)\]/);
      if (match) {
        const period = match[1];
        const numsStr = match[2];
        const numbers = numsStr
          .split(",")
          .map(n => parseInt(n.trim(), 10))
          .filter(n => !isNaN(n));
        if (numbers.length > 0) {
          if (!recordsMap.has(period)) {
            addedCount++;
          }
          recordsMap.set(period, numbers);
        }
      }
    }

    const mergedList = Array.from(recordsMap.entries()).map(([period, numbers]) => ({
      period,
      numbers,
    }));
    mergedList.sort((a, b) => b.period.localeCompare(a.period));
    saveRecords(mergedList);

    // Verify any pending predictions in KV Space
    syncKVVerifications(mergedList);

    return {
      success: true,
      count: mergedList.length,
      message:
        addedCount > 0
          ? `Successfully integrated ${addedCount} new drawing records.`
          : "Data is already up to date.",
    };
  } catch (err: any) {
    console.error("Background scrape failed:", err);
    return {
      success: false,
      count: 0,
      message: `Failed to fetch live data: ${err.message}. Showing cached results.`,
    };
  }
}

// AI Prediction Generator with Gemini Model Fallbacks
async function getAIPrediction(
  rawRecords: { period: string; numbers: number[] }[],
  triggers: any[],
  lastPredictions: number[]
) {
  const latestDraw = rawRecords[0];
  const mathPredict = predictNextDraw(rawRecords, triggers, lastPredictions);
  const activeTargets = mathPredict.activeTargets;
  const activeNumbers = activeTargets.map((t: any) => t.number);

  if (!process.env.GEMINI_API_KEY) {
    console.log("No GEMINI_API_KEY. Using mathematical fallback prediction.");
    return {
      ...mathPredict,
      isAIPowered: false,
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        apiVersion: "v1",
        headers: { "User-Agent": "aistudio-build" },
      },
    });

    const recordsText = rawRecords
      .slice(0, 165)
      .map(r => `${r.period}: [${r.numbers.join(",")}]`)
      .join("\n");

    const nextPeriodNum = parseInt(latestDraw.period, 10) + 1;

    const prompt = `您是一位高等概率论专家和赛马彩票混沌学学者。
现在我们将向您提供澳门赛马会最近的 165 期开奖历史数据。每一期包含 7 个开奖号码（范围从 01 到 49）。

【重要分析理论与对冲规则】：
1. 隔期同号轨迹（Hedge 对冲防线）：当前有些号码正处于活跃的轨迹追逐周期中。这些号码在接下来的开奖中出现概率极大。
   - 处于追逐周期中的活跃目标号：[${activeNumbers.join(", ")}]
   - ⚠️【绝对禁区】：在您预测的“不可能开出的6个号码”中，**绝对不能**包含这几个活跃目标号码！因为它们随时可能反弹回补。

2. 防止推荐重复（上一期排除重合限制）：
   - 上一期已排除的6个号码是：[${lastPredictions.join(", ")}]
   - ⚠️【限制】：确保本期的预测名单与上一期的 [${lastPredictions.join(", ")}] 不完全相同，让排除名单具有周期时效变化。

3. 遗漏与冷热对冲：
   - 您应该评估 49 码的总体出现频次、近期遗漏周期，并结合混沌理论推演下一期（第 ${nextPeriodNum} 期）最不可能出现的 6 个号码。
   - 重点考虑长期极端冷态、出现频次极低、或者近期遗漏处于极值不符合反弹走势的号码。

以下是前面165期开奖数据（最新期在最上面）：
${recordsText}

请在进行高精度数理逻辑推演后，计算出下一期最不可能出现的6个号码（范围为 1 到 49，必须是 6 个互不相同的整数，按升序排列）。

您必须返回符合以下 JSON 结构的预测：
{
  "predictedNumbers": [number, number, number, number, number, number],
  "reasoning": {
    "triggerLocking": "根据隔期特征，讨论排除名单中对当前活跃追踪目标号 [${activeNumbers.join(", ")}] 执行的安全加锁与防反弹屏障过程，使用极具专业度的中文描绘",
    "edgeDeduction": "详细阐释首尾边缘环形运算下对高回补落点的绕道对冲策略，使用极具专业度的中文描绘",
    "omissionConclusion": "结合165期大盘冷态指标及遗漏波峰，全面推导论述此 6 个号码不可能出现的必然逻辑，使用极具专业度的中文描绘"
  }
}`;

    console.log("Requesting Gemini AI prediction...");
    const candidateModels = ["gemini-2.5-flash", "gemini-3.8-flash"];
    let responseText = "";

    for (const model of candidateModels) {
      try {
        console.log(`Attempting prediction with model: ${model}`);
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                predictedNumbers: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
                  description: "6 unique numbers from 1 to 49 that are least likely to appear",
                },
                reasoning: {
                  type: Type.OBJECT,
                  properties: {
                    triggerLocking: { type: Type.STRING },
                    edgeDeduction: { type: Type.STRING },
                    omissionConclusion: { type: Type.STRING },
                  },
                  required: ["triggerLocking", "edgeDeduction", "omissionConclusion"],
                },
              },
              required: ["predictedNumbers", "reasoning"],
            },
          },
        });
        if (response.text) {
          responseText = response.text;
          break;
        }
      } catch (modelErr: any) {
        console.warn(`Model ${model} failed (${modelErr.message}), trying next candidate...`);
      }
    }

    if (!responseText) {
      throw new Error("All Gemini model candidates failed to generate prediction.");
    }

    const body = JSON.parse(responseText.trim());
    let predicted = (body.predictedNumbers || [])
      .map((n: any) => parseInt(n, 10))
      .filter((n: number) => !isNaN(n) && n >= 1 && n <= 49);

    predicted = Array.from(new Set(predicted)).slice(0, 6);

    if (predicted.length !== 6) {
      console.error("Gemini generated invalid prediction length:", predicted);
      return { ...mathPredict, isAIPowered: false };
    }

    predicted.sort((a: number, b: number) => a - b);

    // Safeguard: Ensure no active targets appear in exclusion list
    const safePrediction: number[] = [];
    for (const num of predicted) {
      if (activeNumbers.includes(num)) {
        for (const replacement of mathPredict.predictedNumbers) {
          if (
            !predicted.includes(replacement) &&
            !activeNumbers.includes(replacement) &&
            !safePrediction.includes(replacement)
          ) {
            safePrediction.push(replacement);
            break;
          }
        }
      } else {
        safePrediction.push(num);
      }
    }

    while (safePrediction.length < 6) {
      for (const replacement of mathPredict.predictedNumbers) {
        if (!safePrediction.includes(replacement) && !activeNumbers.includes(replacement)) {
          safePrediction.push(replacement);
          break;
        }
      }
    }

    safePrediction.sort((a, b) => a - b);

    return {
      predictedNumbers: safePrediction,
      activeTargets,
      reasoning: {
        triggerLocking: body.reasoning.triggerLocking || mathPredict.reasoning.triggerLocking,
        edgeDeduction: body.reasoning.edgeDeduction || mathPredict.reasoning.edgeDeduction,
        omissionConclusion:
          body.reasoning.omissionConclusion || mathPredict.reasoning.omissionConclusion,
      },
      isAIPowered: true,
    };
  } catch (err: any) {
    console.error("Gemini prediction generation failed, gracefully falling back to math model:", err);
    return { ...mathPredict, isAIPowered: false };
  }
}

// API endpoint: /api/analyze
app.get("/api/analyze", async (req, res) => {
  // Check if we need passive background scrape
  let shouldCheck = false;
  if (!fs.existsSync(timestampPath)) {
    shouldCheck = true;
  } else {
    try {
      const lastCheckTime = parseInt(fs.readFileSync(timestampPath, "utf8").trim(), 10);
      if (isNaN(lastCheckTime) || Date.now() - lastCheckTime > 5 * 60 * 1000) {
        shouldCheck = true;
      }
    } catch {
      shouldCheck = true;
    }
  }

  if (shouldCheck) {
    try {
      fs.writeFileSync(timestampPath, Date.now().toString(), "utf8");
      console.log("Passively refreshing lottery drawings check...");
      await scrapeLatest();
    } catch (e) {
      console.error("Passive scrape error:", e);
    }
  }

  const rawRecords = getRecords();
  if (rawRecords.length === 0) {
    return res.status(500).json({ status: "error", message: "No records available." });
  }

  const analysis = analyzeData(rawRecords);
  const lastPredictions =
    analysis.predictions.length > 0
      ? analysis.predictions[analysis.predictions.length - 1].predictedNumbers
      : [];

  const currentPeriod = rawRecords[0]?.period || "";
  const nextPeriod = (parseInt(currentPeriod, 10) + 1).toString();

  // 1. Check if the prediction for target period (nextPeriod) is ALREADY LOCKED in KV Space
  let kvEntry = getKVPrediction(nextPeriod);
  let prediction: any;

  if (kvEntry) {
    console.log(`[KV Space] Using persistent locked prediction for target period ${nextPeriod}`);
    prediction = {
      predictedNumbers: kvEntry.predictedNumbers,
      activeTargets: kvEntry.activeTargets || [],
      reasoning: kvEntry.reasoning,
      isAIPowered: kvEntry.isAIPowered,
    };
  } else {
    // 2. If not yet in KV Space, analyze and IMMEDIATELY lock into KV Space
    console.log(`[KV Space] Generating and locking new prediction for target period ${nextPeriod}...`);
    prediction = await getAIPrediction(rawRecords, analysis.triggers, lastPredictions);

    saveKVPrediction(nextPeriod, {
      basePeriod: currentPeriod,
      targetPeriod: nextPeriod,
      predictedNumbers: prediction.predictedNumbers,
      activeTargets: prediction.activeTargets || [],
      reasoning: prediction.reasoning,
      isAIPowered: prediction.isAIPowered,
      status: "pending",
      createdAt: Date.now(),
    });
  }

  // 3. Merge KV historical predictions with analysis predictions for complete consistency
  const kvStore = getKVStore();
  const mergedPredictions = [...analysis.predictions];

  for (const p of mergedPredictions) {
    const stored = kvStore.predictions[p.period];
    if (stored && stored.predictedNumbers && stored.predictedNumbers.length === 6) {
      p.predictedNumbers = stored.predictedNumbers;
      if (p.actualNumbers) {
        p.hitNumbers = p.predictedNumbers.filter(n => p.actualNumbers.includes(n));
        p.isSuccessful = p.hitNumbers.length === 0;
      }
    }
  }

  res.json({
    latestDraw: rawRecords[0],
    summary: analysis.summary,
    triggers: analysis.triggers.slice(-50),
    predictions: mergedPredictions.slice(-30),
    frequencyStats: analysis.frequencyStats,
    prediction,
    totalCount: rawRecords.length,
  });
});

// API endpoint: /api/refresh (Force refresh from official source)
app.post("/api/refresh", async (req, res) => {
  console.log("Force checking lottery results...");
  const result = await scrapeLatest();
  if (result.success) {
    res.json({ status: "success", message: result.message });
  } else {
    res.status(502).json({ status: "error", message: result.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
