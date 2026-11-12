/**
 * Spyder shipping poller: a Cloudflare Worker that checks AfterShip every 2 hours (cron in wrangler.toml) for the
 * tracking numbers the dashboard's Shipping page listed, and saves the results where the page reads them
 * (Workers KV, binding REPORT_STORE, key tracking:index). The AfterShip code is shared with the Pages Function
 * functions/api/shipping.js: ../../shared/aftership.mjs. Setup and the secret: README.md in this folder and docs/SHIPPING.md.
 */
import { pollTracking, aftershipConfigured } from '../../shared/aftership.mjs';

// One check. Returns a one-line summary; an AfterShip failure is thrown so the run shows as failed in Cloudflare
// (Workers > spyder-shipping-poller > Logs / Cron Events), and the page shows the reason from tracking:index.
export async function runCheck(env, opts = {}) {
  if (!env || !env.REPORT_STORE) {
    console.warn('spyder-shipping-poller: no REPORT_STORE binding; set the KV namespace id in wrangler.toml.');
    return 'skipped: no REPORT_STORE';
  }
  if (!aftershipConfigured(env)) {
    console.warn('spyder-shipping-poller: AFTERSHIP_API_KEY is not set (npx wrangler secret put AFTERSHIP_API_KEY).');
    return 'skipped: no AfterShip key';
  }
  const doc = await pollTracking(env, { ...opts, source: 'cron' });
  // Each check reads at most AFTERSHIP_MAX_PER_RUN numbers with AFTERSHIP_MAX_CALLS requests, stalest first.
  let summary = `checked ${doc.count} tracking numbers (${doc.polled} read from AfterShip, ${doc.created} added${doc.waiting ? `, ${doc.waiting} left for the next checks` : ''})`;
  if (doc.errors.length) summary += `, ${doc.errors.length} failed requests`;
  if (doc.lastError) summary += `; stopped early: ${doc.lastError.message}`;
  console.log(`spyder-shipping-poller: ${summary}`);
  return summary;
}

export default {
  async scheduled(controller, env, ctx) {
    const work = runCheck(env);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work.catch(() => {}));
    await work;
  },
  // Nothing to serve: the Worker only runs on its schedule (workers_dev is off in wrangler.toml).
  async fetch() {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};
