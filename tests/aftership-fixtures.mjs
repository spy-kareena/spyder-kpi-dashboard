// Synthetic AfterShip Tracking API (2026-07) answers and test stand-ins (Workers KV, AfterShip itself) shared by the
// shipping tests. Shapes follow the API: {meta:{code, message, type}, data}; no real tracking data.

// Workers KV stand-in: get(key, {type}) for 'text' | 'json', put(key, value, {expirationTtl}), delete.
export function memoryKv(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const kv = {
    map, puts: [], deletes: [], ttl: {},
    async get(key, opts) {
      if (!map.has(key)) return null;
      const v = map.get(key);
      const type = typeof opts === 'string' ? opts : opts && opts.type || 'text';
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value, opts = {}) {
      map.set(key, String(value));
      kv.puts.push(key);
      if (opts.expirationTtl) kv.ttl[key] = opts.expirationTtl;
    },
    async delete(key) { map.delete(key); kv.deletes.push(key); },
    json(key) { return map.has(key) ? JSON.parse(map.get(key)) : null; },
  };
  return kv;
}

export const NUMBERS = {
  transit: '770012345678',
  delivered: '770077770003',
  exception: '1Z999AA10123456784',
  pending: '335123456789',
  out: '770099990001',
  failed: '1234567890',
  expired: '770000000099',
  pickup: '770000000555',
};
const cp = (checkpoint_time, tag, message, city, state, country, extra = {}) => ({
  created_at: extra.created_at || checkpoint_time.replace(/([+-]\d\d:\d\d)$/, 'Z'), slug: extra.slug || 'fedex', checkpoint_time, location: extra.location ?? null,
  city, state, country_region: country, message, tag, subtag: `${tag}_001`, subtag_message: extra.subtag_message || message,
});
// One AfterShip tracking per scenario; checkpoints oldest first, as AfterShip sends them.
export const TRACKINGS = {
  transit: {
    id: 'as-transit', tracking_number: NUMBERS.transit, slug: 'fedex', tag: 'InTransit', subtag: 'InTransit_001', subtag_message: 'In transit',
    updated_at: '2026-10-08T12:20:00Z', origin_country_region: 'CAN', destination_country_region: 'CAN',
    latest_estimated_delivery: { type: 'specific', source: 'Carrier provided EDD', datetime: '2026-10-12T17:00:00-05:00' },
    shipment_pickup_date: '2026-10-06T15:00:00-06:00',
    checkpoints: [
      cp('2026-10-06T15:00:00-06:00', 'InfoReceived', 'Shipment information sent to FedEx', 'Lacombe', 'AB', 'CAN'),
      cp('2026-10-08T06:10:00-06:00', 'InTransit', 'Arrived at FedEx location', 'Regina', 'SK', 'CAN'),
    ],
  },
  delivered: {
    id: 'as-delivered', tracking_number: NUMBERS.delivered, slug: 'fedex', tag: 'Delivered', subtag: 'Delivered_001', subtag_message: 'Delivered',
    updated_at: '2026-10-08T15:00:00Z', shipment_delivery_date: '2026-10-08T10:12:00-04:00', destination_country_region: 'USA',
    destination_city: 'Columbus', destination_state: 'OH',
    checkpoints: [
      cp('2026-10-05T18:00:00-04:00', 'InTransit', 'International shipment release - Import', 'Buffalo', 'NY', 'USA'),
      cp('2026-10-08T10:12:00-04:00', 'Delivered', 'Delivered', 'Columbus', 'OH', 'USA'),
    ],
  },
  exception: {
    id: 'as-exception', tracking_number: NUMBERS.exception, slug: 'ups', tag: 'Exception', subtag: 'Exception_011', subtag_message: 'Customs clearance delay',
    updated_at: '2026-10-08T20:00:00Z',
    checkpoints: [cp('2026-10-08T14:00:00-04:00', 'Exception', 'Clearance delay: commercial invoice missing', null, null, null, { location: 'Blaine, WA, US', slug: 'ups' })],
  },
  pending: { id: 'as-pending', tracking_number: NUMBERS.pending, slug: 'purolator', tag: 'Pending', subtag: 'Pending_001', subtag_message: 'No information yet', updated_at: '2026-10-08T00:00:00Z', checkpoints: [] },
  out: {
    id: 'as-out', tracking_number: NUMBERS.out, slug: 'fedex', tag: 'OutForDelivery', subtag: 'OutForDelivery_001', subtag_message: 'Out for delivery',
    checkpoints: [cp('2026-10-09T07:00:00-05:00', 'OutForDelivery', 'On FedEx vehicle for delivery', 'Winnipeg', 'MB', 'CAN')],
  },
  failed: {
    id: 'as-failed', tracking_number: NUMBERS.failed, slug: 'fedex-freight', tag: 'AttemptFail', subtag: 'AttemptFail_001', subtag_message: 'Business closed',
    checkpoints: [cp('2026-10-08T16:00:00-06:00', 'AttemptFail', 'Customer not available or business closed', 'Calgary', 'AB', 'CAN')],
  },
  expired: { id: 'as-expired', tracking_number: NUMBERS.expired, slug: 'canpar', tag: 'Expired', subtag: 'Expired_001', subtag_message: 'No further updates', checkpoints: [cp('2026-09-01T09:00:00-04:00', 'InTransit', 'In transit', 'Toronto', 'ON', 'CAN')] },
  pickup: { id: 'as-pickup', tracking_number: NUMBERS.pickup, slug: 'canada-post', tag: 'AvailableForPickup', subtag: 'AvailableForPickup_001', subtag_message: 'Ready at the post office', checkpoints: [] },
};

