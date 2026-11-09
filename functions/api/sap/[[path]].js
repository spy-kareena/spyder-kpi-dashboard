// Live SAP (2v6.7): the KPI query and the supply / demand snapshot read straight from SAP B1 HANA.
//
//   GET /api/sap/status          -> {configured: true|false}; the page shows Load from SAP only when true
//   GET /api/sap/kpi             -> the KPI query as a tab-delimited file (the layout of SAP's Export to Excel)
//   GET /api/sap/supply-demand   -> the supply / demand snapshot, the same way
//   ?refresh=1                   -> skip the bridge's 5-minute cache
//
// The sign-in gate in functions/_middleware.js runs first, so only signed-in users get here. The data comes from the
// SAP bridge (github.com/DavidP-M/SAP-app), a small read-only service on the company network that runs the same SQL as
// queries/*.sql, published with Cloudflare Tunnel. Its address and keys are Pages secrets; none of them reach the browser:
//   SAP_BRIDGE_URL                 the tunnel address, e.g. https://sap-bridge.example.com
//   SAP_BRIDGE_KEY                 one of the bridge's API_KEYS
//   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET   the Cloudflare Access service token in front of the tunnel
// Without SAP_BRIDGE_URL and SAP_BRIDGE_KEY the site works exactly as before: files are uploaded by hand.
const REPORTS = new Set(['kpi', 'supply-demand']);

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET') return json(405, { error: 'Use GET.' }, { Allow: 'GET' });
  const name = [].concat(params.path || []).join('/');
  const configured = !!(env.SAP_BRIDGE_URL && env.SAP_BRIDGE_KEY);
  if (name === 'status') return json(200, { configured });
  if (!REPORTS.has(name)) return json(404, { error: `Unknown SAP report '${name}'.` });
  if (!configured) {
    return json(503, { configured: false, error: 'Live SAP is not set up on this site.' });
  }

  let url;
  try { url = new URL(`/api/reports/${name}`, env.SAP_BRIDGE_URL); }
  catch (err) { return json(503, { error: 'SAP_BRIDGE_URL is not a valid address.' }); }
  if (new URL(request.url).searchParams.get('refresh') === '1') url.searchParams.set('refresh', '1');
  const headers = { 'X-API-Key': env.SAP_BRIDGE_KEY };
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
  }

  let res;
  try {
    res = await fetch(url, { headers, redirect: 'manual' });
  } catch (err) {
    return json(502, { error: 'The SAP bridge could not be reached. Is the bridge PC on and its tunnel running?' });
  }
  const type = res.headers.get('content-type') || '';
  // Cloudflare Access answers a refused service token with a redirect or its sign-in page, not the bridge's JSON.
  if ((res.status >= 300 && res.status < 400) || (res.ok && type.includes('text/html'))) {
    return json(502, { error: 'Cloudflare Access refused the request: check CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET.' });
  }
  if (!res.ok) {
    let message = `The SAP bridge answered ${res.status}.`;
    try { message = (await res.json()).error || message; } catch (err) { /* not JSON */ }
    return json(502, { error: message });
  }
  return new Response(res.body, {
    headers: {
      'content-type': 'text/tab-separated-values; charset=utf-8',
      'content-disposition': res.headers.get('content-disposition') || `attachment; filename="SAP_live_${name}.txt"`,
      'x-row-count': res.headers.get('x-row-count') || '',
      'x-refreshed-at': res.headers.get('x-refreshed-at') || '',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}
