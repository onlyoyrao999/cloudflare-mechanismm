// functions/api/analyze.ts - Robust Cloudflare Pages Function with multi-model fallback & KV cache
import { analyzeData, predictNextDraw, DrawRecord } from '../../src/data/analyzer.js';
import fallbackHistory from '../../src/data/history.json';

interface Env {
  GEMINI_API_KEY?: string;
  PREDICTION_KV?: any;
  KV?: any;
}

const FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
];

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Robust regex lottery scraper that works with single-line or multi-line responses
async function fetchLotteryRecords(): Promise<DrawRecord[]> {
  try {
    const url = 'https://macaujc.ddcdn.cloudns.org/';
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const recordsMap = new Map<string, number[]>();

    const regex = /(\d+):\s*\[(.*?)\]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const period = match[1];
      const numsStr = match[2];
      const numbers = numsStr
        .split(',')
        .map((n) => parseInt(n.trim(), 10))
        .filter((n) => !isNaN(n));
      if (numbers.length > 0 && !recordsMap.has(period)) {
        recordsMap.set(period, numbers);
      }
    }

    if (recordsMap.size > 0) {
      const list: DrawRecord[] = Array.from(recordsMap.entries()).map(([period, numbers]) => ({
        period,
        numbers,
      }));
      list.sort((a, b) => b.period.localeCompare(a.period));
      return list;
    }
  } catch (err) {
    console.warn('Fetch lottery records remote error, using fallback history:', err);
  }

  // Graceful fallback to bundled history records
  return fallbackHistory as DrawRecord[];
}

// Call Gemini REST API with strict per-model timeout
async function callGeminiRest(apiKey: string, model: string, prompt: string, timeoutMs = 12000): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'aistudio-build',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText.slice(0, 80)}`);
  }

  const data: any = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response');
  return JSON.parse(text);
}

export const onRequestOptions = async () => {
  return new Response(null, { headers: CORS_HEADERS });
};

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const kv = env?.PREDICTION_KV || env?.KV;
  const urlObj = new URL(request.url);
  const forceClean = urlObj.searchParams.get('clean') === 'true' || urlObj.searchParams.get('refresh') === 'true';

  const records = await fetchLotteryRecords();
  if (records.length === 0) {
    return new Response(
      JSON.stringify({ status: 'error', message: '无法从数据源获取大盘开奖记录' }),
      { status: 502, headers: CORS_HEADERS }
    );
  }

  const analysis = analyzeData(records);
  const currentPeriod = records[0].period;
  const latestDrawnNumbers = records[0]?.numbers || [];
  const lastPredictions = analysis.predictions.length > 0 
    ? analysis.predictions[analysis.predictions.length - 1].predictedNumbers 
    : [];

  const mathPredict = predictNextDraw(records, analysis.triggers, lastPredictions);
  const activeTargets = mathPredict.activeTargets;
  const activeNumbers = activeTargets.map((t: any) => t.number);
  const forbiddenNumbers = Array.from(new Set([...activeNumbers, ...latestDrawnNumbers]));

  let prediction: any = null;

  // 1. If forceClean requested, purge KV cache for this and previous periods
  if (forceClean && kv && typeof kv.delete === 'function') {
    try {
      await kv.delete(`prediction_${currentPeriod}`);
      await kv.delete(`prediction_${parseInt(currentPeriod, 10) - 1}`);
    } catch (e) {
      console.warn('KV delete error:', e);
    }
  }

  // 2. Try reading from Cloudflare KV if bound (and not forceClean)
  if (!forceClean && kv && typeof kv.get === 'function') {
    try {
      const cached = await kv.get(`prediction_${currentPeriod}`, { type: 'json' });
      if (cached) {
        prediction = cached;
      }
    } catch (e) {
      console.warn('KV get failed:', e);
    }
  }

  // 3. If no cache, execute multi-tier fallback ladder
  if (!prediction) {
    if (!env?.GEMINI_API_KEY) {
      prediction = {
        ...mathPredict,
        isAIPowered: false,
        modelUsed: '高精度数理对冲保底',
        isFallback: true,
        fallbackReason: 'Cloudflare Pages 环境变量未检测到 GEMINI_API_KEY，已安全启用高阶数理对冲保底',
      };
    } else {
      const recordsText = records
        .slice(0, 165)
        .map((r) => `${r.period}: [${r.numbers.join(',')}]`)
        .join('\n');

      const prompt = `您是一位高等概率论专家和赛马彩票混沌学学者。
现在我们将向您提供澳门赛马会最近的 165 期开奖历史数据。每一期包含 7 个开奖号码（范围从 01 到 49）。

