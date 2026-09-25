/**
 * Password gate for the hosted dashboard. Two Pages secrets are required (never stored in this repo):
 *   wrangler pages secret put DASHBOARD_PASSWORD   (the shared sign-in password)
 *   wrangler pages secret put SESSION_SECRET       (32+ random characters; signs sign-in sessions)
 * Changing either one signs everyone out.
 */
const COOKIE_NAME = '__Host-spyder_kpi_session';
// Cookie set by version 1v0 (it held a hash of the password); cleared on sign-in and sign-out.
const LEGACY_COOKIE_NAME = 'spyder_kpi_auth';
const SESSION_DAYS = 14;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const FAILED_LOGIN_DELAY_MS = 1000;
const encoder = new TextEncoder();

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const password = String(env.DASHBOARD_PASSWORD || '');
  const sessionSecret = String(env.SESSION_SECRET || '');

  // Without a separate secret, anyone could test password guesses by forging session cookies, so fail closed.
  if (!password || !sessionSecret) {
    return new Response('Dashboard sign-in is not configured: set the DASHBOARD_PASSWORD and SESSION_SECRET secrets.', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }
  // Both values key the session signature, so changing the password also signs everyone out.
  const secret = `${sessionSecret}\u0000${password}`;

  if (url.pathname === '/logout') {
    return redirectWithCookie(url.origin + '/', '');
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
    return withSecurityHeaders(await next());
  }

  return loginPage(false, 401);
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

function loginPage(failed, status) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spyder KPI Dashboard</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(180deg,#f8fafc 0,#eef2f6 100%);color:#0f172a}
    .top-bar{background:#111827;color:#fff;padding:.85rem 2rem}
    .top-bar strong{font-size:15px}
    .top-bar span{margin-left:10px;font-size:13px;opacity:.65}
    .card{max-width:420px;margin:4rem auto;background:#fff;border:1px solid #dbe3ec;border-radius:10px;padding:1.6rem 1.5rem;box-shadow:0 14px 32px rgba(15,23,42,.06)}
    h1{font-size:22px;margin-bottom:.4rem}
    p{font-size:13px;color:#64748b;line-height:1.5;margin-bottom:1.1rem}
    label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin-bottom:6px}
    input{width:100%;border:1px solid #d1d5db;border-radius:8px;padding:10px 12px;font-size:14px}
    input:focus{outline:2px solid rgba(14,102,85,.25);border-color:#0E6655}
    button{margin-top:12px;width:100%;background:#0f766e;color:#fff;border:0;border-radius:8px;padding:10px 12px;font-size:14px;font-weight:700;cursor:pointer}
    button:hover{background:#0e6655}
    .error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:8px;padding:.7rem .8rem;font-size:13px;margin-bottom:1rem}
  </style>
</head>
<body>
  <div class="top-bar"><strong>Spyder Controls</strong><span>KPI Export Visualizer</span></div>
  <form class="card" method="post" action="/login">
    <h1>Sign in</h1>
    <p>This dashboard is for internal Spyder use. Enter the shared password to continue.</p>
    ${failed ? '<div class="error" role="alert">That password is not correct.</div>' : ''}
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Open dashboard</button>
  </form>
</body>
</html>`;
  return new Response(html, {
    status: failed ? status : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'X-Frame-Options': 'DENY'
    }
  });
}
