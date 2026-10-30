/**
 * Ask AI server proxy: the dashboard's chat panel talks to four AI providers through this one route, using
 * keys kept on the server as Cloudflare Pages secrets (never in this repo, never sent to the browser):
 *   wrangler pages secret put ANTHROPIC_API_KEY    Anthropic (paid)
 *   wrangler pages secret put OPENAI_API_KEY       ChatGPT (paid)
 *   wrangler pages secret put GROQ_API_KEY         Groq (free tier)
 *   wrangler pages secret put OPENROUTER_API_KEY   OpenRouter (free models only)
 * Any one is enough; providers without a key show as "not set up". The password gate in
 * functions/_middleware.js runs first, so only signed-in users reach these routes:
 *   GET  /api/ai/status -> {hosted:true, providers:[{id, name, tier:'paid'|'free', configured, models[],
 *                           defaultModel, modelLabels, dataNotice, termsUrl, secret}]}
 *   POST /api/ai/chat   -> body {provider, model, system, messages, tools, final}; returns one model turn,
 *                           normalized: {provider, model, dialect, stop:'end'|'tool_use'|'max_tokens'|'refusal',
 *                           text, toolCalls:[{id, name, input, invalid}], message, usage}
 * The page runs the tools itself (KPI_TOOLS in index.html) and sends the results back in the next request.
 * `messages` are in the provider's own dialect: Anthropic content blocks (tool_use / tool_result) for Anthropic,
 * OpenAI chat messages (tool_calls / role "tool") for ChatGPT, Groq and OpenRouter. `message` in the reply is
 * the assistant turn to append to that history unchanged (Anthropic thinking blocks must be sent back as-is, and
 * the system prompt and tools must stay the same for the whole chat: the Anthropic API checks earlier turns are unchanged).
 * Errors are {error:{code, message}} with a plain-English message; upstream auth errors and keys are never echoed.
 * Paid providers are capped per session per minute and per site per day (spendingCap; 429 rate_limited).
 * Docs: docs/AI_ASSISTANT.md.
 */
const MAX_BODY_BYTES = 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 95 * 1000; // Cloudflare closes a request that waits more than 100 s
const MODELS_TIMEOUT_MS = 4000;
const MODELS_TTL_MS = 60 * 60 * 1000;
const MAX_MESSAGES = 400;
const MAX_TOOLS = 16;
// Longest answer per model turn, in tokens (thinking / reasoning included). Free tiers count this against a few
// thousand tokens per minute, so they get less room; a short data answer fits easily.
const MAX_OUTPUT_TOKENS = 16000;
const ANTHROPIC_VERSION = '2023-06-01';
// Opus / Sonnet: if a safety classifier declines a question, Anthropic re-runs it on its recommended
// fallback model in the same call.
const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// Anthropic thinking blocks are tied to the conversation before them. The page only ever appends to a chat, but if
// an earlier turn ever differs, the model drops the old thinking for that request instead of refusing it.
// If the account rejects either beta, the request is sent again once without both.
const ANTHROPIC_BINDING_BETA = 'thinking-binding-controls-2026-08-01';
// Spending cap for the paid providers (Anthropic, ChatGPT), counted in Workers KV (REPORT_STORE) before each call:
// at most AI_PER_MINUTE requests a minute per signed-in session, and AI_DAILY_REQUESTS (a Pages variable or
// secret, default 300) a day per provider for the whole site. A question is one request per model turn (up to 8).
const AI_PER_MINUTE = 15;
const AI_DAILY_DEFAULT = 300;
const SESSION_COOKIE = '__Host-spyder_kpi_session'; // set by functions/_middleware.js

