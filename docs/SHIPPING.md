# Shipping page: live FedEx tracking

The **Shipping** page (sidebar, Sales) shows where each recent FedEx shipment is: parcel (FedEx Ground, Express,
International) and FedEx Freight LTL. It answers "what is late, what is stuck, and what is held at customs" without
opening fedex.com for each order.

## What the page shows

- **Header:** "Updated 12 min ago · next check 4:00 PM": when FedEx was last asked, and the next scheduled check
  (every 4 hours). **Refresh now** asks FedEx right away (at most once every 10 minutes for everyone).
- **Cards:** In transit, Out for delivery, Delivered this week, Exceptions, In customs. Click a card to list only those
  shipments; click it again to list all.
- **Add tracking #:** type a FedEx tracking number (or a FedEx Freight PRO number) and, optionally, the sales order it
  belongs to. Use it for shipments whose SAP delivery has no tracking number yet.
- **Shipments:** one row per tracking number with a 6-step strip: Label created → Picked up → In transit → Customs →
  Out for delivery → Delivered. The strip is filled up to the newest FedEx scan. A red **!** marks an exception or a
  customs hold at that step. The Customs step is dashed for shipments that stay in Canada. On the right: the status
  and the FedEx delivery estimate against the promised date ("ETA Oct 12 · 2 days late"). Click a row (or press
  Enter on it) to see the order lines on that delivery, the last scan, any customs scans, and a link to fedex.com.
- **Cross-border:** shipments to an address outside Canada, or with customs scans: In clearance, Clearance delay or
  Released, and how many days customs has had it.
- **About these numbers** at the bottom of the page repeats the rules below.

Every number, card, button and column has a tooltip in plain English.

**Search** (the box under the logo) also finds tracking numbers, typed with or without spaces.

## Where the tracking numbers come from

1. **The KPI export.** The KPI query (`queries/sap_b1_hana_kpi_current_dashboard_so_po_with_lagging.sql`) now adds four
   columns to every delivery row:
   - `TrackingNumber`: the delivery's tracking number in SAP (`ODLN.TrackNo`, the **Tracking No.** field on the
     delivery's Logistics tab). One field can hold several numbers separated by commas.
   - `ShipMethod`: the delivery's shipping type (`OSHP`), for example "FedEx Ground" or "FedEx Freight LTL".
   - `ShipToCountry`: the country of the ship-to address on the business partner (`CRD1`, address type S).
   - `ShipDate`: the delivery date.

   **Re-run the updated query in SAP** and load the new export to bring them in. Older exports still load; the page
   then says the column is missing and you can add numbers by hand.
2. **Add tracking #** on the page. On the hosted site these are shared with everyone who signs in (they are saved with
   the shared notes); on a site without shared storage they are kept in the browser that added them.

Which shipments are tracked:

- Sales deliveries that **shipped in the 30 days before the export date**, until **7 days after FedEx delivered them**.
- Numbers **added by hand**, for **45 days**.
- At most 500 numbers from the export (newest first) and 200 added by hand.

## How it works

```
 Dashboard page ── PUT the list / GET results / POST Refresh now ──> /api/shipping (Pages Function)
                                                                         │
                                                Workers KV (REPORT_STORE): tracking:wanted, tracking:index
                                                                         │
 spyder-shipping-poller (Worker, every 4 hours) ── reads the list, asks FedEx, saves results ──┘
                                     │
                                     └──> FedEx Track API (apis.fedex.com), 30 numbers per call
```

- When a report is loaded on the hosted site, the page works out the list of tracking numbers and sends it to
  `/api/shipping` (only when the list changed). A browser with an older export open never replaces a newer export's
  list.
- The scheduled Worker in `workers/shipping-poller` asks FedEx about every listed shipment that is not delivered yet,
  every 4 hours (00:00, 04:00, 08:00, 12:00, 16:00 and 20:00 UTC), and saves the results.
- The page reads the saved results. **Refresh now** makes the site ask FedEx immediately.
- The FedEx code is in one place, `shared/fedex.mjs`, used by both the Worker and the Pages Function.
- Only tracking numbers are sent to FedEx. Customer names, order values and the export never leave the dashboard.

Opened from a file, from IIS or another web server, or as a **Share snapshot**, the page lists the tracking numbers from
the export without live status, and says so. A snapshot keeps the statuses that were on screen when it was saved.

## One-time setup (owner / IT)

You need: the Cloudflare account that hosts the dashboard (with the `REPORT_STORE` KV namespace already set up for the
shared report, see [IT_HOSTING_README.md](IT_HOSTING_README.md) and [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md)), the FedEx account you ship with, and Node.js 20 or newer
for the `npx wrangler` commands.

### 1. Re-run the SAP query

Update the saved query in SAP with `queries/sap_b1_hana_kpi_current_dashboard_so_po_with_lagging.sql`, run it, export
to Excel and load the file (New file). Make sure the shipping team fills **Tracking No.** on deliveries.

### 2. FedEx developer project (free)

1. Go to **developer.fedex.com** and sign in with the company's fedex.com user.
2. Create an **API project** and add the **Track API** to it. Accept the terms.
3. FedEx shows **test** keys first: an **API key** and a **Secret key**. These only work against the FedEx sandbox,
   which knows test tracking numbers, not your real shipments.
4. To track real shipments, ask for **production** keys for the project (FedEx asks for your FedEx account number).
   The production **API key** is `FEDEX_CLIENT_ID`, the production **Secret key** is `FEDEX_CLIENT_SECRET`.

