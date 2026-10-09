// Synthetic FedEx Track API answers and test stand-ins (Workers KV, FedEx itself) shared by the shipping tests.
// Shapes follow the FedEx Track API v1 (output.completeTrackResults[].trackResults[]); no real tracking data.

// Workers KV stand-in: get(key, {type}) for 'text' | 'json' | 'arrayBuffer', put(key, value, {expirationTtl}), delete.
export function memoryKv(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const kv = {
    map, puts: [], deletes: [], ttl: {},
    async get(key, opts) {
      if (!map.has(key)) return null;
      const v = map.get(key);
      const type = typeof opts === 'string' ? opts : opts && opts.type || 'text';
      if (type === 'json') return JSON.parse(v);
      if (type === 'arrayBuffer') return new TextEncoder().encode(v).buffer;
      return v;
    },
    async put(key, value, opts = {}) {
      map.set(key, typeof value === 'string' ? value : new TextDecoder().decode(value));
      kv.puts.push(key);
      if (opts.expirationTtl) kv.ttl[key] = opts.expirationTtl;
    },
    async delete(key) { map.delete(key); kv.deletes.push(key); },
    json(key) { return map.has(key) ? JSON.parse(map.get(key)) : null; },
  };
  return kv;
}

const ev = (date, eventType, eventDescription, city, st, cc, extra = {}) => ({
  date, eventType, eventDescription, derivedStatusCode: extra.derived || eventType, derivedStatus: eventDescription,
  exceptionDescription: extra.exception || '', scanLocation: { city, stateOrProvinceCode: st, countryCode: cc },
});
const party = (city, st, cc) => ({ address: { city, stateOrProvinceCode: st, countryCode: cc } });