// Per provider: where to call, which secret holds the key, which models may be used, and what the data terms
// mean in plain English, in one or two short sentences (shown in the panel above the consent tick, which says what
// is sent).
const PROVIDERS = [
  {
    id: 'anthropic', name: 'Anthropic', short: 'Anthropic', tier: 'paid', dialect: 'anthropic', secret: 'ANTHROPIC_API_KEY',
    base: 'https://api.anthropic.com/v1',
    // Current Anthropic models only; the list is fixed so the cost per question stays predictable.
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    defaultModel: 'claude-opus-5-5',
    labels: { 'claude-opus-5-5': 'Opus 5.5 (most capable)', 'claude-sonnet-5-5': 'Sonnet 5.5 (faster, about half the cost)', 'claude-haiku-5-5': 'Haiku 5.5 (fastest, lowest cost)' },
    fallbackModels: ['claude-opus-5-5', 'claude-sonnet-5-5'],
    termsUrl: 'https://www.anthropic.com/legal/commercial-terms',
    dataNotice: 'Billed to Spyder Controls. Anthropic does not train on this data and keeps it for a limited time for safety checks.',
  },
  {
    id: 'openai', name: 'ChatGPT (OpenAI)', short: 'ChatGPT', tier: 'paid', dialect: 'openai', secret: 'OPENAI_API_KEY',
    base: 'https://api.openai.com/v1', maxTokensField: 'max_completion_tokens',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini'],
    // Newer models in these families appear automatically when OpenAI lists them (no dated snapshots, no pro tier).
    family: /^gpt-(4\.1|[5-9](\.\d+)?)(-mini|-nano)?$/,
    termsUrl: 'https://openai.com/policies/business-terms/',
    dataNotice: 'Billed to Spyder Controls. OpenAI does not train on this data by default and may keep it up to 30 days for abuse checks.',
  },
  {
    id: 'groq', name: 'Groq', short: 'Groq', tier: 'free', dialect: 'openai', secret: 'GROQ_API_KEY',
    base: 'https://api.groq.com/openai/v1', maxTokensField: 'max_completion_tokens', maxOutput: 2048,
    models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'],
    family: /^(openai\/gpt-oss-\d+b|llama-3\.3-70b-versatile|llama-3\.1-8b-instant|meta-llama\/llama-4-[\w.-]+|moonshotai\/kimi-k2[\w.-]*|qwen\/qwen3-[\w.-]+)$/,
    exclude: /guard|whisper|tts|playai|safeguard/i,
    termsUrl: 'https://groq.com/privacy-policy/',
    dataNotice: 'Free, with tight limits. Groq says it does not train on this data, but free terms can change: send only data Spyder Controls may share.',
  },
  {
    id: 'openrouter', name: 'OpenRouter (free models)', short: 'OpenRouter', tier: 'free', dialect: 'openai', secret: 'OPENROUTER_API_KEY',
    base: 'https://openrouter.ai/api/v1', maxTokensField: 'max_tokens', maxOutput: 4096, freeOnly: true,
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-20b:free', 'deepseek/deepseek-chat-v3.1:free', 'qwen/qwen3-coder:free', 'mistralai/mistral-small-3.2-24b-instruct:free'],
    termsUrl: 'https://openrouter.ai/privacy',
    dataNotice: 'Free models. The outside providers that host them may keep, train on or publish what you send: treat it as public.',
  },
];
const byId = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));
const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MODEL_ID_RE = /^[a-zA-Z0-9][\w.:/-]{0,127}$/;
const FREE_ID_RE = /^[a-z0-9][\w.-]*\/[\w.-]+:free$/i;

// Model lists fetched from each provider's /models, kept per Worker instance for an hour.
const modelCache = new Map();
export function resetModelCache() { modelCache.clear(); }

export async function onRequest(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/^\/api\/ai\/?/, '');
  const method = path === 'status' ? 'GET' : path === 'chat' ? 'POST' : null;
  if (!method) return json(404, { error: { code: 'not_found', message: 'Not found.' } });
  if (request.method !== method) return json(405, { error: { code: 'method', message: `Use ${method}.` } }, { Allow: method });
  return path === 'status' ? status(env) : chat(request, env);
}

async function status(env) {
  const providers = await Promise.all(PROVIDERS.map(async (p) => {
    const configured = Boolean(keyOf(p, env));
    const models = configured ? (await modelList(p, env)).models : [];
    return {
      id: p.id, name: p.name, short: p.short, tier: p.tier, configured, models,
      defaultModel: configured ? pickDefault(p, models) : '',
      modelLabels: p.labels || {}, dataNotice: p.dataNotice, termsUrl: p.termsUrl, secret: p.secret,
    };
  }));
  return json(200, { hosted: true, configured: providers.some((p) => p.configured), providers });
}

