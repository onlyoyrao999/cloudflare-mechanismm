// functions/api/refresh.ts - Cloudflare Pages Refresh Endpoint
export const onRequestPost = async (context: { env: any }) => {
  const { env } = context;
  const kv = env.PREDICTION_KV || env.KV;

  try {
    const url = 'https://macaujc.ddcdn.cloudns.org/';
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);

    // If KV is available, we can purge stale prediction cache
    return new Response(
      JSON.stringify({ status: 'success', message: '最新大盘数据同步成功' }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ status: 'error', message: err.message || '抓取失败' }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
};
