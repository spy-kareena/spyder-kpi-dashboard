/**
 * Password gate for the hosted dashboard.
 * Set DASHBOARD_PASSWORD with: wrangler pages secret put DASHBOARD_PASSWORD
 * The password itself is never stored in this repo.
 */
const COOKIE_NAME = 'spyder_kpi_auth';
const COOKIE_DAYS = 14;

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const password = String(env.DASHBOARD_PASSWORD || '');

  if (!password) {
    return new Response('Dashboard password is not configured.', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }

  if (url.pathname === '/logout') {
    return redirectWithCookie(url.origin + '/', '');
  }

  const expected = await tokenFor(password);
  const cookie = readCookie(request.headers.get('Cookie') || '', COOKIE_NAME);

  if (request.method === 'POST') {
    const form = await request.formData();
    const submitted = String(form.get('password') || '');
    if (safeEqual(submitted, password)) {
      return redirectWithCookie(url.origin + '/', expected);
    }
    return loginPage(true);
  }

  if (cookie && safeEqual(cookie, expected)) {
    return next();
  }

  return loginPage(false);
}

function readCookie(header, name) {
  const parts = header.split(';');
  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function cookieHeader(value) {
  if (!value) {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  }
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_DAYS * 24 * 60 * 60}`;
}

function redirectWithCookie(location, token) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Set-Cookie': cookieHeader(token)
    }
  });
}

async function tokenFor(password) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < left.byteLength; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function loginPage(failed) {
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
  <form class="card" method="post" action="/">
    <h1>Sign in</h1>
    <p>This dashboard is for internal Spyder use. Enter the shared password to continue.</p>
    ${failed ? '<div class="error">That password is not correct.</div>' : ''}
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Open dashboard</button>
  </form>
</body>
</html>`;
  return new Response(html, {
    status: failed ? 401 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
