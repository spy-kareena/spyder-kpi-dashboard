// Who may change the team settings, for functions/api/team-settings.js, functions/api/prefs.js and functions/api/me.js.
// functions/_middleware.js runs first: context.data.auth says which sign-in layers are on, context.data.user who is
// signed in ({email, name, via:'access'} for a person Cloudflare Access signed in, {service, via:'access-service'} for
// an Access service token, {via:'password'} for the shared password).
//
// ADMIN_EMAILS (Pages secret, never in this repo): the admins' email addresses, separated by commas, semicolons,
// spaces or new lines, in any capitalisation. "Name <name@example.test>" and "mailto:" forms are read as the address;
// anything else that is not an address is ignored. Team settings are kept on the server only while Cloudflare Access
// is on and this names at least one admin; until then the board keeps every setting in each browser, as before.
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+$/;
const MAX_LIST = 10000; // characters of ADMIN_EMAILS read (far more than any real list)

// The admins' addresses in lower case (a Set; empty when ADMIN_EMAILS is not set or names no valid address).
export function adminEmails(env) {
  const raw = String((env && env.ADMIN_EMAILS) || '').slice(0, MAX_LIST);
  const out = new Set();
  for (const part of raw.split(/[\s,;]+/)) {
    const s = part.replace(/^mailto:/i, '').replace(/^[<("'[]+|[>)"'\]]+$/g, '').toLowerCase();
    if (s && s.length <= 254 && EMAIL_RE.test(s)) out.add(s);
  }
  return out;
}

// The person Cloudflare Access signed in: {email (lower case), name}, else null (a service token and the shared
// password name nobody).
export function accessPerson(context) {
  const u = context && context.data && context.data.user;
  if (!u || u.via !== 'access' || typeof u.email !== 'string' || !u.email) return null;
  return { email: u.email.trim().toLowerCase(), name: typeof u.name === 'string' ? u.name : '' };
}

// Anyone the sign-in gate let in: an Access person, an Access service token or a shared-password session.
export function signedIn(context) {
  const u = context && context.data && context.data.user;
  return Boolean(u && typeof u === 'object' && ['access', 'access-service', 'password'].includes(u.via));
}

// Cloudflare Access sign-in is on (the middleware checked an Access token on this request).
export function accessOn(context) {
  const auth = context && context.data && context.data.auth;
  return Boolean(auth && auth.access === true);
}

// Team settings live on the server: Access is on and ADMIN_EMAILS names at least one admin.
export function teamSettingsOn(context) {
  return accessOn(context) && adminEmails(context && context.env).size > 0;
}

// The requester may change the team settings: team settings are on and the Access person's email is an admin's.
export function isAdmin(context) {
  const person = accessPerson(context);
  return Boolean(person) && teamSettingsOn(context) && adminEmails(context.env).has(person.email);
}
