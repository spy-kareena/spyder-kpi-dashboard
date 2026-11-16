/**
 * Sign-in gate for the hosted dashboard. Two layers, each turned on by Pages secrets (never stored in this repo):
 *
 * Cloudflare Access (docs/ACCESS.md): a Cloudflare Access application signs people in (one-time PIN by email, or the
 * company's Microsoft / Google sign-in) before a request reaches this code. On when both are set:
 *   ACCESS_TEAM_DOMAIN   the Zero Trust team domain: "spyder", "spyder.cloudflareaccess.com" or "https://spyder.cloudflareaccess.com"
 *   ACCESS_AUD           the Access application's Audience (AUD) tag; several may be given, separated by commas
 * Every request must then carry a valid Access token (the Cf-Access-Jwt-Assertion header Access adds, else the
 * CF_Authorization cookie): signed RS256 with one of the team's keys (<team>/cdn-cgi/access/certs), for one of these
 * audiences, issued by this team, not expired. Anything else gets a 403 page (a 401 JSON error under /api/), so a
 * hostname Access does not cover (such as a forgotten *.pages.dev address) shows nothing.
 *
 * Shared password (the original gate): on while DASHBOARD_PASSWORD is set.
 *   wrangler pages secret put DASHBOARD_PASSWORD   (the shared sign-in password)
 *   wrangler pages secret put SESSION_SECRET       (32+ random characters; signs sign-in sessions)
 * Changing either one signs everyone out.
 *
 * Access only: no password page. Both: an Access token and a password session (while moving from one to the other).
 * Password only: as before Access. Neither, or only half of the Access pair: every request gets a 500 "not configured".
 * The functions after this one get who is signed in as context.data.user: {email, name, via:'access'} for a person,
 * {service, via:'access-service'} for an Access service token, {via:'password'} for the shared password (no name).
 * context.data.auth is {access, password}: which layers are on (GET /api/me reports both).
 */
const COOKIE_NAME = '__Host-spyder_kpi_session';
// Cookie set by version 1v0 (it held a hash of the password); cleared on sign-in and sign-out.
const LEGACY_COOKIE_NAME = 'spyder_kpi_auth';
const SESSION_DAYS = 14;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const FAILED_LOGIN_DELAY_MS = 1000;
// The only file served without a password session: the logo on the sign-in page (it holds nothing private). The path
// must match exactly. A pattern such as "any file under /assets/" is not safe: Cloudflare Pages answers a path with no
// file behind it with index.html (its single-page-app fallback), so /assets/anything would hand out the whole app.
// If another public file is ever needed, add its exact path here. With Cloudflare Access on, it too needs the token.
const LOGO_PATH = '/assets/spyder-logo.png';
const PUBLIC_PATHS = new Set([LOGO_PATH]);
const encoder = new TextEncoder();

// Cloudflare Access: where the token is, and how the team's signing keys are kept. The keys are fetched from
// <team>/cdn-cgi/access/certs and kept in this isolate for an hour (Cloudflare publishes the next key before it
// rotates). A token signed with a key id not seen yet makes one fetch, at most one every KEYS_RETRY_MS, so made-up key
// ids cannot make this site hammer Cloudflare; a failed fetch keeps the keys already held.
const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';
const ACCESS_COOKIE = 'CF_Authorization';
const ACCESS_LOGOUT_PATH = '/cdn-cgi/access/logout'; // answered by Cloudflare Access itself: ends the Access session
const CLOCK_SKEW_SECONDS = 60;
const KEYS_TTL_MS = 60 * 60 * 1000;
const KEYS_RETRY_MS = 10 * 1000;
const KEYS_TIMEOUT_MS = 5000;
const MAX_TOKEN_LENGTH = 16 * 1024;
const RSA_ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const accessKeys = new Map(); // team origin -> {keys: Map(kid -> CryptoKey), fetchedAt, triedAt, failedAt, kidAt}
const NAME_MAX = 40; // a name made from an email address, as long as functions/api/notes.js and people.js take

