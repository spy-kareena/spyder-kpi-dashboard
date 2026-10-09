# Spyder shipping poller (Cloudflare Worker)

A small scheduled Worker that checks FedEx **every 4 hours** for the tracking numbers on the dashboard's
**Shipping** page, and saves the results where the page reads them. It has no web page of its own.

- Code: `index.mjs` here, plus the FedEx code it shares with the dashboard: `../../shared/fedex.mjs`.
- Schedule: `crons = ["0 */4 * * *"]` in `wrangler.toml` (00:00, 04:00, 08:00, 12:00, 16:00 and 20:00 UTC).
- Storage: the same Workers KV namespace the dashboard uses (binding `REPORT_STORE`). It reads
  `tracking:wanted` (the list the page sends) and writes `tracking:index` (the results) and `tracking:token`
  (the FedEx sign-in, which expires on its own).

Full setup, including the FedEx developer project, is in [docs/SHIPPING.md](../../docs/SHIPPING.md).

## Set up once

Run these in this folder (`workers/shipping-poller`), signed in to the Cloudflare account that hosts the dashboard
(`npx wrangler login`):

1. Put the KV namespace id in `wrangler.toml` (replace `REPLACE_WITH_REPORT_STORE_NAMESPACE_ID`). It is the same id
   as the dashboard's `REPORT_STORE`; `npx wrangler kv namespace list` shows it.
2. Add the FedEx keys as secrets (each command asks for the value; nothing is saved in the repo):

   ```
   npx wrangler secret put FEDEX_CLIENT_ID
   npx wrangler secret put FEDEX_CLIENT_SECRET
   ```

3. Deploy: `npx wrangler deploy`

Cloudflare then shows the schedule under **Workers & Pages → spyder-shipping-poller → Settings → Trigger events**,
and each run under **Logs** (a line such as `checked 42 tracking numbers (17 asked FedEx)`).

Using FedEx **sandbox** (test) keys? Uncomment the `[vars]` lines in `wrangler.toml` so the Worker calls
`https://apis-sandbox.fedex.com`, and deploy again. Remove them when you switch to production keys.

## Good to know

- Delivered shipments are final, so they are not asked again; each check asks FedEx only about shipments still moving.
- A check asks about at most 60 of the shipments still moving (2 FedEx calls of 30): first those never checked, then
  those checked longest ago, so it fits the Workers Free plan's 10 ms of CPU per run. A longer list goes round over
  several checks; the log line says how many are left for the next ones. On Workers Paid, uncomment `[vars]` with
  `FEDEX_MAX_PER_RUN = "600"` and the `[limits]` lines in `wrangler.toml` to ask about the whole list every time.
- If FedEx refuses the keys or cannot be reached, the last results stay on the page with a note saying why, and the
  run shows as failed in the Worker's logs.
- To pause the checks, remove the cron in **Settings → Trigger events** (or delete the Worker). The dashboard keeps
  working; the Shipping page then shows the last results it has.
