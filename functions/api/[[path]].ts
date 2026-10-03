import { analyzeData, predictNextDraw } from '../../src/data/analyzer.js';
import defaultHistory from '../../src/data/history.json';
import initialKVSpace from '../../src/data/kv_space.json';

interface Env {
  GEMINI_API_KEY?: string;
  LOTTERY_KV?: any;
  macau_lottery_kv?: any;
  PREDICTIONS_KV?: any;
  KV?: any;
}

type PagesFunction<T = any> = (context: {
  request: Request;
  env: T;
  next?: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  data?: Record<string, unknown>;
  waitUntil: (promise: Promise<any>) => void;
  params?: Record<string, string | string[]>;
}) => Promise<Response>;

function getKV(env: Env) {
  return env.LOTTERY_KV || env.macau_lottery_kv || env.PREDICTIONS_KV || (env as any).KV || null;
}

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
  status: 'pending' | 'verified';
  createdAt: number;
  actualNumbers?: number[];
  isSuccessful?: boolean;
  hitNumbers?: number[];
}

interface KVStore {
  predictions: Record<string, KVPredictionEntry>;
}

// In-memory runtime cache
let memoryHistory: any[] | null = null;
let memoryKVStore: KVStore = (initialKVSpace as unknown as KVStore) || { predictions: {} };
let lastScrapeCheck = 0;

// Read Prediction Store from Cloudflare KV
async function getKVStore(env: Env): Promise<KVStore> {
  const kv = getKV(env);
  if (kv) {
    try {
      const stored = await kv.get('KV_PREDICTIONS_STORE', 'json');
      if (stored && typeof stored === 'object' && stored.predictions) {
        memoryKVStore = {
          predictions: {
            ...((initialKVSpace as any)?.predictions || {}),
            ...stored.predictions,
            ...(memoryKVStore?.predictions || {})
          }
        };
        return memoryKVStore;
      }
    } catch (e) {
      console.error('Error reading KV_PREDICTIONS_STORE from KV:', e);
    }
  }

  // Fallback to memory / bundled
  if (!memoryKVStore || !memoryKVStore.predictions) {
    memoryKVStore = (initialKVSpace as unknown as KVStore) || { predictions: {} };
  }
  return memoryKVStore;
}

// Save Prediction Store into Cloudflare KV
async function saveKVStore(store: KVStore, env: Env) {
  memoryKVStore = store;
  const kv = getKV(env);
  if (kv) {
    try {
      await kv.put('KV_PREDICTIONS_STORE', JSON.stringify(store));
    } catch (e) {
      console.error('Error saving KV_PREDICTIONS_STORE to KV:', e);
    }
  }
}

// Retrieve persistent prediction for target period
async function getKVPrediction(targetPeriod: string, env: Env): Promise<KVPredictionEntry | null> {
  const store = await getKVStore(env);
  const entry = store.predictions[targetPeriod];
  if (entry && Array.isArray(entry.predictedNumbers) && entry.predictedNumbers.length === 6) {
    return entry;
  }
  return null;
}

// Lock and save prediction into Cloudflare KV
async function saveKVPrediction(targetPeriod: string, entry: KVPredictionEntry, env: Env) {
  const store = await getKVStore(env);
  store.predictions[targetPeriod] = entry;
  await saveKVStore(store, env);
}

// Sync KV predictions with newly drawn records (auto-verify success/miss)
async function syncKVVerifications(rawRecords: { period: string; numbers: number[] }[], env: Env) {
  const store = await getKVStore(env);
  let updated = false;

  for (const record of rawRecords) {
    const period = record.period;
    const entry = store.predictions[period];
    if (entry && entry.status === 'pending') {
      const actualNumbers = record.numbers;
      const hitNumbers = entry.predictedNumbers.filter(n => actualNumbers.includes(n));
      entry.actualNumbers = actualNumbers;
      entry.hitNumbers = hitNumbers;
      entry.isSuccessful = hitNumbers.length === 0;
      entry.status = 'verified';
      updated = true;
      console.log(`[CF KV Space] Verified period ${period}: ${entry.isSuccessful ? 'SUCCESS (0 hits)' : `MISS (${hitNumbers.join(',')})`}`);
    }
  }

  if (updated) {
    await saveKVStore(store, env);
  }
}

