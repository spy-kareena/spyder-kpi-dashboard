/**
 * Who is signed in, for the page's header and the name stamped on shared notes. functions/_middleware.js runs first
 * and checks the sign-in; this only reports what it found (context.data.auth and context.data.user).
 *   GET /api/me -> {v:1, auth:{access, password}, user:{email, name}|null, logoutUrl:'/logout'}
 *     auth.access    Cloudflare Access sign-in is on (ACCESS_TEAM_DOMAIN and ACCESS_AUD are set; docs/ACCESS.md)
 *     auth.password  the shared password is on (DASHBOARD_PASSWORD is set)
 *     user           the person named by the Cloudflare Access token: email as Access verified it, name made from it
 *                    ("aaron.joseph@..." -> "Aaron Joseph"; '' when the address gives none). null with the shared
 *                    password alone (it names nobody) and for an Access service token.
 *     logoutUrl      signs out: clears the password session and, with Access on, ends the Access session too
 * Never cached (cache-control: no-store): the answer belongs to one person.
 */
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Use GET.' }, { Allow: 'GET, HEAD' });
  const data = context.data && typeof context.data === 'object' ? context.data : {};
  // The middleware says which layers are on; without it (never on the hosted site) the settings themselves are read.
  const auth = data.auth && typeof data.auth === 'object'
    ? { access: data.auth.access === true, password: data.auth.password === true }
    : { access: Boolean(env && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD), password: Boolean(env && env.DASHBOARD_PASSWORD) };
  const u = data.user;
  const user = u && u.via === 'access' && typeof u.email === 'string' && u.email
    ? { email: u.email, name: typeof u.name === 'string' ? u.name : '' }
    : null;
  return json(200, { v: 1, auth, user, logoutUrl: '/logout' });
}

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
  });
}