// One trackResult per scenario; scanEvents newest first, as FedEx sends them.
export const RESULTS = {
  // Parcel inside Canada, in transit.
  parcel: {
    trackingNumberInfo: { trackingNumber: '770012345678', carrierCode: 'FDXG' },
    serviceDetail: { type: 'FEDEX_GROUND', description: 'FedEx Ground' },
    shipperInformation: party('LACOMBE', 'AB', 'CA'),
    recipientInformation: party('WINNIPEG', 'MB', 'CA'),
    latestStatusDetail: { code: 'AR', derivedCode: 'IT', statusByLocale: 'In transit', description: 'Arrived at FedEx location', scanLocation: { city: 'REGINA', stateOrProvinceCode: 'SK', countryCode: 'CA' } },
    dateAndTimes: [{ type: 'ESTIMATED_DELIVERY', dateTime: '2026-10-12T17:00:00-05:00' }, { type: 'SHIP', dateTime: '2026-10-06T00:00:00-06:00' }],
    scanEvents: [
      ev('2026-10-08T06:10:00-06:00', 'AR', 'Arrived at FedEx location', 'REGINA', 'SK', 'CA'),
      ev('2026-10-07T21:00:00-06:00', 'DP', 'Departed FedEx location', 'CALGARY', 'AB', 'CA'),
      ev('2026-10-06T15:30:00-06:00', 'PU', 'Picked up', 'LACOMBE', 'AB', 'CA'),
      ev('2026-10-05T11:00:00-06:00', 'OC', 'Shipment information sent to FedEx', 'LACOMBE', 'AB', 'CA'),
    ],
  },
  // FedEx Freight LTL (PRO number), out for delivery.
  freight: {
    trackingNumberInfo: { trackingNumber: '1234567890', carrierCode: 'FXFR' },
    serviceDetail: { type: 'FEDEX_FREIGHT_ECONOMY', description: 'FedEx Freight Economy' },
    shipperInformation: party('CALGARY', 'AB', 'CA'),
    recipientInformation: party('RED DEER', 'AB', 'CA'),
    latestStatusDetail: { code: 'OD', derivedCode: 'OD', statusByLocale: 'On FedEx vehicle for delivery', description: 'On FedEx vehicle for delivery' },
    dateAndTimes: [{ type: 'ESTIMATED_DELIVERY', dateTime: '2026-10-09T16:00:00-06:00' }],
    scanEvents: [
      ev('2026-10-09T07:45:00-06:00', 'OD', 'On FedEx vehicle for delivery', 'RED DEER', 'AB', 'CA'),
      ev('2026-10-08T13:00:00-06:00', 'PU', 'Picked up', 'CALGARY', 'AB', 'CA'),
    ],
  },
  // Into the US, held at customs for a missing invoice.
  customsDelay: {
    trackingNumberInfo: { trackingNumber: '770099990001', carrierCode: 'FDXE' },
    serviceDetail: { type: 'INTERNATIONAL_PRIORITY', description: 'FedEx International Priority' },
    shipperInformation: party('LACOMBE', 'AB', 'CA'),
    recipientInformation: party('ELKHART', 'IN', 'US'),
    latestStatusDetail: {
      code: 'CD', derivedCode: 'DY', statusByLocale: 'Clearance delay', description: 'Clearance delay - Import',
      ancillaryDetails: [{ reason: 'IMPORT', reasonDescription: 'Missing commercial invoice', actionDescription: 'The shipper must send the commercial invoice' }],
      delayDetail: { status: 'DELAYED', type: 'CLEARANCE', subType: 'CUSTOMS' },
    },
    dateAndTimes: [{ type: 'ESTIMATED_DELIVERY', dateTime: '2026-10-10T17:00:00-04:00' }],
    scanEvents: [
      ev('2026-10-07T09:00:00-04:00', 'CD', 'Clearance delay - Import', 'INDIANAPOLIS', 'IN', 'US', { exception: 'Missing commercial invoice' }),
      ev('2026-10-06T22:00:00-04:00', 'CP', 'In clearance process', 'INDIANAPOLIS', 'IN', 'US'),
      ev('2026-10-06T20:00:00-04:00', 'AR', 'Arrived at FedEx location', 'INDIANAPOLIS', 'IN', 'US'),
      ev('2026-10-05T16:00:00-06:00', 'PU', 'Picked up', 'LACOMBE', 'AB', 'CA'),
    ],
  },
  // Delivery exception after going out for delivery.
  exception: {
    trackingNumberInfo: { trackingNumber: '770055550002', carrierCode: 'FDXG' },
    serviceDetail: { type: 'FEDEX_GROUND', description: 'FedEx Ground' },
    shipperInformation: party('LACOMBE', 'AB', 'CA'),
    recipientInformation: party('EDMONTON', 'AB', 'CA'),
    latestStatusDetail: {
      code: 'DE', derivedCode: 'DE', statusByLocale: 'Delivery exception', description: 'Customer not available or business closed',
      ancillaryDetails: [{ reason: '08', reasonDescription: 'Customer not available or business closed', actionDescription: 'We will try again on the next business day' }],
    },
    dateAndTimes: [],
    scanEvents: [
      ev('2026-10-08T17:20:00-06:00', 'DE', 'Delivery exception', 'EDMONTON', 'AB', 'CA', { exception: 'Customer not available or business closed' }),
      ev('2026-10-08T08:00:00-06:00', 'OD', 'On FedEx vehicle for delivery', 'EDMONTON', 'AB', 'CA'),
      ev('2026-10-07T12:00:00-06:00', 'IT', 'In transit', 'RED DEER', 'AB', 'CA'),
      ev('2026-10-07T09:00:00-06:00', 'PU', 'Picked up', 'LACOMBE', 'AB', 'CA'),
    ],
  },
  // Delivered in the US after customs released it.
  delivered: {
    trackingNumberInfo: { trackingNumber: '770077770003', carrierCode: 'FDXE' },
    serviceDetail: { type: 'INTERNATIONAL_ECONOMY', description: 'FedEx International Economy' },
    shipperInformation: party('LACOMBE', 'AB', 'CA'),
    recipientInformation: party('TIFFIN', 'OH', 'US'),
    latestStatusDetail: { code: 'DL', derivedCode: 'DL', statusByLocale: 'Delivered', description: 'Delivered' },
    dateAndTimes: [{ type: 'ACTUAL_DELIVERY', dateTime: '2026-10-08T10:12:00-04:00' }, { type: 'ACTUAL_PICKUP', dateTime: '2026-10-02T15:00:00-06:00' }],
    scanEvents: [
      ev('2026-10-08T10:12:00-04:00', 'DL', 'Delivered', 'TIFFIN', 'OH', 'US'),
      ev('2026-10-08T07:00:00-04:00', 'OD', 'On FedEx vehicle for delivery', 'TIFFIN', 'OH', 'US'),
      ev('2026-10-06T08:00:00-04:00', 'IT', 'International shipment release - Import', 'DETROIT', 'MI', 'US'),
      ev('2026-10-05T18:00:00-04:00', 'CP', 'In clearance process', 'DETROIT', 'MI', 'US'),
      ev('2026-10-05T12:00:00-04:00', 'AR', 'Arrived at FedEx location', 'DETROIT', 'MI', 'US'),
      ev('2026-10-02T15:00:00-06:00', 'PU', 'Picked up', 'LACOMBE', 'AB', 'CA'),
    ],
  },
};
export const NUMBERS = Object.fromEntries(Object.entries(RESULTS).map(([k, r]) => [k, r.trackingNumberInfo.trackingNumber]));