// Get full lottery drawing history (persisted in Cloudflare KV)
async function getRecords(env: Env): Promise<any[]> {
  const kv = getKV(env);
  if (kv) {
    try {
      const stored = await kv.get('LOTTERY_HISTORY', 'json');
      if (stored && Array.isArray(stored) && stored.length >= 50) {
        memoryHistory = stored;
        return stored;
      }
    } catch (e) {
      console.error('Error reading from KV:', e);
    }
  }

  if (memoryHistory && memoryHistory.length >= 50) {
    return memoryHistory;
  }

  // Merge bundled history (375 records) with any partial storage
  const combinedMap = new Map<string, number[]>();

  for (const r of (defaultHistory as any[])) {
    if (r.period && Array.isArray(r.numbers)) {
      combinedMap.set(r.period, r.numbers);
    }
  }

  if (memoryHistory && Array.isArray(memoryHistory)) {
    for (const r of memoryHistory) {
      if (r.period && Array.isArray(r.numbers)) {
        combinedMap.set(r.period, r.numbers);
      }
    }
  }

  if (kv) {
    try {
      const stored = await kv.get('LOTTERY_HISTORY', 'json');
      if (stored && Array.isArray(stored)) {
        for (const r of stored) {
          if (r.period && Array.isArray(r.numbers)) {
            combinedMap.set(r.period, r.numbers);
          }
        }
      }
    } catch (e) {}
  }

  const merged = Array.from(combinedMap.entries()).map(([period, numbers]) => ({
    period,
    numbers
  }));
  merged.sort((a, b) => b.period.localeCompare(a.period));

  memoryHistory = merged;

  if (kv) {
    try {
      await kv.put('LOTTERY_HISTORY', JSON.stringify(merged));
    } catch (e) {
      console.error('Error saving initial records to KV:', e);
    }
  }

  return merged;
}

async function saveRecords(records: any[], env: Env) {
  memoryHistory = records;
  const kv = getKV(env);
  if (kv) {
    try {
      await kv.put('LOTTERY_HISTORY', JSON.stringify(records));
    } catch (e) {
      console.error('Error saving records to KV:', e);
    }
  }
}

// Scrape live drawings from official endpoints
async function scrapeLatest(env: Env): Promise<{ success: boolean; newCount: number; latest?: any }> {
  try {
    const urls = [
      'https://macaujc.ddcdn.cloudns.org/',
      'https://api.macaujc.com/lottery/drawings?limit=50',
      'https://api.macaumarksix.com/history?limit=50',
    ];

    const fetchedRecordsMap = new Map<string, number[]>();

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*'
          },
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('json')) {
            const json: any = await res.json();
            const items = Array.isArray(json) ? json : json.data || json.results || json.draws || json.list;
            if (Array.isArray(items) && items.length > 0) {
              for (const item of items) {
                const period = (item.period || item.issue || item.expect || item.drawNumber || '').toString();
                let rawNumbers = item.numbers || item.openCode || item.balls || item.result;
                if (!period || !rawNumbers) continue;
                let numbers: number[] = [];
                if (Array.isArray(rawNumbers)) {
                  numbers = rawNumbers.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
                } else if (typeof rawNumbers === 'string') {
                  numbers = rawNumbers.split(/[,+\s]+/).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
                }
                if (numbers.length >= 7) {
                  fetchedRecordsMap.set(period, numbers.slice(0, 7));
                }
              }
            }
          } else {
            // Text format e.g. 2026276: [02,21,17,40,11,24,14]
            const text = await res.text();
            const matches = [...text.matchAll(/(\d+):\s*\[(.*?)\]/g)];
            for (const match of matches) {
              const period = match[1];
              const numsStr = match[2];
              const numbers = numsStr
                .split(',')
                .map(n => parseInt(n.trim(), 10))
                .filter(n => !isNaN(n));
              if (period && numbers.length >= 7) {
                fetchedRecordsMap.set(period, numbers.slice(0, 7));
              }
            }
          }

          if (fetchedRecordsMap.size > 0) {
            break;
          }
        }
      } catch (err) {
        // try next url
      }
    }

    const currentRecords = await getRecords(env);
    const existingMap = new Map(currentRecords.map(r => [r.period, r.numbers]));
    let added = 0;

    for (const [period, numbers] of fetchedRecordsMap.entries()) {
      if (!existingMap.has(period)) {
        existingMap.set(period, numbers);
        added++;
      }
    }

    if (added > 0) {
      const sorted = Array.from(existingMap.entries())
        .map(([period, numbers]) => ({ period, numbers }))
        .sort((a, b) => b.period.localeCompare(a.period));

      await saveRecords(sorted, env);
      await syncKVVerifications(sorted, env);
      return { success: true, newCount: added, latest: sorted[0] };
    }

    await syncKVVerifications(currentRecords, env);
    return { success: true, newCount: 0, latest: currentRecords[0] };
  } catch (err) {
    console.error('scrapeLatest error in CF:', err);
    return { success: false, newCount: 0 };
  }
}