async function chat(request, env) {
  // The session cookie is SameSite=Lax; only the dashboard page itself may spend the site's AI keys.
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json(403, { error: { code: 'origin', message: 'Cross-site request refused.' } });
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return tooLarge();
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) return tooLarge();
  let body;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch (err) { return bad('The request was not valid JSON.'); }
  if (!body || typeof body !== 'object') return bad('The request was not valid JSON.');

  const p = byId[body.provider];
  if (!p) return bad('Unknown AI provider.');
  const key = keyOf(p, env);
  if (!key) return json(503, { configured: false, error: { code: 'not_configured', message: `${p.short} is not set up on this site (${p.secret} is missing).` } });
  const model = String(body.model || '');
  if (!(await modelAllowed(p, env, model))) return json(400, { error: { code: 'model_not_allowed', message: `${model ? `"${model.slice(0, 80)}"` : 'That model'} is not one of the ${p.short} models this site allows. Pick another model in Settings.` } });

  const checked = checkConversation(p, body);
  if (checked.error) return bad(checked.error);
  const { system, messages, tools } = checked;
  const final = body.final === true;
  const capped = await spendingCap(request, env, p);
  if (capped) return capped;

  if (p.dialect === 'anthropic') {
    // Plain Messages API request: thinking is adaptive by default on these models (it cannot be turned off and
    // never takes a temperature); medium effort suits short data questions; forced tool use is not allowed, so
    // the last round uses tool_choice "none" instead.
    const req = {
      model, max_tokens: MAX_OUTPUT_TOKENS, messages,
      output_config: { effort: 'medium' },
      // Caches the stable prefix (tools, system prompt, earlier turns) so the tool loop re-reads it cheaply.
      cache_control: { type: 'ephemeral' },
    };
    if (system) req.system = system;
    if (tools.length) {
      req.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: schemaOf(t) }));
      if (final) req.tool_choice = { type: 'none' };
    }
    const fallback = p.fallbackModels.includes(model);
    const betas = [...(fallback ? [ANTHROPIC_FALLBACK_BETA] : []), ANTHROPIC_BINDING_BETA];
    const withBetas = { ...req, thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }, ...(fallback ? { fallbacks: 'default' } : {}) };
    let up = await callAnthropic(p, key, withBetas, betas);
    // An account that does not accept a beta answers 400 naming it: send the plain request once.
    if (up.status === 400 && /anthropic-beta|\bbetas?\b|\bfallbacks\b|block_binding/i.test(up.message)) up = await callAnthropic(p, key, req, []);
    if (up.error) return up.error;
    return json(200, normalizeAnthropic(p, model, up.data));
  }

  const req = { model, messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages], [p.maxTokensField]: p.maxOutput || MAX_OUTPUT_TOKENS };
  if (tools.length) {
    req.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: schemaOf(t) } }));
    req.tool_choice = final ? 'none' : 'auto';
  }
  const up = await upstream(p, key, `${p.base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(req) });
  if (up.error) return up.error;
  return json(200, normalizeOpenAi(p, model, up.data));
}

// --- Request checks -------------------------------------------------------------------------------------
// Only the shapes the panel sends are accepted: the system prompt and tools come in their own fields, and the
// history holds user / assistant turns (plus tool results in each dialect's own form).
function checkConversation(p, body) {
  const system = body.system === undefined ? '' : body.system;
  if (typeof system !== 'string' || system.length > 20000) return { error: 'The system prompt must be text under 20,000 characters.' };
  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return { error: `Send 1 to ${MAX_MESSAGES} messages.` };
  const roles = p.dialect === 'anthropic' ? ['user', 'assistant'] : ['user', 'assistant', 'tool'];
  for (const m of messages) {
    if (!m || typeof m !== 'object' || !roles.includes(m.role)) return { error: `Each message needs a role of ${roles.join(', ')}.` };
    if (p.dialect === 'anthropic' && !(typeof m.content === 'string' || Array.isArray(m.content))) return { error: 'Each Anthropic message needs text or content blocks.' };
    // The page's own turns are plain text and tool results; no images, files or links for the provider to fetch.
    // (Assistant turns are passed back as the provider sent them.)
    if (m.role !== 'assistant' && !userContentOk(p, m.content)) return { error: 'Questions and tool results must be plain text.' };
  }
  if (messages[0].role !== 'user') return { error: 'The conversation must start with a question.' };
  const tools = body.tools === undefined ? [] : body.tools;
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) return { error: `Send at most ${MAX_TOOLS} tools.` };
  for (const t of tools) {
    if (!t || !NAME_RE.test(String(t.name || '')) || typeof t.description !== 'string' || t.description.length > 4000) return { error: 'Each tool needs a name (letters, digits, _ or -) and a description.' };
    if (t.parameters !== undefined && (!t.parameters || typeof t.parameters !== 'object' || Array.isArray(t.parameters))) return { error: `Tool ${t.name} has bad parameters.` };
  }
  return { system, messages, tools };
}

// Counts this request against the paid providers' caps; returns a 429 Response when a cap is reached, else null.
// One KV key per provider and day, 'ai:day:<provider>:<yyyy-mm-dd>' = {n: requests today, m: current minute,
// s: {session: requests this minute}}, holds both counts, so a request costs one KV read and one write. KV is not
// atomic, so this is a soft cap (the provider console's spend limit stays the backstop); if KV cannot be read or
// written the question goes through. Without REPORT_STORE nothing is counted.
async function spendingCap(request, env, p) {
  const store = env && env.REPORT_STORE;
  if (p.tier !== 'paid' || !store) return null;
  const now = new Date();
  const stamp = now.toISOString();
  const key = `ai:day:${p.id}:${stamp.slice(0, 10)}`;
  const minute = stamp.slice(0, 16);
  let doc = null;
  try { doc = await store.get(key, { type: 'json' }); } catch (err) { doc = null; }
  const today = Number(doc && doc.n) || 0;
  const sessions = doc && doc.m === minute && doc.s && typeof doc.s === 'object' && !Array.isArray(doc.s) ? doc.s : {};
  const who = await sessionId(request);
  const mine = Number(sessions[who]) || 0;
  const set = String(env.AI_DAILY_REQUESTS ?? '').trim();
  const daily = set === '' ? NaN : Math.floor(Number(set));
  if (today >= (Number.isFinite(daily) && daily >= 0 ? daily : AI_DAILY_DEFAULT)) {
    const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return json(429, { error: { code: 'rate_limited', message: `Daily Ask AI limit reached for this site; try again tomorrow or use a free provider.` } }, { 'Retry-After': String(Math.max(60, Math.ceil((tomorrow - now.getTime()) / 1000))) });
  }
  if (mine >= AI_PER_MINUTE) return json(429, { error: { code: 'rate_limited', message: `Too many Ask AI requests from this browser in the last minute (at most ${AI_PER_MINUTE}). Wait a minute and try again.` } }, { 'Retry-After': '60' });
  try { await store.put(key, JSON.stringify({ n: today + 1, m: minute, s: { ...sessions, [who]: mine + 1 } }), { expirationTtl: 2 * 86400 }); } catch (err) { /* soft cap */ }
  return null;
}

// A short, one-way id of the sign-in session (from its cookie), so the per-minute count is per browser session.
async function sessionId(request) {
  let cookie = '';
  for (const part of String(request.headers.get('Cookie') || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE) cookie = rest.join('=');
  }
  const basis = cookie || `ip:${request.headers.get('CF-Connecting-IP') || ''}`;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(basis)));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function userContentOk(p, content) {
  if (typeof content === 'string') return true;
  if (p.dialect !== 'anthropic' || !Array.isArray(content)) return false;
  const textOnly = (c) => typeof c === 'string' || (Array.isArray(c) && c.every((b) => b && b.type === 'text' && typeof b.text === 'string'));
  return content.every((b) => b && ((b.type === 'text' && typeof b.text === 'string') || (b.type === 'tool_result' && typeof b.tool_use_id === 'string' && (b.content === undefined || textOnly(b.content)))));
}

// A JSON schema for the tool's arguments; an empty "required" list is left out (some hosts reject it).
function schemaOf(t) {
  const p = t.parameters && typeof t.parameters === 'object' ? t.parameters : {};
  const out = { type: 'object', properties: p.properties && typeof p.properties === 'object' ? p.properties : {} };
  if (Array.isArray(p.required) && p.required.length) out.required = p.required;
  return out;
}

// --- Models ---------------------------------------------------------------------------------------------
async function modelList(p, env) {
  if (!p.family && !p.freeOnly) return { models: p.models, fetched: false };
  const hit = modelCache.get(p.id);
  if (hit && Date.now() - hit.at < MODELS_TTL_MS) return hit;
  let fetched = null;
  try {
    const res = await fetch(`${p.base}/models`, { headers: { authorization: `Bearer ${keyOf(p, env)}` }, signal: AbortSignal.timeout(MODELS_TIMEOUT_MS) });
    if (res.ok) fetched = (await res.json()).data;
  } catch (err) { /* keep the built-in list */ }
  if (!Array.isArray(fetched)) return { models: p.models, fetched: false };
  const ids = fetched.filter((m) => m && typeof m.id === 'string' && MODEL_ID_RE.test(m.id)).filter((m) => (p.freeOnly
    ? m.id.endsWith(':free') && Number(m.pricing && m.pricing.prompt) === 0 && Number(m.pricing && m.pricing.completion) === 0
      && (!Array.isArray(m.supported_parameters) || m.supported_parameters.includes('tools'))
    : p.family.test(m.id) && !(p.exclude && p.exclude.test(m.id)) && m.active !== false)).map((m) => m.id);
  // Known models first in their usual order, then anything new (newest version first), at most 40.
  const known = p.models.filter((id) => ids.includes(id));
  const extra = ids.filter((id) => !known.includes(id)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  const entry = { models: [...known, ...extra].slice(0, 40), fetched: true, at: Date.now() };
  if (!entry.models.length) return { models: p.models, fetched: false };
  modelCache.set(p.id, entry);
  return entry;
}

function pickDefault(p, models) {
  if (p.defaultModel && models.includes(p.defaultModel)) return p.defaultModel;
  return models[0] || '';
}

// The allowlist: Anthropic's fixed list; for the others the listed models plus their families (OpenAI, Groq);
// OpenRouter only ever free (":free") models, checked against its price list when that could be read.
async function modelAllowed(p, env, model) {
  if (!MODEL_ID_RE.test(model)) return false;
  if (!p.family && !p.freeOnly) return p.models.includes(model);
  const list = await modelList(p, env);
  if (list.models.includes(model)) return true;
  if (p.freeOnly) return !list.fetched && FREE_ID_RE.test(model);
  return p.family.test(model) && !(p.exclude && p.exclude.test(model));
}

function keyOf(p, env) { return String((env && env[p.secret]) || '').trim(); }

// --- Upstream calls -------------------------------------------------------------------------------------
function callAnthropic(p, key, req, betas) {
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION };
  if (betas.length) headers['anthropic-beta'] = betas.join(',');
  return upstream(p, key, `${p.base}/messages`, { method: 'POST', headers, body: JSON.stringify(req) });
}

// Returns {data} on success, or {error: Response, status, message} with a plain-English error for the page.
async function upstream(p, key, url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (err) {
    const timeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return fail(timeout ? 504 : 502, timeout ? 'timeout' : 'unreachable', timeout ? `${p.short} took too long to answer. Try a narrower question or a faster model.` : `Could not reach ${p.short}. Try again in a moment.`);
  }
  let data = null;
  try { data = await res.json(); } catch (err) { /* not JSON */ }
  if (res.ok && data && typeof data === 'object') return { data };
  const detail = clean(upstreamMessage(data), key);
  const s = res.status;
  // Auth failures never pass the provider's text through (it can name or echo the key).
  if (s === 401 || s === 403) return fail(502, 'provider_auth', `The site's ${p.short} key was rejected. Ask whoever runs this site to check the ${p.secret} secret.`, s);
  if (s === 402) return fail(402, 'billing', `The ${p.short} account behind this site is out of credit or has a billing problem. Ask whoever runs this site to check it.`, s);
  if (s === 429) return fail(429, 'rate_limited', p.tier === 'free' ? `${p.short}'s free limit was reached (requests or tokens per minute or per day). Wait a minute and try again, or ask a narrower question.` : `${p.short} is getting too many requests right now. Wait a minute and try again.`, s);
  if (s === 413 || /too large|too long|context length|context window|maximum context|tokens per minute/i.test(detail)) return fail(413, 'too_large', `The question and its data were too large for ${p.short}${p.tier === 'free' ? '\'s free tier' : ''}. Clear the chat and ask a narrower question${p.tier === 'free' ? ', or pick a paid provider' : ''}.`, s);
  // OpenRouter answers 404 both for a model whose free hosts cannot use tools and for one the account's data policy
  // (privacy settings) rules out; they need different fixes.
  const why = /support tool|tools? (are |is )?not supported|tool use/i.test(detail) ? ' because that model cannot look up dashboard data (no tool support)'
    : /data policy|privacy/i.test(detail) ? ' with this account\'s privacy settings' : '';
  if (s === 404) return fail(404, 'model_unavailable', `${p.short} could not use that model${why}. Pick another model in Settings.${detail ? ` (${detail})` : ''}`, s);
  if (s >= 500 || !res.ok && s < 400) return fail(502, 'provider_down', `${p.short} is busy or unavailable right now (error ${s}). Try again in a moment.`, s);
  if (res.ok) return fail(502, 'bad_reply', `${p.short} sent an answer this page could not read. Try again.`, s);
  return fail(s === 400 || s === 422 ? 400 : 502, 'provider_error', `${p.short} could not answer (error ${s}${detail ? `: ${detail}` : ''}).`, s, detail);
}

