// Live SAP (2v6.7): the KPI query and the supply / demand snapshot read straight from SAP B1 HANA.
//
//   GET /api/sap/status          -> {configured: true|false}; the page shows Load from SAP only when true
//   GET /api/sap/kpi             -> the KPI query as a tab-delimited file (the layout of SAP's Export to Excel)
//   GET /api/sap/supply-demand   -> the supply / demand snapshot, the same way
//   ?refresh=1                   -> skip the bridge's 5-minute cache (the bridge allows one every 30 s)
//   Headers passed on from the bridge: X-Row-Count, X-Refreshed-At (ISO, with a UTC offset on newer bridges) and
//   X-Stale: 1 when SAP could not be read and the bridge sent its last good result instead.
//
// Ask AI's SAP lookups (2v6.9):
//   GET /api/sap/catalog         -> {configured, queries:{name:{description, params:[…]}}}: the lookups Ask AI may
//                                   offer, i.e. the names in QUERIES below that the bridge lists (its /api/catalog,
//                                   kept 60 s); the reports are left out
//   GET /api/sap/data/<name>?…   -> one lookup as the bridge's JSON ({query, params, refreshed_at, row_count, stale,
//                                   truncated?, rows}); only the names and params in QUERIES pass, checked here first
//
// The sign-in gate in functions/_middleware.js runs first, so only signed-in users get here. The data comes from the
// SAP bridge (github.com/DavidP-M/SAP-app), a small read-only service on the company network that runs the same SQL as
// queries/*.sql, published with Cloudflare Tunnel. Its address and keys are Pages secrets; none of them reach the browser:
//   SAP_BRIDGE_URL                 the tunnel address, e.g. https://sap-bridge.example.com
//   SAP_BRIDGE_KEY                 one of the bridge's API_KEYS
//   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET   the Cloudflare Access service token in front of the tunnel
// Without SAP_BRIDGE_URL and SAP_BRIDGE_KEY the site works exactly as before: files are uploaded by hand.
const REPORTS = new Set(['kpi', 'supply-demand']);
// The only lookups and params the browser may ask the bridge for. Each param is int (min / max), str (max length;
// letters, digits, space . _ / -) or one of a list of values; required, or else the bridge's default applies.
const DOCNUM = { type: 'int', required: true, min: 1, max: 2147483647 };
const ITEM = { type: 'str', required: true, max: 50 };
const QUERIES = {
  so_detail: { description: 'Lines of one sales order', params: { docnum: DOCNUM } },
  po_detail: { description: 'Lines of one purchase order', params: { docnum: DOCNUM } },
  item_stock: { description: 'Stock of one item per warehouse: on hand, committed, on order, available', params: { item: ITEM } },
  customer_orders: { description: "One customer's sales orders with open value and days late", params: { cardcode: { type: 'str', required: true, max: 15 }, months: { type: 'int', default: 12, min: 1, max: 60 } } },
  order_deliveries: { description: 'Deliveries and invoices made from one sales order', params: { docnum: DOCNUM } },
  item_info: { description: 'One item: group, unit, lead time, minimum stock, prices, default vendor', params: { item: ITEM } },
  production_orders: { description: 'Production orders, open or all, for one item or every item', params: { item: { type: 'str', default: '', max: 50 }, status: { type: 'enum', values: ['open', 'all'], default: 'open' } } },
  open_sales_orders: { description: 'Open sales orders with remaining open value', params: {} },
  sales_by_month: { description: 'Net sales per month', params: { months: { type: 'int', default: 12, min: 1, max: 60 } } },
  stock_by_warehouse: { description: 'On-hand quantity and value per warehouse', params: {} },
  open_purchase_orders: { description: 'Open purchase orders with remaining open value', params: {} },
};
const SAFE_TEXT = /^[A-Za-z0-9 ._/-]+$/;
const CATALOG_MS = 60 * 1000;
let catalogCache = null; // {key, at, queries}

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET') return json(405, { error: 'Use GET.' }, { Allow: 'GET' });
  const name = [].concat(params.path || []).join('/');
  const configured = !!(env.SAP_BRIDGE_URL && env.SAP_BRIDGE_KEY);
  if (name === 'status') return json(200, { configured });
  const lookup = name.startsWith('data/') ? name.slice(5) : '';
  if (lookup && !Object.hasOwn(QUERIES, lookup)) return json(404, { error: `Unknown SAP lookup '${lookup.slice(0, 60)}'.` });
  if (!REPORTS.has(name) && !lookup && name !== 'catalog') return json(404, { error: `Unknown SAP report '${name.slice(0, 60)}'.` });
  if (!configured) {
    return json(503, { configured: false, error: 'Live SAP is not set up on this site.' });
  }
  if (name === 'catalog') return catalog(env);
  if (lookup) return data(env, lookup, new URL(request.url).searchParams);

  const url = bridgeUrl(env, `/api/reports/${name}`);
  if (!url) return json(503, { error: 'SAP_BRIDGE_URL is not a valid address.' });
  if (new URL(request.url).searchParams.get('refresh') === '1') url.searchParams.set('refresh', '1');
  const { res, fail } = await askBridge(env, url);
  if (fail) return fail;
  return new Response(res.body, {
    headers: {
      'content-type': 'text/tab-separated-values; charset=utf-8',
      'content-disposition': res.headers.get('content-disposition') || `attachment; filename="SAP_live_${name}.txt"`,
      'x-row-count': res.headers.get('x-row-count') || '',
      'x-refreshed-at': res.headers.get('x-refreshed-at') || '',
      'x-stale': res.headers.get('x-stale') || '',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function bridgeUrl(env, path) {
  try { return new URL(path, env.SAP_BRIDGE_URL); } catch (err) { return null; }
}

// {res}: the bridge's answer, or {fail}: a JSON error Response, 502 when it is unreachable, refused or failed. For lookups
// (json: true) its own 400 (a bad param) and 404 (a query it does not have) pass through, and only JSON is accepted.
async function askBridge(env, url, { json: wantJson = false } = {}) {
  const headers = { 'X-API-Key': env.SAP_BRIDGE_KEY };
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
  }
  let res;
  try {
    res = await fetch(url, { headers, redirect: 'manual' });
  } catch (err) {
    return failed(502, { error: 'The SAP bridge could not be reached. Is the bridge PC on and its tunnel running?' });
  }
  const type = res.headers.get('content-type') || '';
  // Cloudflare Access answers a refused service token with a redirect or its sign-in page, not the bridge's JSON.
  if ((res.status >= 300 && res.status < 400) || (res.ok && type.includes('text/html'))) {
    return failed(502, { error: 'Cloudflare Access refused the request: check CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET.' });
  }
  if (!res.ok) {
    let message = `The SAP bridge answered ${res.status}.`;
    try { message = (await res.json()).error || message; } catch (err) { /* not JSON */ }
    const pass = wantJson && (res.status === 400 || res.status === 404);
    return failed(pass ? res.status : 502, { error: String(message).slice(0, 400) });
  }
  if (wantJson && !type.includes('json')) return failed(502, { error: 'The SAP bridge did not answer with data.' });
  return { res };
}

// The lookups Ask AI may offer: the allowlisted queries the bridge lists, described with this file's params.
async function catalog(env) {
  const key = `${env.SAP_BRIDGE_URL}\u0000${env.SAP_BRIDGE_KEY}`;
  if (!catalogCache || catalogCache.key !== key || Date.now() - catalogCache.at > CATALOG_MS) {
    const url = bridgeUrl(env, '/api/catalog');
    if (!url) return json(503, { error: 'SAP_BRIDGE_URL is not a valid address.' });
    const { res, fail } = await askBridge(env, url, { json: true });
    if (fail) return fail.status === 404 ? json(502, { error: 'The SAP bridge has no catalog: update the bridge.' }) : fail;
    let listed = null;
    try { listed = (await res.json()).queries; } catch (err) { /* not JSON */ }
    if (!listed || typeof listed !== 'object') return json(502, { error: 'The SAP bridge sent a catalog this site cannot read.' });
    const queries = {};
    for (const [name, spec] of Object.entries(QUERIES)) {
      if (!Object.hasOwn(listed, name)) continue;
      const own = listed[name] && typeof listed[name].description === 'string' ? listed[name].description.trim().slice(0, 200) : '';
      queries[name] = { description: own || spec.description, params: Object.entries(spec.params).map(([p, d]) => ({ name: p, ...d, required: !!d.required })) };
    }
    catalogCache = { key, at: Date.now(), queries };
  }
  return json(200, { configured: true, queries: catalogCache.queries });
}

// One lookup: only the query's declared params, checked here, are sent on; the bridge's JSON comes back as it is.
async function data(env, name, search) {
  const url = bridgeUrl(env, `/api/data/${name}`);
  if (!url) return json(503, { error: 'SAP_BRIDGE_URL is not a valid address.' });
  for (const [p, d] of Object.entries(QUERIES[name].params)) {
    const raw = String(search.get(p) ?? '').trim();
    if (!raw) {
      if (d.required) return json(400, { error: `'${p}' is required.` });
      continue;
    }
    if (d.type === 'int') {
      const n = /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
      if (!(n >= d.min && n <= d.max)) return json(400, { error: `'${p}' must be a whole number from ${d.min} to ${d.max}.` });
      url.searchParams.set(p, String(n));
    } else if (d.type === 'enum') {
      const v = raw.toLowerCase();
      if (!d.values.includes(v)) return json(400, { error: `'${p}' must be one of ${d.values.join(', ')}.` });
      url.searchParams.set(p, v);
    } else {
      if (raw.length > d.max || !SAFE_TEXT.test(raw)) return json(400, { error: `'${p}' must be at most ${d.max} letters, digits, spaces or . _ / -` });
      url.searchParams.set(p, raw);
    }
  }
  const { res, fail } = await askBridge(env, url, { json: true });
  if (fail) return fail.status === 404 ? json(404, { error: `The SAP bridge does not have the '${name}' lookup yet: update the bridge.` }) : fail;
  return new Response(res.body, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

function failed(status, body) {
  return { fail: json(status, body) };
}