// For tests: forget the signing keys fetched so far.
export function resetAccessKeys() { accessKeys.clear(); }

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const access = accessConfig(env);
  const password = String(env.DASHBOARD_PASSWORD || '');
  const sessionSecret = String(env.SESSION_SECRET || '');

  if (access.error) return notConfigured(access.error);
  // Without a separate secret, anyone could test password guesses by forging session cookies, so fail closed.
  if (password && !sessionSecret) {
    return notConfigured('Dashboard sign-in is not configured: DASHBOARD_PASSWORD is set but SESSION_SECRET is not. Set SESSION_SECRET, or remove DASHBOARD_PASSWORD to sign in through Cloudflare Access alone.');
  }
  if (!access.on && !password) {
    return notConfigured('Dashboard sign-in is not configured: set ACCESS_TEAM_DOMAIN and ACCESS_AUD to sign in through Cloudflare Access (docs/ACCESS.md), or the DASHBOARD_PASSWORD and SESSION_SECRET secrets for the shared password.');
  }
  // Pages hands the same context.data to every function after this one.
  if (!context.data || typeof context.data !== 'object') context.data = {};
  const data = context.data;
  data.auth = { access: access.on, password: Boolean(password) };

  // With Access on, every path needs the token, the logo and /logout included: Access sits in front of the whole site.
  if (access.on) {
    const user = await accessUser(request, access);
    if (!user) return accessRefused(url);
    data.user = user;
  }

  if (!password) {
    if (url.pathname === '/logout') return signOut(url, access.on);
    return withSecurityHeaders(await next());
  }

  // Both values key the session signature, so changing the password also signs everyone out.
  const secret = `${sessionSecret}\u0000${password}`;

  if ((request.method === 'GET' || request.method === 'HEAD') && PUBLIC_PATHS.has(url.pathname)) {
    return withSecurityHeaders(await next());
  }

  if (url.pathname === '/logout') {
    return signOut(url, access.on);
  }

  if (request.method === 'POST' && url.pathname === '/login') {
    let submitted = '';
    try {
      submitted = String((await request.formData()).get('password') || '');
    } catch (err) {
      return loginPage(true, 400);
    }
    if (await sameSecret(submitted, password)) {
      return redirectWithCookie(url.origin + '/', await issueSession(secret));
    }
    // Slows password guessing; a Cloudflare rate-limiting rule on POST /login or Cloudflare Access is stronger.
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
    return loginPage(true, 401);
  }

  const cookie = readCookie(request.headers.get('Cookie') || '', COOKIE_NAME);
  if (cookie && await validSession(cookie, secret)) {
    if (!data.user) data.user = { via: 'password' };
    return withSecurityHeaders(await next());
  }

  // The page's background calls (Ask AI's /api/ai/*, the shared report) need a status they can read, not a 200 sign-in form.
  if (url.pathname.startsWith('/api/')) return signInExpired();
  return loginPage(false);
}