export function trackResponse(numbers, results = RESULTS) {
  const byNumber = Object.fromEntries(Object.values(results).map((r) => [r.trackingNumberInfo.trackingNumber, r]));
  return {
    transactionId: 'test',
    output: {
      completeTrackResults: numbers.map((n) => ({
        trackingNumber: n,
        trackResults: [byNumber[n] || { trackingNumberInfo: { trackingNumber: n }, error: { code: 'TRACKING.TRACKINGNUMBER.NOTFOUND', message: 'Tracking number cannot be found.' } }],
      })),
    },
  };
}

// FedEx stand-in: answers /oauth/token and /track/v1/trackingnumbers and records every call.
export function fakeFedex({ results = RESULTS, tokenStatus = 200, trackStatus = () => 200, expiresIn = 3599 } = {}) {
  const calls = [];
  let issued = 0;
  const live = new Set();
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = String(init.body || '');
    if (u.pathname === '/oauth/token') {
      calls.push({ kind: 'token', url, body });
      if (tokenStatus !== 200) return Response.json({ errors: [{ code: 'NOT.AUTHORIZED.ERROR', message: 'The given client credentials were not valid.' }] }, { status: tokenStatus });
      const token = `tok-${++issued}`;
      live.add(token);
      return Response.json({ access_token: token, token_type: 'bearer', expires_in: expiresIn, scope: 'CXS' });
    }
    if (u.pathname === '/track/v1/trackingnumbers') {
      const parsed = JSON.parse(body);
      const numbers = parsed.trackingInfo.map((t) => t.trackingNumberInfo.trackingNumber);
      const auth = (init.headers || {}).authorization || '';
      calls.push({ kind: 'track', url, numbers, auth, detailed: parsed.includeDetailedScans });
      if (!live.has(auth.replace(/^Bearer /, ''))) return Response.json({ errors: [{ code: 'NOT.AUTHORIZED.ERROR', message: 'Unauthorized' }] }, { status: 401 });
      const status = trackStatus(calls.filter((c) => c.kind === 'track').length);
      if (status !== 200) return Response.json({ errors: [{ code: 'SYSTEM.UNAVAILABLE', message: 'Service unavailable' }] }, { status });
      return Response.json(trackResponse(numbers, results));
    }
    throw new Error(`unexpected request ${url}`);
  };
  return { fetch, calls, revoke: () => live.clear(), tokens: () => issued };
}
