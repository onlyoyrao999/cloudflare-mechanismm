// functions/api/clear-cache.ts - Purges previous period KV caches
interface Env {
  PREDICTION_KV?: any;
  KV?: any;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const onRequestOptions = async () => {
  return new Response(null, { headers: CORS_HEADERS });
};

async function handleClear(env: Env) {
  const kv = env?.PREDICTION_KV || env?.KV;
  let deletedCount = 0;

  if (kv) {
    try {
      if (typeof kv.list === 'function') {
        const list = await kv.list({ prefix: 'prediction_' });
        if (list && list.keys) {
          for (const key of list.keys) {
            await kv.delete(key.name);
            deletedCount++;
          }
        }
      }
      // Explicitly delete known recent period keys as well
      const knownPeriods = ['2026264', '2026265', '2026266', '2026267', '2026268'];
      for (const p of knownPeriods) {
        try {
          await kv.delete(`prediction_${p}`);
          deletedCount++;
        } catch {}
      }
    } catch (e) {
      console.warn('KV clear error:', e);
    }
  }

  return new Response(
    JSON.stringify({
      status: 'success',
      message: `已彻底清理上一期数据与 KV 缓存 (${deletedCount} 项)，新推演将应用完全纯净的基准大盘数据。`,
    }),
    { headers: CORS_HEADERS }
  );
}

export const onRequestPost = async (context: { env: Env }) => {
  return handleClear(context.env);
};

export const onRequestGet = async (context: { env: Env }) => {
  return handleClear(context.env);
};
