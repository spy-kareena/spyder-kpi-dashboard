# Spyder shipping poller (Cloudflare Worker)

A small scheduled Worker that asks AfterShip **every 2 hours** about the tracking numbers on the dashboard's
**Shipping** page, and saves the results where the page reads them. It has no web page of its own.

- Code: `index.mjs` here, plus the AfterShip code it shares with the dashboard: `../../shared/aftership.mjs`.
- Schedule: `crons = ["0 */2 * * *"]` in `wrangler.toml` (every even hour, UTC).
- Storage: the same Workers KV namespace the dashboard uses (binding `REPORT_STORE`). It reads `tracking:wanted`
  (the list the page sends) and writes `tracking:index` (the results) and `tracking:aftership` (the numbers already
  added to AfterShip).

Full setup is in [docs/SHIPPING.md](../../docs/SHIPPING.md).

## Set up once

Run these in this folder (`workers/shipping-poller`), signed in to the Cloudflare account that hosts the dashboard
(`npx wrangler login`), with Node.js 20 or newer:

1. Check the KV namespace id in `wrangler.toml`. It is the same id as the dashboard's `REPORT_STORE`;
   `npx wrangler kv namespace list` shows it.
2. Add the AfterShip API key as a secret (the command asks for the value; nothing is saved in the repo):

   ```
   npx wrangler secret put AFTERSHIP_API_KEY
   ```

3. Deploy: `npx wrangler deploy`

Cloudflare then shows the schedule under **Workers & Pages → spyder-shipping-poller → Settings → Trigger events**,
and each run under **Logs** (a line such as `checked 42 tracking numbers (17 read from AfterShip, 3 added)`).

## Good to know

- A number the page lists is added to AfterShip once (AfterShip works out the carrier; for a few carriers named on
  the SAP delivery the page passes the carrier along). After that each check reads the latest status in batches of 50.
- Delivered shipments are final, so they are not asked again.
- A check reads at most 150 numbers with at most 40 AfterShip requests, stalest first, so it fits the Workers Free
  plan (50 subrequests per run). A longer list goes round over several checks; the log line says how many are left.
  On Workers Paid, raise `AFTERSHIP_MAX_PER_RUN` and `AFTERSHIP_MAX_CALLS` in `wrangler.toml`.
- Every number added counts toward the AfterShip plan's monthly shipments.
- If AfterShip refuses the key, or says too many requests, the last results stay on the page with a note saying
  why, and the run shows in the Worker's logs.
- To pause the checks, remove the cron in **Settings → Trigger events** (or delete the Worker). The dashboard keeps
  working; the Shipping page then shows the last results it has, and statuses can still be set by hand.
