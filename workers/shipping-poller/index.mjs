/**
 * Spyder shipping poller: a Cloudflare Worker that checks FedEx every 4 hours (cron in wrangler.toml) for the
 * tracking numbers the dashboard's Shipping page listed, and saves the results where the page reads them
 * (Workers KV, binding REPORT_STORE, key tracking:index). The FedEx code is shared with the Pages Function
 * functions/api/shipping.js: ../../shared/fedex.mjs. Setup and secrets: README.md in this folder and docs/SHIPPING.md.
 */
import { pollTracking, fedexConfigured } from '../../shared/fedex.mjs';

// One check. Returns a one-line summary; a FedEx failure is thrown so the run shows as failed in Cloudflare
// (Workers > spyder-shipping-poller > Logs / Cron Events), and the page shows the reason from tracking:index.
export async function runCheck(env, opts = {}) {
  if (!env || !env.REPORT_STORE) {
    console.warn('spyder-shipping-poller: no REPORT_STORE binding; set the KV namespace id in wrangler.toml.');
    return 'skipped: no REPORT_STORE';
  }
  if (!fedexConfigured(env)) {
    console.warn('spyder-shipping-poller: FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET are not set (wrangler secret put).');
    return 'skipped: no FedEx keys';
  }
  const doc = await pollTracking(env, { ...opts, source: 'cron' });
  // Each check asks FedEx about at most 60 numbers (FEDEX_MAX_PER_RUN), stalest first; the rest wait for the next.
  const summary = `checked ${doc.count} tracking numbers (${doc.polled} asked FedEx${doc.waiting ? `, ${doc.waiting} left for the next checks` : ''})${doc.errors.length ? `, ${doc.errors.length} failed batches` : ''}`;
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