function fail(status, code, message, upstreamStatus = 0, detail = '') {
  return { error: json(status, { error: { code, message, upstreamStatus } }), status: upstreamStatus, message: `${message} ${detail}` };
}

function upstreamMessage(data) {
  const e = data && data.error;
  if (typeof e === 'string') return e;
  if (e && typeof e.message === 'string') return e.message;
  return '';
}

// Provider error text, shortened, with anything that looks like a key removed.
function clean(text, key) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if (key) s = s.split(key).join('[key]');
  return s.replace(/\b(sk-ant-|sk-or-|sk-proj-|sk-|gsk_)[\w-]{4,}/g, '[key]').slice(0, 200);
}

// --- Responses ------------------------------------------------------------------------------------------
function normalizeAnthropic(p, model, data) {
  let content = Array.isArray(data.content) ? data.content.filter((b) => b && typeof b === 'object') : [];
  // After a server-side fallback, only text may be kept from before the last "fallback" marker: the declined
  // model's thinking and tool calls must not be sent back (and its tool calls are not run).
  const cut = content.map((b) => b.type).lastIndexOf('fallback');
  if (cut > 0) content = [...content.slice(0, cut).filter((b) => b.type === 'text'), ...content.slice(cut)];
  const text = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('').trim();
  const toolCalls = content.filter((b) => b && b.type === 'tool_use').map((b) => ({ id: String(b.id || ''), name: String(b.name || ''), input: b.input && typeof b.input === 'object' ? b.input : {} }));
  const r = data.stop_reason;
  const stop = r === 'refusal' ? 'refusal' : r === 'max_tokens' || r === 'model_context_window_exceeded' ? 'max_tokens' : toolCalls.length ? 'tool_use' : 'end';
  return {
    provider: p.id, model: String(data.model || model), dialect: 'anthropic', stop, text, toolCalls,
    // Sent back unchanged in the next request (thinking blocks and their signatures included).
    message: { role: 'assistant', content },
    usage: { input: num(data.usage && data.usage.input_tokens) + num(data.usage && data.usage.cache_read_input_tokens) + num(data.usage && data.usage.cache_creation_input_tokens), output: num(data.usage && data.usage.output_tokens) },
  };
}