// AI Prediction Generator with Gemini Model Fallbacks
async function getAIPrediction(
  rawRecords: any[],
  triggers: any[],
  lastPredictions: number[],
  env: Env
) {
  const mathPredict = predictNextDraw(rawRecords, triggers, lastPredictions);
  const activeTargets = mathPredict.activeTargets;
  const activeNumbers = activeTargets.map((t: any) => t.number);
  const latestDraw = rawRecords[0];

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ...mathPredict, isAIPowered: false };
  }

  try {
    const prompt = `您是一位高等概率论专家和混沌学学者。
现在我们将向您提供最近的 165 期开奖历史数据。每一期包含 7 个开奖号码（范围从 01 到 49）。

【重要分析理论与对冲规则】：
1. 隔期同号轨迹（Hedge 对冲防线）：当前有些号码正处于活跃的轨迹追逐周期中。这些号码在接下来的开奖中出现概率极大。
   当前被锁定的高概率活跃目标号码为：[${activeNumbers.join(', ')}]。
   【严格禁区】：这批活跃目标号【绝对不能】列入本期排除号码名单中！必须作为对冲保护区予以剔除。

2. 环形基准位邻轨分析：
   我们通过历史开奖的基准位进行环形邻轨测算（1 对应 1、2、7；7 对应 6、7、1）。

3. 深度冷态与遗漏峰值过滤：
   在避开活跃号码后，结合全盘号码遗漏值，挑选 6 个处于最冷、深度休眠或严重失衡的号码。

4. 【硬性规则】：
   上一期（第 ${latestDraw.period} 期）刚刚开出的号码为 [${latestDraw.numbers.join(', ')}]。这些号码也不得作为排除推荐。

请严格推导出下一期最不可能出现的 6 个号码，并输出分析原因：
- triggerLocking: 隔期同号追踪加锁与基准位判定的分析
- edgeDeduction: 边缘环形路径跳跃与首尾位推演
- omissionConclusion: 全局冷热扫描与遗漏波峰综合结论

返回必须且只能是符合以下 JSON Schema 的 JSON 对象：
{
  "predictedNumbers": [number, number, number, number, number, number],
  "reasoning": {
    "triggerLocking": "string",
    "edgeDeduction": "string",
    "omissionConclusion": "string"
  }
}`;

    const configs = [
      { version: 'v1', model: 'gemini-2.5-flash' },
      { version: 'v1beta', model: 'gemini-2.5-flash' },
      { version: 'v1beta', model: 'gemini-3.8-flash' }
    ];

    let responseData: any = null;
    for (const cfg of configs) {
      try {
        const url = `https://generativelanguage.googleapis.com/${cfg.version}/models/${cfg.model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  predictedNumbers: {
                    type: 'ARRAY',
                    items: { type: 'INTEGER' }
                  },
                  reasoning: {
                    type: 'OBJECT',
                    properties: {
                      triggerLocking: { type: 'STRING' },
                      edgeDeduction: { type: 'STRING' },
                      omissionConclusion: { type: 'STRING' }
                    },
                    required: ['triggerLocking', 'edgeDeduction', 'omissionConclusion']
                  }
                },
                required: ['predictedNumbers', 'reasoning']
              }
            }
          }),
          signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
          responseData = await response.json();
          break;
        }
      } catch (e: any) {
        console.warn(`Model ${cfg.model} (${cfg.version}) fetch error:`, e.message);
      }
    }

    if (responseData) {
      const candidate = responseData.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed.predictedNumbers) && parsed.predictedNumbers.length === 6) {
          const safePrediction: number[] = [];
          for (const num of parsed.predictedNumbers) {
            if (num >= 1 && num <= 49 && !activeNumbers.includes(num) && !safePrediction.includes(num)) {
              safePrediction.push(num);
            }
          }
          while (safePrediction.length < 6) {
            for (const rep of mathPredict.predictedNumbers) {
              if (!safePrediction.includes(rep) && !activeNumbers.includes(rep)) {
                safePrediction.push(rep);
                break;
              }
            }
          }
          safePrediction.sort((a, b) => a - b);
          return {
            predictedNumbers: safePrediction,
            activeTargets,
            reasoning: parsed.reasoning || mathPredict.reasoning,
            isAIPowered: true
          };
        }
      }
    }
  } catch (e) {
    console.error('Error generating AI prediction in Cloudflare Function:', e);
  }

  return { ...mathPredict, isAIPowered: false };
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (pathname === '/api/analyze' || pathname === '/api/analyze/') {
    const now = Date.now();
    if (now - lastScrapeCheck > 5 * 60 * 1000) {
      lastScrapeCheck = now;
      context.waitUntil(scrapeLatest(env));
    }

    const rawRecords = await getRecords(env);
    if (!rawRecords || rawRecords.length === 0) {
      return new Response(JSON.stringify({ error: 'No lottery data available' }), {
        status: 500,
        headers: corsHeaders
      });
    }

    // Verify any pending predictions in KV Space against latest drawn numbers
    await syncKVVerifications(rawRecords, env);

    const analysis = analyzeData(rawRecords);
    const lastPredictions = analysis.predictions.length > 0
      ? analysis.predictions[analysis.predictions.length - 1].predictedNumbers
      : [];

    const currentPeriod = rawRecords[0]?.period || '';
    const nextPeriod = (parseInt(currentPeriod, 10) + 1).toString();

    // 1. Check if prediction for target period (nextPeriod) is ALREADY LOCKED in KV Space
    let kvEntry = await getKVPrediction(nextPeriod, env);
    let prediction: any;

    if (kvEntry) {
      prediction = {
        predictedNumbers: kvEntry.predictedNumbers,
        activeTargets: kvEntry.activeTargets || [],
        reasoning: kvEntry.reasoning,
        isAIPowered: kvEntry.isAIPowered,
      };
    } else {
      // 2. Generate and IMMEDIATELY lock into Cloudflare KV Space
      prediction = await getAIPrediction(rawRecords, analysis.triggers, lastPredictions, env);
      await saveKVPrediction(nextPeriod, {
        basePeriod: currentPeriod,
        targetPeriod: nextPeriod,
        predictedNumbers: prediction.predictedNumbers,
        activeTargets: prediction.activeTargets || [],
        reasoning: prediction.reasoning,
        isAIPowered: prediction.isAIPowered,
        status: 'pending',
        createdAt: Date.now()
      }, env);
    }

    // 3. Merge KV persistent historical predictions with analysis predictions
    const kvStore = await getKVStore(env);
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

    return new Response(
      JSON.stringify({
        latestDraw: rawRecords[0],
        summary: analysis.summary,
        triggers: analysis.triggers.slice(-50),
        predictions: mergedPredictions.slice(-30),
        frequencyStats: analysis.frequencyStats,
        prediction,
        totalCount: rawRecords.length
      }),
      { headers: corsHeaders }
    );
  }

  if (pathname === '/api/history' || pathname === '/api/history/') {
    const rawRecords = await getRecords(env);
    return new Response(JSON.stringify(rawRecords), { headers: corsHeaders });
  }

  if (pathname === '/api/refresh' || pathname === '/api/refresh/') {
    const scrapeResult = await scrapeLatest(env);
    const rawRecords = await getRecords(env);
    const currentPeriod = rawRecords[0]?.period || '';

    return new Response(
      JSON.stringify({
        success: scrapeResult.success,
        newCount: scrapeResult.newCount,
        latestPeriod: currentPeriod,
        totalCount: rawRecords.length
      }),
      { headers: corsHeaders }
    );
  }

  if (pathname === '/api/ai-report' || pathname === '/api/ai-report/') {
    const rawRecords = await getRecords(env);
    const analysis = analyzeData(rawRecords);
    const currentPeriod = rawRecords[0]?.period || '';
    const nextPeriod = (parseInt(currentPeriod, 10) + 1).toString();
    const kvEntry = await getKVPrediction(nextPeriod, env);
    const prediction = kvEntry || predictNextDraw(rawRecords, analysis.triggers, []);

    const prompt = `你是一位享誉业界的资深数理统计与算法首席研究员。
请根据第 ${currentPeriod} 期历史开奖以及针对第 ${nextPeriod} 期的六码不可能出现预测 [${prediction.predictedNumbers.join(', ')}]，撰写一份极具深度与学术水准的《数字轨迹分析与六码排除研报》。
要求理性、冷静、充满高学术风范，使用 Markdown 格式排版精美。`;

    let reportContent = '';
    const apiKey = env.GEMINI_API_KEY;
    if (apiKey) {
      const configs = [
        { version: 'v1', model: 'gemini-2.5-flash' },
        { version: 'v1beta', model: 'gemini-2.5-flash' },
        { version: 'v1beta', model: 'gemini-3.8-flash' }
      ];
      for (const cfg of configs) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/${cfg.version}/models/${cfg.model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            signal: AbortSignal.timeout(12000)
          });
          if (res.ok) {
            const data: any = await res.json();
            reportContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (reportContent) break;
          }
        } catch (e) {}
      }
    }

    if (!reportContent) {
      reportContent = `### 第 ${nextPeriod} 期排除推演数理研报\n\n根据大数定律与同号转移对冲模型，下期排除号码为：**[${prediction.predictedNumbers.join(', ')}]**。`;
    }

    return new Response(JSON.stringify({ content: reportContent }), { headers: corsHeaders });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: corsHeaders
  });
};