// AfterShip stand-in. known: numbers AfterShip already has (a create says 4003). Options:
//   status(kind, n): an HTTP status to answer with (401, 429, 500...) for the n-th request of that kind ('create'|'list')
//   pageSize: trackings per list page (to test next_cursor), refuse: numbers a create refuses (4005), badSlug: slugs
//   that are refused (4010), existsData: what a 4003 answer's data carries, retryAfter: the 429 answer's Retry-After.
export function fakeAfterShip({ trackings = TRACKINGS, known = [], status = () => 200, pageSize = 200, refuse = [], badSlug = [], existsData = null, retryAfter = '30' } = {}) {
  const calls = [];
  const byNumber = new Map(Object.values(trackings).map((t) => [t.tracking_number, t]));
  const have = new Set(known);
  const count = { create: 0, list: 0 };
  const err = (code, http, message) => Response.json({ meta: { code, message, type: 'Error' }, data: {} }, { status: http });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.origin !== 'https://api.aftership.com' || u.pathname !== '/tracking/2026-07/trackings') throw new Error(`unexpected request ${url}`);
    const key = (init.headers || {})['as-api-key'];
    const method = init.method || 'GET';
    const kind = method === 'POST' ? 'create' : 'list';
    const n = ++count[kind];
    const call = { kind, url, key };
    calls.push(call);
    const s = status(kind, n);
    if (s === 401) return err(401, 401, 'Invalid API key.');
    if (s === 429) return new Response(JSON.stringify({ meta: { code: 429, message: 'You have exceeded the API call rate limit.', type: 'TooManyRequests' }, data: {} }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': retryAfter } });
    if (s !== 200) return err(500, s, 'Something went wrong.');
    if (kind === 'create') {
      const body = JSON.parse(init.body);
      Object.assign(call, { number: body.tracking_number, slug: body.slug || '' });
      if (body.slug && badSlug.includes(body.slug)) return err(4010, 400, 'The value of slug is invalid.');
      if (refuse.includes(body.tracking_number)) return err(4005, 400, 'The value of tracking_number is invalid.');
      if (have.has(body.tracking_number)) return Response.json({ meta: { code: 4003, message: 'Tracking already exists.', type: 'BadRequest' }, data: existsData ? existsData(body.tracking_number) : {} }, { status: 400 });
      have.add(body.tracking_number);
      if (!byNumber.has(body.tracking_number)) byNumber.set(body.tracking_number, { id: `as-${body.tracking_number}`, tracking_number: body.tracking_number, slug: body.slug || 'fedex', tag: 'InTransit', checkpoints: [] });
      const t = byNumber.get(body.tracking_number);
      return Response.json({ meta: { code: 201, message: '', type: 'Created' }, data: { ...t, tag: 'Pending', subtag: 'Pending_001', checkpoints: [] } }, { status: 201 });
    }
    const numbers = String(u.searchParams.get('tracking_numbers') || '').split(',').filter(Boolean);
    Object.assign(call, { numbers, limit: u.searchParams.get('limit'), cursor: u.searchParams.get('cursor') || '' });
    const all = numbers.filter((x) => have.has(x) && byNumber.has(x)).map((x) => byNumber.get(x));
    const start = Number(call.cursor || 0);
    const page = all.slice(start, start + pageSize);
    const more = start + pageSize < all.length;
    return Response.json({ meta: { code: 200, message: '', type: 'OK' }, data: { pagination: { total: all.length, next_cursor: more ? String(start + pageSize) : '', has_next_page: more }, trackings: page } });
  };
  return { fetch, calls, have, creates: () => calls.filter((c) => c.kind === 'create'), lists: () => calls.filter((c) => c.kind === 'list') };
}