function notConfigured(message) {
  return new Response(message, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

function signInExpired() {
  return new Response(JSON.stringify({ error: { code: 401, message: 'Your sign-in to this site has expired. Reload the page and sign in again.' } }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

// Sign out: the password session is cleared (as before Access); with Access on, Cloudflare's own sign-out page then
// ends the Access session too, else the browser goes back to the sign-in page.
function signOut(url, accessOn) {
  return redirectWithCookie(url.origin + (accessOn ? ACCESS_LOGOUT_PATH : '/'), '');
}

// {on:false} when neither Access setting is set, {on:true, team, auds} when both are, else {error} (fail closed: a
// half-done setup must not quietly leave the token unchecked).
function accessConfig(env) {
  const rawTeam = String(env.ACCESS_TEAM_DOMAIN || '').trim();
  const auds = String(env.ACCESS_AUD || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!rawTeam && !auds.length) return { on: false };
  if (!auds.length) return { error: 'Dashboard sign-in is not configured: ACCESS_TEAM_DOMAIN is set but ACCESS_AUD is not. Set both for Cloudflare Access (docs/ACCESS.md), or remove ACCESS_TEAM_DOMAIN.' };
  if (!rawTeam) return { error: 'Dashboard sign-in is not configured: ACCESS_AUD is set but ACCESS_TEAM_DOMAIN is not. Set both for Cloudflare Access (docs/ACCESS.md), or remove ACCESS_AUD.' };
  const team = teamOrigin(rawTeam);
  if (!team) return { error: 'Dashboard sign-in is not configured: ACCESS_TEAM_DOMAIN must look like "spyder", "spyder.cloudflareaccess.com" or "https://spyder.cloudflareaccess.com".' };
  return { on: true, team, auds };
}

// "spyder", "spyder.cloudflareaccess.com" or "https://spyder.cloudflareaccess.com/" -> "https://spyder.cloudflareaccess.com";
// '' for anything else (another scheme, a path, a port).
export function teamOrigin(value) {
  let s = String(value || '').trim().toLowerCase().replace(/\/+$/, '');
  if (!s) return '';
  if (!s.includes('://')) s = 'https://' + (s.includes('.') ? s : `${s}.cloudflareaccess.com`);
  let u;
  try { u = new URL(s); } catch (err) { return ''; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) return '';
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(u.hostname) ? u.origin : '';
}

// Who the request's Access token names: {email, name, via:'access'} for a person, {service, via:'access-service'} for
// an Access service token (no email, its client id in common_name); null when there is no valid token.
async function accessUser(request, access) {
  const token = request.headers.get(ACCESS_HEADER) || readCookie(request.headers.get('Cookie') || '', ACCESS_COOKIE);
  const claims = await verifyAccessToken(token, access);
  if (!claims) return null;
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (email) return email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) ? { email, name: nameFromEmail(email), via: 'access' } : null;
  const service = typeof claims.common_name === 'string' ? claims.common_name.trim() : '';
  return service && service.length <= 200 ? { service, via: 'access-service' } : null;
}

// The token's claims when it is a JWT signed RS256 by one of the team's keys, for one of the audiences, issued by the
// team, and inside its time window (60 s of clock skew allowed); else null. The cheap claim checks come first, so a
// stale or foreign token never makes a key fetch.
async function verifyAccessToken(token, access) {
  try {
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = decodeJson(parts[0]);
    const claims = decodeJson(parts[1]);
    const signature = base64UrlDecode(parts[2]);
    if (!header || !claims || !signature || !signature.length) return null;
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;
    if (!claimsValid(claims, access)) return null;
    const key = await signingKey(access.team, header.kid);
    if (!key) return null;
    return await crypto.subtle.verify(RSA_ALGORITHM, key, signature, encoder.encode(`${parts[0]}.${parts[1]}`)) ? claims : null;
  } catch (err) {
    return null;
  }
}

function claimsValid(c, access) {
  const now = Date.now() / 1000;
  const audiences = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!audiences.some((a) => typeof a === 'string' && access.auds.includes(a))) return false;
  if (c.iss !== access.team) return false;
  if (typeof c.exp !== 'number' || !(c.exp + CLOCK_SKEW_SECONDS > now)) return false;
  for (const t of [c.nbf, c.iat]) {
    if (t !== undefined && !(typeof t === 'number' && t - CLOCK_SKEW_SECONDS <= now)) return false;
  }
  return true;
}

// The team's public key for this key id, or null. See KEYS_TTL_MS above for when the keys are fetched. Requests never
// wait on another request's fetch (Workers do not allow sharing I/O between requests), so a few requests at the very
// start may each fetch once.
async function signingKey(team, kid) {
  let entry = accessKeys.get(team);
  if (!entry) accessKeys.set(team, entry = { keys: new Map(), fetchedAt: 0, triedAt: 0, failedAt: 0, kidAt: 0 });
  const now = Date.now();
  let fetched = false;
  if (!entry.keys.size) {
    // Nothing held yet: fetch, unless a fetch failed moments ago (then refuse until it is worth trying again).
    if (now - entry.failedAt >= KEYS_RETRY_MS) { await loadKeys(team, entry); fetched = true; }
  } else if (now - entry.fetchedAt >= KEYS_TTL_MS && now - entry.triedAt >= KEYS_RETRY_MS) {
    // An hour old: fetch again (requests meanwhile keep using the keys held).
    await loadKeys(team, entry);
    fetched = true;
  }
  if (!fetched && entry.keys.size && !entry.keys.has(kid) && now - entry.kidAt >= KEYS_RETRY_MS) {
    // A key id not seen yet (Cloudflare rotated its keys): fetch once more, throttled.
    entry.kidAt = now;
    await loadKeys(team, entry);
  }
  return entry.keys.get(kid) || null;
}

async function loadKeys(team, entry) {
  entry.triedAt = Date.now();
  try {
    const keys = await fetchKeys(team);
    if (!keys.size) throw new Error('No usable signing keys.');
    entry.keys = keys;
    entry.fetchedAt = Date.now();
  } catch (err) {
    entry.failedAt = Date.now(); // the keys already held stay in use
  }
}

async function fetchKeys(team) {
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(KEYS_TIMEOUT_MS) : undefined;
  const res = await fetch(`${team}/cdn-cgi/access/certs`, { headers: { accept: 'application/json' }, signal });
  if (!res.ok) throw new Error(`Access keys: HTTP ${res.status}`);
  const body = await res.json();
  const list = body && Array.isArray(body.keys) ? body.keys.slice(0, 20) : [];
  const keys = new Map();
  for (const k of list) {
    if (!k || k.kty !== 'RSA' || typeof k.kid !== 'string' || !k.kid || typeof k.n !== 'string' || typeof k.e !== 'string') continue;
    if ((k.alg !== undefined && k.alg !== 'RS256') || (k.use !== undefined && k.use !== 'sig')) continue;
    try {
      keys.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, RSA_ALGORITHM, false, ['verify']));
    } catch (err) { /* not a usable RSA key: skipped */ }
  }
  return keys;
}

function decodeJson(part) {
  const bytes = base64UrlDecode(part);
  if (!bytes) return null;
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function base64UrlDecode(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// A display name from an email address: "aaron.joseph@x" -> "Aaron Joseph", "aaron@x" -> "Aaron". The part before
// the @ (and before any +tag) is split at . _ - and spaces; digits and other symbols are dropped; each word starts with a
// capital. '' when nothing is left (the page then asks for a name, as with the shared password).
export function nameFromEmail(email) {
  const local = String(email || '').split('@')[0].split('+')[0];
  const words = local.split(/[._\-\s]+/)
    .map((w) => w.replace(/[^\p{L}\p{M}']/gu, '').replace(/^'+|'+$/g, ''))
    .filter((w) => /\p{L}/u.test(w))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  let name = '';
  for (const w of words) {
    const next = name ? `${name} ${w}` : w;
    if (next.length > NAME_MAX) break;
    name = next;
  }
  return name;
}

// Session token: v1.<issued unix seconds>.<random nonce>.<HMAC-SHA256 of the first three parts>.
async function issueSession(secret) {
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const body = `v1.${Math.floor(Date.now() / 1000)}.${nonce}`;
  return `${body}.${await hmac(secret, body)}`;
}

async function validSession(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const age = Date.now() / 1000 - Number(parts[1]);
  if (!(age >= 0 && age <= SESSION_SECONDS)) return false;
  const expected = await hmac(secret, parts.slice(0, 3).join('.'));
  return constantTimeEqual(encoder.encode(expected), encoder.encode(parts[3]));
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

// Compares digests so neither the length nor the content of the password leaks through timing.
async function sameSecret(a, b) {
  const [left, right] = await Promise.all([a, b].map((v) => crypto.subtle.digest('SHA-256', encoder.encode(String(v)))));
  return constantTimeEqual(new Uint8Array(left), new Uint8Array(right));
}

function constantTimeEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < left.byteLength; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function base64Url(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readCookie(header, name) {
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join('='));
    } catch (err) {
      return '';
    }
  }
  return '';
}

function cookieHeader(value) {
  if (!value) {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  }
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

function redirectWithCookie(location, token) {
  const headers = new Headers({ Location: location, 'cache-control': 'no-store' });
  headers.append('Set-Cookie', cookieHeader(token));
  headers.append('Set-Cookie', `${LEGACY_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// The sign-in page uses the dashboard's look on a quiet "Sky" page: faint blue at the top fading to soft white (dark:
// deep blue to near-black), a white card (24px corners, light shadow), Outfit with a system-font fallback, the ink and indigo tokens, a
// pill field and a black pill button, and the logo from assets/ (served without a session above). Dark mode follows
// the system setting, or the theme saved in the dashboard's Settings (same origin, read by the small script in <head>).
// Motion is CSS transform / opacity only and is switched off for prefers-reduced-motion. The page has no
// Content-Security-Policy header, so the inline <style>, the two small inline scripts and Google Fonts load as they do
// in index.html. Without scripts the form still works; only the show-password toggle and the busy state are missing.
// A wrong password shows an inline error under the field and the card shakes once.
function loginPage(failed, status) {
  const error = !failed ? '' : status === 400
    ? 'The sign-in form could not be read. Try again.'
    : "That password didn't work. Try again.";
  const main = `<main class="card${error ? ' failed' : ''}">
    <img class="logo st" style="--i:0" src="${LOGO_PATH}" alt="Spyder Controls" width="150" height="31">
    <h1 class="st" style="--i:1">Sign in to the KPI dashboard</h1>
    <p class="lead st" style="--i:2">Enter the team password to see this week's order health, purchase orders and build risk.</p>
    <form method="post" action="/login">
      <label class="st" style="--i:3" for="password">Password</label>
      <div class="field st" style="--i:3">
        <input id="password" name="password" type="password" autocomplete="current-password" required autofocus${error ? ' aria-invalid="true" aria-describedby="password-error"' : ''}>
        <button class="reveal" type="button" aria-label="Show password" aria-pressed="false" aria-controls="password"><svg class="eye" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 10S4.8 4.2 10 4.2 18.2 10 18.2 10 15.2 15.8 10 15.8 1.8 10 1.8 10Z"/><circle cx="10" cy="10" r="2.6"/></svg><svg class="eye-off" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.2 4.4A8 8 0 0 1 10 4.2c5.2 0 8.2 5.8 8.2 5.8a14 14 0 0 1-2.3 3M12 15.5a7.6 7.6 0 0 1-2 .3c-5.2 0-8.2-5.8-8.2-5.8a14 14 0 0 1 3.2-3.8M8.2 8.2a2.6 2.6 0 0 0 3.6 3.6M2.5 2.5l15 15"/></svg></button>
      </div>
      ${error ? `<p class="error" id="password-error" role="alert"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.8v3.6M8 10.9v.1" stroke-linecap="round"/></svg>${error}</p>` : ''}
      <button class="submit st" style="--i:4" type="submit"><span class="label">Sign in<svg class="arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></span><span class="busy" aria-hidden="true"><span class="spin"></span>Signing in…</span></button>
      <p class="sr-only" id="signin-status" role="status"></p>
    </form>
  </main>`;
  const script = `<script>(function(){
    var form=document.querySelector('form'),input=document.getElementById('password'),reveal=document.querySelector('.reveal'),submit=document.querySelector('.submit'),status=document.getElementById('signin-status');
    reveal.addEventListener('click',function(){var show=input.type==='password';input.type=show?'text':'password';reveal.setAttribute('aria-pressed',String(show));input.focus();});
    form.addEventListener('submit',function(e){
      if(submit.classList.contains('is-busy')){e.preventDefault();return;}
      input.type='password';reveal.setAttribute('aria-pressed','false');
      submit.classList.add('is-busy');submit.setAttribute('aria-disabled','true');status.textContent='Signing in…';
    });
    // Back from the dashboard (page restored from the back/forward cache): the button is ready again
    addEventListener('pageshow',function(e){if(e.persisted){submit.classList.remove('is-busy');submit.removeAttribute('aria-disabled');status.textContent='';}});
  })();</script>`;
  // A page load without a session gets the form with 200; only a wrong password is an error status.
  return htmlPage(main, script, failed ? status : 200);
}

// Cloudflare Access is on and the request has no valid Access token (signed out, an expired Access session, or a
// hostname the Access application does not cover): the sign-in page's look with a plain message and a Reload link,
// 403. No logo: with Access on, the logo file needs the token too. Under /api/ the same 401 JSON as an expired session.
function accessRefused(url) {
  if (url.pathname.startsWith('/api/')) return signInExpired();
  const main = `<main class="card">
    <h1 class="st" style="--i:1">Sign in to the KPI dashboard</h1>
    <p class="lead st" style="--i:2">This board signs in through Cloudflare Access. Reload the page to sign in.</p>
    <a class="submit st" style="--i:3" href="${escapeHtml(url.pathname + url.search)}"><span class="label">Reload<svg class="arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></span></a>
  </main>`;
  return htmlPage(main, '', 403);
}

// The page around both: head, styles, background and footer.
function htmlPage(main, script, status) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>Sign in · Spyder KPI Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script>(function(){var d=document.documentElement;d.className='js';try{var t=(JSON.parse(localStorage.getItem('spyderKpiSettings')||'{}')||{}).theme;if(t==='dark'||t==='light')d.setAttribute('data-theme',t);}catch(e){}})();</script>
  <style>
    :root{--page:#eef3fb;--card:#fff;--card-line:rgba(15,30,50,.06);--ink-1:#0c1a2c;--ink-2:#2e4157;--ink-3:#41566c;--ink-4:#4d6379;
      --line:rgba(12,26,44,.08);--field:#f6f9fd;--field-line:#8293a5;--indigo:#4063f0;--indigo-rgb:64,99,240;
      --risk:#cb2348;--risk-bg:#fdeef1;--risk-line:rgba(203,35,72,.55);--btn:#0c1a2c;--btn-hover:#2e4157;--btn-fg:#fff;
      --sh-card:0 1px 2px rgba(15,30,50,.04),0 12px 32px -12px rgba(15,30,50,.10);--sh-btn:0 10px 22px -8px rgba(12,26,44,.45);
      --sky:linear-gradient(180deg,#d9e8fa 0%,#e7f0fb 30%,#f3f6fb 58%,#f6f5fb 80%,#f8f8fc 100%);--glow:rgba(255,255,255,.7);--logo-filter:none;
      --ease:cubic-bezier(.2,.8,.2,1);--font:'Outfit',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color-scheme:light}
    /* Dark tokens: the dashboard's dark page, card and inks; the primary button turns light, the logo is inverted */
    @media (prefers-color-scheme:dark){:root:not([data-theme=light]){--page:#111d2d;--card:#182c3e;--card-line:rgba(226,232,240,.08);--ink-1:#eff4f9;--ink-2:#d8e1e9;--ink-3:#bfcad6;--ink-4:#a1b0bf;
      --line:rgba(226,232,240,.13);--field:#14263a;--field-line:#6c8196;--indigo:#6993fa;--indigo-rgb:105,147,250;
      --risk:#ff8aa3;--risk-bg:#3b1824;--risk-line:rgba(255,138,163,.6);--btn:#eff4f9;--btn-hover:#d8e1e9;--btn-fg:#0c1a29;
      --sh-card:0 12px 32px -12px rgba(0,0,0,.5);--sh-btn:0 10px 22px -8px rgba(0,0,0,.7);
      --sky:linear-gradient(180deg,#1a3250 0%,#162840 30%,#111d2d 60%,#0f1724 100%);--glow:rgba(120,160,220,.10);--logo-filter:invert(1);color-scheme:dark}}
    :root[data-theme=dark]{--page:#111d2d;--card:#182c3e;--card-line:rgba(226,232,240,.08);--ink-1:#eff4f9;--ink-2:#d8e1e9;--ink-3:#bfcad6;--ink-4:#a1b0bf;
      --line:rgba(226,232,240,.13);--field:#14263a;--field-line:#6c8196;--indigo:#6993fa;--indigo-rgb:105,147,250;
      --risk:#ff8aa3;--risk-bg:#3b1824;--risk-line:rgba(255,138,163,.6);--btn:#eff4f9;--btn-hover:#d8e1e9;--btn-fg:#0c1a29;
      --sh-card:0 12px 32px -12px rgba(0,0,0,.5);--sh-btn:0 10px 22px -8px rgba(0,0,0,.7);
      --sky:linear-gradient(180deg,#1a3250 0%,#162840 30%,#111d2d 60%,#0f1724 100%);--glow:rgba(120,160,220,.10);--logo-filter:invert(1);color-scheme:dark}
    *{box-sizing:border-box;margin:0;padding:0}
    html{background:var(--page)}
    body{position:relative;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:32px 16px;
      font-family:var(--font);color:var(--ink-1);background:var(--sky) fixed;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overflow-x:hidden}
    /* Background ("Sky"): faint blue at the top fading to soft white, and one still white glow behind the card so it
       seems to float. Nothing moves here; the card's entrance and the focus glow are the only motion. */
    .bg{position:fixed;left:-10%;right:-10%;top:25%;height:70vh;z-index:0;pointer-events:none;background:radial-gradient(50% 50% at 50% 50%,var(--glow),transparent 100%);animation:fade 2s ease-out backwards}
    main,.foot{position:relative;z-index:1}
    .card{width:100%;max-width:404px;background:var(--card);border:1px solid var(--card-line);border-radius:24px;padding:36px 32px 32px;box-shadow:var(--sh-card);
      animation:rise .6s var(--ease) backwards}
    /* Each part of the card follows the card in, 60ms apart (--i is its place in the order) */
    .st{animation:up .6s var(--ease) backwards;animation-delay:calc(var(--i) * 60ms + 120ms)}
    @keyframes fade{from{opacity:0}}
    @keyframes rise{from{opacity:0;transform:translateY(22px) scale(.98)}}
    @keyframes up{from{opacity:0;transform:translateY(10px)}}
    /* The logo is a transparent PNG (black ink only) */
    .logo{display:block;width:150px;height:auto;margin:0 0 30px -2px;filter:var(--logo-filter)}
    h1{font-size:26px;font-weight:600;letter-spacing:-.02em;line-height:1.2;color:var(--ink-1)}
    .lead{margin-top:8px;font-size:14.5px;color:var(--ink-4);line-height:1.55}
    form{display:grid;margin-top:28px}
    label{font-size:13px;font-weight:500;color:var(--ink-3);margin:0 0 8px 4px}
    .field{position:relative}
    /* The focus glow is its own layer, so focusing fades and scales it in instead of repainting a shadow */
    .field::after{content:"";position:absolute;inset:-1px;border-radius:999px;pointer-events:none;opacity:0;transform:scale(.985);
      box-shadow:0 0 0 4px rgba(var(--indigo-rgb),.2),0 0 22px 2px rgba(var(--indigo-rgb),.22);transition:opacity .3s var(--ease),transform .3s var(--ease)}
    .field:focus-within::after{opacity:1;transform:none}
    #password{display:block;width:100%;height:50px;border:1px solid var(--field-line);border-radius:999px;padding:0 54px 0 20px;font:inherit;font-size:16px;color:var(--ink-1);
      background:var(--field);transition:border-color .2s,background-color .2s}
    #password:hover{border-color:var(--ink-4)}
    #password:focus{outline:none;border-color:var(--indigo);background:var(--card)}
    #password[aria-invalid="true"]{border-color:var(--risk-line)}
    #password[aria-invalid="true"]:focus{border-color:var(--indigo)}
    /* Show / hide password: only with scripts (html.js is set in <head>, so nothing moves when it appears) */
    .reveal{display:none;position:absolute;top:5px;right:5px;width:40px;height:40px;border:0;border-radius:999px;background:transparent;color:var(--ink-4);cursor:pointer;
      place-items:center;transition:background-color .2s,color .2s}
    .js .reveal{display:grid}
    .reveal:hover{color:var(--ink-1);background:rgba(var(--indigo-rgb),.08)}
    .reveal:focus-visible{outline:2px solid var(--indigo);outline-offset:-2px}
    .reveal svg{grid-area:1/1;width:20px;height:20px;transition:opacity .25s var(--ease),transform .35s var(--ease)}
    .reveal .eye-off,.reveal[aria-pressed="true"] .eye{opacity:0;transform:scale(.6) rotate(-20deg)}
    .reveal[aria-pressed="true"] .eye-off{opacity:1;transform:none}
    .error{display:flex;gap:8px;align-items:flex-start;margin-top:12px;padding:10px 14px;border-radius:14px;background:var(--risk-bg);font-size:13.5px;line-height:1.45;color:var(--risk);
      animation:drop .5s var(--ease) .2s backwards}
    .error svg{flex:none;width:16px;height:16px;margin-top:1.5px}
    @keyframes drop{from{opacity:0;transform:translateY(-8px)}}
    .submit{position:relative;display:grid;place-items:center;margin-top:16px;height:50px;width:100%;border:1px solid transparent;border-radius:999px;background:var(--btn);color:var(--btn-fg);
      font:inherit;font-size:15px;font-weight:600;cursor:pointer;transition:transform .25s var(--ease),background-color .2s}
    .submit::before{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:var(--sh-btn);opacity:0;transition:opacity .25s var(--ease);pointer-events:none}
    .submit>span{grid-area:1/1;display:inline-flex;align-items:center;gap:8px;transition:opacity .25s var(--ease),transform .35s var(--ease)}
    .submit .arrow{width:16px;height:16px;transition:transform .3s var(--ease)}
    .submit .busy{opacity:0;transform:translateY(8px)}
    .submit:focus-visible{outline:2px solid var(--indigo);outline-offset:3px}
    /* The Cloudflare Access page's Reload link wears the button's look */
    .card>.submit{margin-top:28px;text-decoration:none}
    @media (hover:hover){
      .submit:hover{background:var(--btn-hover);transform:translateY(-1px)}
      .submit:hover::before{opacity:1}
      .submit:hover .arrow{transform:translateX(3px)}
    }
    .submit:active{transform:translateY(0) scale(.985);transition-duration:.08s}
    .submit:active::before{opacity:0}
    /* Signing in: the label lifts out and a spinner comes in (set by the script on submit) */
    .submit.is-busy{cursor:progress;transform:none}
    .submit.is-busy::before{opacity:0}
    .submit.is-busy .label{opacity:0;transform:translateY(-8px)}
    .submit.is-busy .busy{opacity:1;transform:none}
    .spin{width:16px;height:16px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;opacity:.85;animation:spin .7s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
    .foot{font-size:12.5px;color:var(--ink-4);animation:fade .8s ease-out .6s backwards}
    /* After a failed try the card is already there: it fades in, then shakes once; the error slides down under the field */
    .card.failed{animation:fade .25s ease-out backwards,shake .55s cubic-bezier(.36,.07,.19,.97) .2s}
    .card.failed .st{animation:none}
    @keyframes shake{15%{transform:translateX(-7px)}30%{transform:translateX(6px)}45%{transform:translateX(-4px)}60%{transform:translateX(3px)}75%{transform:translateX(-1.5px)}}
    /* Windows high contrast drops backgrounds and shadows: the transparent borders draw the edges, and focused controls
       get an outline in place of the glow. */
    @media (forced-colors:active){#password:focus{outline:2px solid Highlight;outline-offset:1px}.field::after,.bg{display:none}}
    @media (max-width:420px){.card{padding:30px 22px 24px;border-radius:22px}h1{font-size:24px}}
    @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
  </style>
</head>
<body>
  <div class="bg" aria-hidden="true"></div>
  ${main}
  <p class="foot">Internal use · Spyder Controls</p>
  ${script}
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
