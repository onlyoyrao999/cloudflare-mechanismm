import { analyzeData, predictNextDraw } from '../../src/data/analyzer.js';

interface Env {
  GEMINI_API_KEY?: string;
  LOTTERY_KV?: any;
  macau_lottery_kv?: any;
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
  return env.macau_lottery_kv || env.LOTTERY_KV || (env as any).KV || null;
}

let memoryHistory: any[] | null = null;
let memoryCache: { period: string; prediction: any; timestamp?: number } | null = null;
let lastScrapeCheck = 0;

async function getRecords(env: Env): Promise<any[]> {
  const kv = getKV(env);
  if (kv) {
    try {
      const stored = await kv.get('LOTTERY_HISTORY', 'json');
      if (stored && Array.isArray(stored) && stored.length > 0) {
        return stored;
      }
    } catch (e) {
      console.error('Error reading from KV:', e);
    }
  }

  if (memoryHistory && memoryHistory.length > 0) {
    return memoryHistory;
  }

  // Fallback initial dataset if KV is empty
  const defaultHistory = [
    { period: '2026267', numbers: [16, 20, 25, 22, 9, 41, 40] },
    { period: '2026266', numbers: [27, 43, 2, 17, 33, 31, 3] },
    { period: '2026265', numbers: [38, 2, 49, 14, 23, 28, 41] },
    { period: '2026264', numbers: [27, 42, 12, 13, 20, 36, 17] },
    { period: '2026263', numbers: [18, 32, 49, 10, 27, 7, 26] },
    { period: '2026262', numbers: [23, 15, 6, 24, 39, 4, 38] },
    { period: '2026261', numbers: [30, 26, 40, 14, 18, 47, 7] },
    { period: '2026260', numbers: [12, 1, 44, 25, 30, 48, 14] },
    { period: '2026259', numbers: [35, 11, 4, 33, 16, 41, 3] },
    { period: '2026258', numbers: [48, 28, 39, 44, 27, 31, 10] },
    { period: '2026257', numbers: [13, 42, 38, 2, 9, 36, 47] }
  ];

  if (kv) {
    try {
      await kv.put('LOTTERY_HISTORY', JSON.stringify(defaultHistory));
    } catch (e) {
      console.error('Error seeding initial records to KV:', e);
    }
  }

  return defaultHistory;
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

async function getCachedPrediction(period: string, env: Env) {
  if (memoryCache && memoryCache.period === period) {
    if (memoryCache.prediction?.isAIPowered) {
      return memoryCache.prediction;
    }
    if (memoryCache.timestamp && Date.now() - memoryCache.timestamp < 120 * 1000) {
      return memoryCache.prediction;
    }
  }
  const kv = getKV(env);
  if (kv) {
    try {
      const stored = await kv.get(`PREDICTION_CACHE_${period}`, 'json');
      if (stored) {
        if (stored.isAIPowered) {
          return stored;
        }
        if (stored.timestamp && Date.now() - stored.timestamp < 120 * 1000) {
          return stored;
        }
      }
    } catch (e) {
      console.error('Error reading prediction cache from KV:', e);
    }
  }
  return null;
}

async function savePredictionCache(period: string, prediction: any, env: Env) {
  const cachedData = { ...prediction, timestamp: Date.now() };
  memoryCache = { period, prediction: cachedData, timestamp: Date.now() };
  const kv = getKV(env);
  if (kv) {
    try {
      await kv.put(`PREDICTION_CACHE_${period}`, JSON.stringify(cachedData), {
        expirationTtl: 86400 * 7,
      });
    } catch (e) {
      console.error('Error saving prediction cache to KV:', e);
    }
  }
}

async function scrapeLatest(env: Env): Promise<{ success: boolean; newCount: number; latest?: any }> {
  try {
    const urls = [
      'https://api.macaujc.com/lottery/drawings?limit=50',
      'https://api.macaumarksix.com/history?limit=50',
      'https://www.macaujc.com/api/results',
      'https://macaumarksix.com/api/live'
    ];

    let fetchedData: any[] = [];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*'
          },
          signal: AbortSignal.timeout(4000)
        });
        if (res.ok) {
          const json: any = await res.json();
          const items = Array.isArray(json) ? json : json.data || json.results || json.draws || json.list;
          if (Array.isArray(items) && items.length > 0) {
            fetchedData = items;
            break;
          }
        }
      } catch (err) {
        // try next
      }
    }

    if (fetchedData.length === 0) {
      return { success: false, newCount: 0 };
    }

    const currentRecords = await getRecords(env);
    const existingMap = new Map(currentRecords.map(r => [r.period, r]));
    let added = 0;

    for (const item of fetchedData) {
      const period = (item.period || item.issue || item.expect || item.drawNumber || '').toString();
      let rawNumbers = item.numbers || item.openCode || item.balls || item.result;
      if (!period || !rawNumbers) continue;

      let numbers: number[] = [];
      if (Array.isArray(rawNumbers)) {
        numbers = rawNumbers.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
      } else if (typeof rawNumbers === 'string') {
        numbers = rawNumbers.split(/[,+\s]+/).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
      }

      if (numbers.length >= 7 && !existingMap.has(period)) {
        existingMap.set(period, { period, numbers: numbers.slice(0, 7) });
        added++;
      }
    }

    if (added > 0) {
      const sorted = Array.from(existingMap.values()).sort((a, b) => b.period.localeCompare(a.period));
      await saveRecords(sorted, env);
      return { success: true, newCount: added, latest: sorted[0] };
    }

    return { success: true, newCount: 0, latest: currentRecords[0] };
  } catch (err) {
    console.error('scrapeLatest error:', err);
    return { success: false, newCount: 0 };
  }
}

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
    const recordsText = rawRecords
      .slice(0, 50)
      .map((r: any) => `${r.period}: [${r.numbers.join(',')}]`)
      .join('\n');

    const prompt = `你是一位精通高等概率论与大数统计的资深博弈学分析家。
现在需要对澳门特区彩票（49选7，包含6个正码与1个特别号码，号码范围为 1 到 49）的下一期开奖结果进行严格的【六码排除推演（即找出下期最不可能出现的6个号码）】。

已知关键技术约束与算法规则：
1. 【防重叠排除规则】：下期预测的 6 个排除号码，绝对不能包含上一期（第 ${latestDraw.period} 期）已开出的任何号码 [${latestDraw.numbers.join(', ')}]，且 6 个号码互不相同，按数值升序排列。
2. 【数理对冲与反向加锁】：当前大盘中处于追赶周期内的活跃同号转移目标号码为 [${activeNumbers.join(', ')}]。这些属于潜在活跃号，严禁列入本期排除范围！
3. 【冷热失衡与遗漏波峰】：结合历史大盘统计，挑选那些处于深度遗漏谷底、严重失调且无轨迹回补迹象的极低概率冷态号码。

请根据以上严谨逻辑，推导出下一期最不可能出现的 6 个号码，并输出严密的分析：
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
          return {
            predictedNumbers: parsed.predictedNumbers.sort((a: number, b: number) => a - b),
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

    const analysis = analyzeData(rawRecords);
    const lastPredictions = analysis.predictions.length > 0
      ? analysis.predictions[analysis.predictions.length - 1].predictedNumbers
      : [];

    const currentPeriod = rawRecords[0]?.period || '';
    let prediction = await getCachedPrediction(currentPeriod, env);

    if (!prediction) {
      prediction = await getAIPrediction(rawRecords, analysis.triggers, lastPredictions, env);
      await savePredictionCache(currentPeriod, prediction, env);
    }

    return new Response(
      JSON.stringify({
        latestDraw: rawRecords[0],
        summary: analysis.summary,
        triggers: analysis.triggers.slice(-50),
        predictions: analysis.predictions.slice(-30),
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
    
    // Clear prediction cache if new draw was added
    if (scrapeResult.newCount > 0) {
      const kv = getKV(env);
      if (kv) {
        try {
          await kv.delete(`PREDICTION_CACHE_${currentPeriod}`);
        } catch (e) {}
      }
      memoryCache = null;
    }

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
    const prediction = await getCachedPrediction(currentPeriod, env) || predictNextDraw(rawRecords, analysis.triggers, []);

    const prompt = `你是一位享誉业界的资深数理统计与彩票算法首席研究员。
请根据第 ${currentPeriod} 期历史开奖以及针对第 ${nextPeriod} 期的六码不可能出现预测 [${prediction.predictedNumbers.join(', ')}]，撰写一份极具深度与学术水准的《澳门赛马会彩票下期走势与六码排除研报》。
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
      reportContent = `### 澳门彩票第 ${nextPeriod} 期排除推演数理研报\n\n根据大数定律与同号转移对冲模型，下期排除号码为：**[${prediction.predictedNumbers.join(', ')}]**。`;
    }

    return new Response(JSON.stringify({ content: reportContent }), { headers: corsHeaders });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: corsHeaders
  });
};
