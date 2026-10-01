// Tests for functions/api/gemini/[[path]].js (Ask AI server-key proxy). Run: node tests/gemini-proxy.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// The Pages function is an ES module in a .js file; load its source as a module from a data: URL.
const source = readFileSync(join(here, '..', 'functions', 'api', 'gemini', '[[path]].js'), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const KEY = 'server-key-not-real';
const ORIGIN = 'https://kpi.example.test';
const GENERATE = '/api/gemini/models/gemini-2.5-flash:generateContent';
let upstream = [];
let reply = { status: 200, body: { ok: true } };
globalThis.fetch = async (url, init = {}) => {
  upstream.push({ url, init });
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
};

async function call(path, { method = 'GET', body, env = { GEMINI_API_KEY: KEY }, headers = {} } = {}) {
  upstream = [];
  reply = { status: 200, body: { ok: true } };
  return onRequest({ request: new Request(ORIGIN + path, { method, body, headers }), env, params: {} });
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('status reports whether the server key is set, without calling Google', async () => {
  const on = await call('/api/gemini/status');
  assert.equal(on.status, 200);
  assert.deepEqual(await on.json(), { configured: true });
  assert.equal(on.headers.get('cache-control'), 'no-store');
  const off = await call('/api/gemini/status', { env: {} });
  assert.deepEqual(await off.json(), { configured: false });
  assert.equal(upstream.length, 0);
});

test('models is proxied with the key in a header, never in the URL', async () => {
  const res = await call('/api/gemini/models');
  assert.equal(res.status, 200);
  assert.equal(upstream.length, 1);
  assert.equal(upstream[0].url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100');
  assert.equal(new Headers(upstream[0].init.headers).get('x-goog-api-key'), KEY);
  assert.ok(!upstream[0].url.includes(KEY));
});

test('generateContent forwards the body and passes Google\'s status and JSON through', async () => {
  const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
  upstream = [];
  reply = { status: 429, body: { error: { code: 429, message: 'Resource exhausted' } } };
  const res = await onRequest({ request: new Request(ORIGIN + GENERATE, { method: 'POST', body }), env: { GEMINI_API_KEY: KEY }, params: {} });
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: { code: 429, message: 'Resource exhausted' } });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(upstream[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal(upstream[0].init.method, 'POST');
  assert.equal(new Headers(upstream[0].init.headers).get('x-goog-api-key'), KEY);
  assert.equal(Buffer.from(upstream[0].init.body).toString(), body);
});

test('model names are validated', async () => {
  for (const model of ['Gemini-2.5-flash', '-x', 'a_b', 'a%2Fb', 'a'.repeat(64), '']) {
    const res = await call(`/api/gemini/models/${model}:generateContent`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 400, model);
  }
  assert.equal((await call('/api/gemini/models/../status:generateContent', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await call(`/api/gemini/models/${'a'.repeat(63)}:generateContent`, { method: 'POST', body: '{}' })).status, 200);
});

test('other paths are 404 and wrong methods are 405', async () => {
  for (const path of ['/api/gemini', '/api/gemini/', '/api/gemini/other', '/api/gemini/models/gemini-2.5-flash:streamGenerateContent', '/api/gemini/models/gemini-2.5-flash']) {
    assert.equal((await call(path)).status, 404, path);
  }
  const post = await call('/api/gemini/status', { method: 'POST', body: '{}' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  assert.equal((await call(GENERATE)).status, 405);
  assert.equal(upstream.length, 0);
});

test('bodies over 1 MB are refused before reaching Google', async () => {
  const big = await call(GENERATE, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal(big.status, 413);
  assert.equal(upstream.length, 0);
  assert.equal((await call(GENERATE, { method: 'POST', body: 'x'.repeat(1024 * 1024) })).status, 200);
});

test('without GEMINI_API_KEY the proxy answers 503 {configured:false}', async () => {
  for (const [path, method] of [['/api/gemini/models', 'GET'], [GENERATE, 'POST']]) {
    const res = await call(path, { method, body: method === 'POST' ? '{}' : undefined, env: {} });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).configured, false);
  }
  assert.equal(upstream.length, 0);
});

test('a network failure reaching Google is a 502', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('network down'); };
  try {
    assert.equal((await call('/api/gemini/models')).status, 502);
  } finally {
    globalThis.fetch = saved;
  }
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   ${t.name}`); }
  catch (err) { failed++; console.log(`FAIL ${t.name}\n     ${String(err && err.stack || err).split('\n').slice(0, 5).join('\n     ')}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