function normalizeOpenAi(p, model, data) {
  const choice = Array.isArray(data.choices) && data.choices[0] || {};
  const m = choice.message || {};
  const text = typeof m.content === 'string' ? m.content.trim() : Array.isArray(m.content) ? m.content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('').trim() : '';
  const calls = (Array.isArray(m.tool_calls) ? m.tool_calls : []).filter((c) => c && c.function && typeof c.function.name === 'string');
  const toolCalls = calls.map((c, i) => {
    const id = String(c.id || `call_${i + 1}`);
    let input = {};
    let invalid = false;
    const args = c.function.arguments;
    if (args && typeof args === 'object') input = args;
    else if (String(args || '').trim()) { try { input = JSON.parse(args); } catch (err) { invalid = true; } }
    if (!input || typeof input !== 'object' || Array.isArray(input)) { input = {}; invalid = true; }
    return { id, name: c.function.name, input, ...(invalid ? { invalid: true } : {}) };
  });
  const f = choice.finish_reason;
  const stop = (typeof m.refusal === 'string' && m.refusal) || f === 'content_filter' ? 'refusal' : f === 'length' ? 'max_tokens' : toolCalls.length ? 'tool_use' : 'end';
  // Only the fields every OpenAI-style host accepts back: no reasoning text, annotations or provider extras.
  const message = toolCalls.length
    ? { role: 'assistant', content: text || null, tool_calls: toolCalls.map((c, i) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof calls[i].function.arguments === 'string' ? calls[i].function.arguments : JSON.stringify(c.input) } })) }
    : { role: 'assistant', content: text };
  return {
    provider: p.id, model: String(data.model || model), dialect: 'openai', stop, text: stop === 'refusal' && !text ? String(m.refusal || '') : text, toolCalls, message,
    usage: { input: num(data.usage && data.usage.prompt_tokens), output: num(data.usage && data.usage.completion_tokens) },
  };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function bad(message) { return json(400, { error: { code: 'bad_request', message } }); }

function tooLarge() {
  return json(413, { error: { code: 'too_large', message: 'The question and its data are larger than 1 MB. Clear the chat and ask a narrower question.' } });
}

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
  });
}
