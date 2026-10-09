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
// The only file served without a session: the logo on the sign-in page (it holds nothing private). The path must
// match exactly. A pattern such as "any file under /assets/" is not safe: Cloudflare Pages answers a path with no
// file behind it with index.html (its single-page-app fallback), so /assets/anything would hand out the whole app.
// If another public file is ever needed, add its exact path here.
const LOGO_PATH = '/assets/spyder-logo.jpg';
const PUBLIC_PATHS = new Set([LOGO_PATH]);
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

  if ((request.method === 'GET' || request.method === 'HEAD') && PUBLIC_PATHS.has(url.pathname)) {
    return withSecurityHeaders(await next());
  }

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

  // The page's background calls (Ask AI's /api/ai/*, the shared report) need a status they can read, not a 200 sign-in form.
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: { code: 401, message: 'Your sign-in to this site has expired. Reload the page and sign in again.' } }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  return loginPage(false);
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

// The sign-in page uses the dashboard's look (zinc neutrals, Inter with a system-font fallback, the blue accent) and
// the logo from assets/ (served without a session above). A wrong password shows an inline error under the field.
function loginPage(failed, status) {
  const error = !failed ? '' : status === 400
    ? 'The sign-in form could not be read. Try again.'
    : 'That password is not correct. Try again.';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in · Spyder KPI Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root{--fg:#18181b;--muted:#5f5f69;--border:#e4e4e7;--input:#71717a;--bg:#fafafa;--accent:#1570ef;--accent-strong:#175cd3;--ring:rgba(21,112,239,.35);--crit:#b42318;--crit-tint:#fef3f2;--crit-border:#fecdca;
      --font:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:32px 16px;font-family:var(--font);background:var(--bg);color:var(--fg);-webkit-font-smoothing:antialiased}
    .card{width:100%;max-width:400px;background:#fff;border:1px solid var(--border);border-radius:12px;padding:32px 28px 28px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
    .logo{display:block;width:150px;height:29px;object-fit:cover;object-position:center;margin:0 0 28px -2px}
    h1{font-size:22px;font-weight:600;letter-spacing:-.02em;line-height:1.25}
    .lead{margin-top:6px;font-size:14px;color:var(--muted);line-height:1.55}
    form{display:grid;gap:8px;margin-top:24px}
    label{font-size:13px;font-weight:500;color:var(--fg)}
    input{width:100%;height:40px;border:1px solid var(--input);border-radius:8px;padding:0 12px;font:inherit;font-size:16px;color:var(--fg);background:#fff;transition:border-color .15s,box-shadow .15s}
    input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--ring)}
    input[aria-invalid="true"]{border-color:var(--crit)}
    input[aria-invalid="true"]:focus{box-shadow:0 0 0 3px rgba(180,35,24,.25)}
    .error{display:flex;gap:6px;align-items:flex-start;font-size:13px;line-height:1.45;color:var(--crit)}
    .error svg{flex:none;width:16px;height:16px;margin-top:1px}
    button{margin-top:8px;height:40px;width:100%;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s}
    button:hover{background:var(--accent-strong)}
    button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .foot{font-size:12px;color:var(--muted)}
    @media (prefers-reduced-motion:reduce){*{transition:none!important}}
  </style>
</head>
<body>
  <main class="card">
    <img class="logo" src="${LOGO_PATH}" alt="Spyder Controls" width="150" height="29">
    <h1>Welcome back</h1>
    <p class="lead">Sign in to see this week's order health, purchase orders and build risk.</p>
    <form method="post" action="/login">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus${error ? ' aria-invalid="true" aria-describedby="password-error"' : ''}>
      ${error ? `<p class="error" id="password-error" role="alert"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.8v3.6M8 10.9v.1" stroke-linecap="round"/></svg>${error}</p>` : ''}
      <button type="submit">Sign in</button>
    </form>
  </main>
  <p class="foot">Internal use · Spyder Controls</p>
</body>
</html>`;
  return new Response(html, {
    // A page load without a session gets the form with 200; only a wrong password is an error status.
    status: failed ? status : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  });
}
