// Builds SHIP_CITY_DATA, the city positions the Shipping page's Order Map uses (index.html, "2v6.9 cities").
// Source: GeoNames (https://www.geonames.org, CC BY 4.0) as packed in the npm package all-the-cities 3.1.0
// (its cities.pbf: every place of 1,000 people or more). Nothing is installed or run from the package:
//   npm pack all-the-cities@3.1.0 && tar -xzf all-the-cities-3.1.0.tgz
//   node tools/build-ship-cities.mjs package/cities.pbf index.html > ship-cities.txt
// then replace the SHIP_CITY_DATA line in index.html with the printed line.
//
// Kept: Canada and the United States, every place of 1,000 people or more (not sections of a city, GeoNames PPLX),
// grouped by province / state (CA-AB, US-IN); Mexico, places of 20,000 or more; every other country the map knows,
// cities of 300,000 or more. In a group, the bigger of two places with the same name (as the page compares names,
// shipCityNorm) is kept, biggest first. Format: groups split by "|", each "KEY@lon0,lat0,lon1,lat1=" (the group's box in
// tenths of a degree) then its places split by ";", each the name and four base-36 characters: longitude and latitude,
// two characters each, as steps of 1/1295 across the box.
import { readFileSync } from 'node:fs';

const [pbfPath, htmlPath] = process.argv.slice(2);
if (!pbfPath || !htmlPath) {
  console.error('Usage: node tools/build-ship-cities.mjs <all-the-cities cities.pbf> <index.html>');
  process.exit(2);
}

// The same rule as shipCityNorm in index.html: no accents or case, Saint/Ste -> st, Mount -> mt, Fort -> ft, letters and
// digits only.
const WORDS = { saint: 'st', sainte: 'st', ste: 'st', st: 'st', mount: 'mt', mt: 'mt', fort: 'ft', ft: 'ft' };
const cityNorm = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ')
  .split(/[^a-z0-9]+/).filter(Boolean).map((w) => WORDS[w] || w).join('');

// cities.pbf: length-prefixed City messages; longitude and latitude are deltas from the previous city, in 1e-5 degrees.
function readCities(buf) {
  let pos = 0, lastLon = 0, lastLat = 0;
  const varint = () => { let r = 0, s = 0, b; do { b = buf[pos++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  const svarint = () => { const v = varint(); return v % 2 ? -(v + 1) / 2 : v / 2; };
  const bytes = () => { const n = varint(); const s = buf.toString('utf8', pos, pos + n); pos += n; return s; };
  const out = [];
  while (pos < buf.length) {
    const end = varint() + pos;
    const c = { id: 0, name: '', country: '', fc: '', admin: '', pop: 0, lon: 0, lat: 0 };
    while (pos < end) {
      const key = varint(), tag = key >> 3, wire = key & 7;
      if (tag === 1) c.id = svarint();
      else if (tag === 2) c.name = bytes();
      else if (tag === 3) c.country = bytes();
      else if (tag === 7) c.fc = bytes();
      else if (tag === 8) c.admin = bytes();
      else if (tag === 9) c.pop = varint();
      else if (tag === 10) { lastLon += svarint(); c.lon = lastLon / 1e5; }
      else if (tag === 11) { lastLat += svarint(); c.lat = lastLat / 1e5; }
      else if (wire === 0) varint();
      else if (wire === 2) bytes();
      else throw new Error(`unexpected wire type ${wire}`);
    }
    out.push(c);
  }
  return out;
}

// The place keys the page's map knows (SHIP_PLACES in index.html): countries, US states and Canadian provinces.
const html = readFileSync(htmlPath, 'utf8');
const known = new Set([...html.slice(html.indexOf('const SHIP_PLACES='), html.indexOf('const SHIP_PLACE_ALIAS='))
  .matchAll(/([A-Z]{2}(?:-[A-Z]{2})?)\|-?[\d.]+\|-?[\d.]+\|/g)].map((m) => m[1]));
// GeoNames numbers Canada's provinces.
const CA = { '01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL', '07': 'NS', '08': 'ON', '09': 'PE', '10': 'QC', '11': 'SK', '12': 'YT', '13': 'NT', '14': 'NU' };
// Places left out at the owner's request, by GeoNames id (a shipment there shows at its state).
const LEFT_OUT = new Set([5519055]);
const groupOf = (c) => {
  if (LEFT_OUT.has(c.id)) return '';
  if (c.country === 'US') return c.pop >= 1000 && c.fc !== 'PPLX' ? `US-${c.admin}` : '';
  if (c.country === 'CA') return c.pop >= 1000 && c.fc !== 'PPLX' && CA[c.admin] ? `CA-${CA[c.admin]}` : '';
  if (c.country === 'MX') return c.pop >= 20000 && c.fc !== 'PPLX' ? 'MX' : '';
  return c.pop >= 300000 && c.fc !== 'PPLX' ? c.country : '';
};

const groups = new Map();
let skipped = 0;
for (const c of readCities(readFileSync(pbfPath)).sort((a, b) => b.pop - a.pop)) {
  const g = groupOf(c);
  if (!g || !known.has(g)) continue;
  if (/[|;@=:"\\]/.test(c.name) || !cityNorm(c.name)) { skipped++; continue; }
  if (!groups.has(g)) groups.set(g, new Map());
  const m = groups.get(g), k = cityNorm(c.name);
  if (!m.has(k)) m.set(k, c);
}
const b36 = (v) => Math.max(0, Math.min(1295, Math.round(v))).toString(36).padStart(2, '0');
const parts = [...groups.keys()].sort().map((g) => {
  const list = [...groups.get(g).values()];
  const lon0 = Math.floor(Math.min(...list.map((c) => c.lon)) * 10), lon1 = Math.max(lon0 + 1, Math.ceil(Math.max(...list.map((c) => c.lon)) * 10));
  const lat0 = Math.floor(Math.min(...list.map((c) => c.lat)) * 10), lat1 = Math.max(lat0 + 1, Math.ceil(Math.max(...list.map((c) => c.lat)) * 10));
  const at = (v, a, b) => b36((v * 10 - a) / (b - a) * 1295);
  return `${g}@${lon0},${lat0},${lon1},${lat1}=${list.map((c) => c.name + at(c.lon, lon0, lon1) + at(c.lat, lat0, lat1)).join(';')}`;
});
const count = [...groups.values()].reduce((n, m) => n + m.size, 0);
console.error(`${count} places in ${groups.size} groups (${skipped} names skipped)`);
console.log(`const SHIP_CITY_DATA=${JSON.stringify(parts.join('|'))};`);