【重要对冲与清理规则（必须彻底清理上一期数据）】：
1. 处于追逐周期中的活跃目标号：[${activeNumbers.join(', ')}]，绝对不能包含在排除号码中！
2. 彻底清理上一期（第 ${currentPeriod} 期）实际开奖号码：[${latestDrawnNumbers.join(', ')}]，绝对不能包含在排除名单中！
3. 上一期已排除推荐号码：[${lastPredictions.join(', ')}]，请勿完全重复。
4. 结合冷态指标与遗漏波峰，计算出下一期（第 ${parseInt(currentPeriod, 10) + 1} 期）最不可能出现的 6 个号码。

历史数据：
${recordsText}

必须返回符合以下格式的 JSON：
{
  "predictedNumbers": [number, number, number, number, number, number],
  "reasoning": {
    "triggerLocking": "对追踪目标号及上一期开奖号的安全加锁清理阐释",
    "edgeDeduction": "首尾边缘环形对冲阐释",
    "omissionConclusion": "大盘冷态与遗漏波峰排除论述"
  }
}`;

      const fallbackLogs: string[] = [];
      for (const modelName of FALLBACK_MODELS) {
        try {
          console.log(`[CF Pages AI] Trying model ${modelName}...`);
          const body = await callGeminiRest(env.GEMINI_API_KEY, modelName, prompt, 12000);
          let predicted = (body.predictedNumbers || [])
            .map((n: any) => parseInt(n, 10))
            .filter((n: number) => !isNaN(n) && n >= 1 && n <= 49);
          predicted = Array.from(new Set(predicted)).slice(0, 6);

          if (predicted.length === 6) {
            predicted.sort((a: number, b: number) => a - b);
            const safePrediction: number[] = [];
            for (const num of predicted) {
              if (forbiddenNumbers.includes(num)) {
                for (const rep of mathPredict.predictedNumbers) {
                  if (!predicted.includes(rep) && !forbiddenNumbers.includes(rep) && !safePrediction.includes(rep)) {
                    safePrediction.push(rep);
                    break;
                  }
                }
              } else {
                safePrediction.push(num);
              }
            }
            while (safePrediction.length < 6) {
              for (const rep of mathPredict.predictedNumbers) {
                if (!safePrediction.includes(rep) && !forbiddenNumbers.includes(rep)) {
                  safePrediction.push(rep);
                  break;
                }
              }
            }
            safePrediction.sort((a, b) => a - b);

            prediction = {
              predictedNumbers: safePrediction,
              activeTargets,
              reasoning: {
                triggerLocking: body.reasoning?.triggerLocking || mathPredict.reasoning.triggerLocking,
                edgeDeduction: body.reasoning?.edgeDeduction || mathPredict.reasoning.edgeDeduction,
                omissionConclusion: body.reasoning?.omissionConclusion || mathPredict.reasoning.omissionConclusion,
              },
              isAIPowered: true,
              modelUsed: modelName,
              isFallback: modelName !== FALLBACK_MODELS[0],
              fallbackLogs: fallbackLogs.length > 0 ? fallbackLogs : undefined,
            };
            break;
          }
        } catch (err: any) {
          const msg = `${modelName} 响应超时或异常: ${err.message || '未知'}`;
          console.warn(`[CF Pages Fallback] ${msg}`);
          fallbackLogs.push(msg);
        }
      }

      if (!prediction) {
        console.warn('[CF Pages Fallback] All Gemini models failed. Activating math baseline.');
        prediction = {
          ...mathPredict,
          isAIPowered: false,
          modelUsed: '高精度数理对冲保底',
          isFallback: true,
          fallbackReason: `所有 AI 模型 (${FALLBACK_MODELS.join(', ')}) 均无响应，已平滑切换至数理对冲保底`,
          fallbackLogs,
        };
      }
    }

    // 3. Save to KV if bound
    if (kv && typeof kv.put === 'function' && prediction) {
      try {
        await kv.put(`prediction_${currentPeriod}`, JSON.stringify(prediction), { expirationTtl: 86400 });
      } catch (e) {
        console.warn('KV put failed:', e);
      }
    }
  }

  return new Response(
    JSON.stringify({
      latestDraw: records[0],
      summary: analysis.summary,
      triggers: analysis.triggers.slice(-50),
      predictions: analysis.predictions.slice(-30),
      frequencyStats: analysis.frequencyStats,
      prediction,
      totalCount: records.length,
    }),
    { headers: CORS_HEADERS }
  );
};