The Track API has no charge with a FedEx account.

### 3. Deploy the poller Worker

In a terminal, in the `workers/shipping-poller` folder of this repo:

```
npx wrangler login                      # once, as the Cloudflare account that hosts the dashboard
npx wrangler kv namespace list          # copy the id of the REPORT_STORE namespace (spyder-kpi-report)
```

Open `workers/shipping-poller/wrangler.toml` and replace `REPLACE_WITH_REPORT_STORE_NAMESPACE_ID` with that id. Then:

```
npx wrangler secret put FEDEX_CLIENT_ID       # paste the production API key
npx wrangler secret put FEDEX_CLIENT_SECRET   # paste the production Secret key
npx wrangler deploy
```

Cloudflare now runs it every 4 hours: **Workers & Pages → spyder-shipping-poller → Settings → Trigger events** shows
the schedule, and **Logs** shows each run ("checked 42 tracking numbers (17 asked FedEx)").

### 4. Optional: "Refresh now" on the site

The scheduled checks only need step 3. For the **Refresh now** button, give the Pages project the same keys:

```
npx wrangler pages secret put FEDEX_CLIENT_ID --project-name spyder-kpi-dashboard
npx wrangler pages secret put FEDEX_CLIENT_SECRET --project-name spyder-kpi-dashboard
```

then redeploy the site (Deployments → latest → Retry deployment). Without them the button explains that it is not set
up, and everything else works.

### Testing with FedEx sandbox keys

Set `FEDEX_API_BASE` to `https://apis-sandbox.fedex.com` where the test keys are used: uncomment the `[vars]` lines in
`workers/shipping-poller/wrangler.toml` (then `npx wrangler deploy`), and/or for the Pages project run
`npx wrangler pages secret put FEDEX_API_BASE --project-name spyder-kpi-dashboard` (a secret works here; a plain
variable typed into the Cloudflare dashboard is replaced by the repo's `wrangler.toml` on the next deploy). Remove it
when you switch to production keys, so the default `https://apis.fedex.com` is used.

## Checking that it works

1. Load an export from the updated query on the hosted site and open **Shipping**.
2. Before the first check the header says "Not checked yet · next check …". After the next run (or **Refresh now**)
   it says "Updated … ago", and the rows show FedEx statuses.
3. To see what is stored: `npx wrangler kv key get tracking:index --namespace-id <id> --remote` (the results) and
   `tracking:wanted` (the list the page sent).

## Limits and costs

- **FedEx:** up to 30 tracking numbers per Track API call. A check asks about at most 600 numbers (20 calls), 6 times a
  day, plus Refresh now (at most 6 times an hour). Delivered shipments are not asked again. This is far below FedEx's
  per-project limits; see **Rate limits** in the FedEx developer portal if the volume grows a lot.
- **Cloudflare free plan:** the Worker runs 6 times a day (the free plan allows 100,000 requests a day and 50 outgoing
  calls per run, which is why a check stops at 600 numbers). Workers KV allows 1,000 writes a day: each check writes
  the results and a FedEx sign-in token (about 12 writes a day), a changed tracking list is one write, and each Refresh
  now is three.
- Statuses of delivered shipments are kept for 45 days after delivery, then dropped.

## Troubleshooting

| What you see | What to do |
|---|---|
| "This export has no TrackingNumber column" | Re-run the updated SAP query (step 1) and load the new export. |
| "Live FedEx tracking needs the hosted dashboard" | The page was opened from a file or a server without the Cloudflare functions. Use https://spyder-kpi-dashboard.pages.dev. |
| "This site has no shared storage (REPORT_STORE)" | Put the KV namespace id in the repo's `wrangler.toml`, uncomment the binding and redeploy (IT_HOSTING_README.md, OWNER_CHECKLIST.md). |
| "Not checked yet" for hours | The Worker is not deployed, has no keys, or has the wrong KV id. Check its Logs. |
| "The last FedEx check … failed: FedEx refused the API key…" | Wrong keys, test keys used against production (or the reverse), or the project lacks the Track API. Fix the secrets (step 3) and wait for the next check. |
| A row says "Not found at FedEx" | FedEx does not know that number yet (label not scanned) or it has a typo. Check it on fedex.com. |
| Refresh now is greyed out | It works once every 10 minutes for everyone, or the Pages project has no FedEx keys (step 4). |

## For IT: the API

`functions/api/shipping.js`, behind the same sign-in as the page. Responses are JSON with `cache-control: no-store`;
the FedEx keys and sign-in token are never returned.

- `GET /api/shipping` → `{configured, fedex, polledAt, statuses, errors, lastError, wanted:{exportAsOf, export, manual, updatedAt}, refreshAfter, schedule}`.
  `503 {configured:false}` without the `REPORT_STORE` binding.
- `PUT /api/shipping` with `{asOf:"YYYY-MM-DD", export:[numbers], manual:[numbers]}` (same-origin only, 64 KB) → saves the
  list when it changed. A list from an older export keeps the newer export's numbers.
- `POST /api/shipping` (same-origin only) → asks FedEx now. `429` with `Retry-After` within 10 minutes of the last
  refresh, `503` without the FedEx secrets, `502` when FedEx refuses or cannot be reached (the last results stay).

KV keys in `REPORT_STORE`: `tracking:wanted`, `tracking:index`, `tracking:token` (expires on its own) and
`tracking:refresh` (the 10-minute limit, expires on its own). To start over:
`npx wrangler kv key delete tracking:index --namespace-id <id> --remote`.
