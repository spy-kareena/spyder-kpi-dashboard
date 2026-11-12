# Shipping page: AfterShip every 2 hours

The **Shipping** page (top menu) lists recent shipments from SAP delivery tickets, for **every carrier** (FedEx,
FedEx Freight, UPS, Purolator, Canpar, DHL, Loomis, Day & Ross…). On the hosted site a small scheduled Worker asks
**AfterShip** about every tracking number **every 2 hours**, and the page shows what it found: Shipped, In transit,
Delayed or Delivered, with the latest scan and the expected delivery date. A status can still be **set by hand** for
a number AfterShip cannot track. There is no demo data.

## What the page shows

- **Header:** how many shipments are listed.
- **Bar:** the **Carrier**, **Customer**, **Status** and **Destination** filters (Destination is left out on a phone)
  and **Add tracking #**. Without AfterShip (a file copy, a static web server, or no key yet) one short line says
  "Automatic tracking isn't set up, so statuses are set by hand." If the last check stopped (a refused key, too many
  requests), one line says why.
- **Map and status cards:** the delivery map across the page; on its right the map fades out (like at its top and
  bottom) and the five cards sit small over that part, two a row, Priority across both. The map's view keeps every
  dot and arc left of the cards. Below 981px the cards sit above the map, two a row. Each card shows its count and
  one or two short facts; its tooltip adds the orders and value. Click a card to list only those shipments, click
  again for all:
  - **In transit**: Shipped (label created, AfterShip "Pending" or "Info received") or In transit (in transit, out for
    delivery, ready for pickup).
  - **Delayed**: an exception, a failed delivery attempt, tracking expired, or marked Delayed by hand.
  - **Delivered this week**: delivered since Monday.
  - **Not delivered** (2v6.9, replaces "No update in 2+ days"): every listed shipment without a Delivered status
    (shipped, in transit, delayed or no status yet). Its first fact counts the ones with no AfterShip scan and no
    hand-set status for 2 days or more since they shipped ("3 with no update in 2+ days").
  - **Priority**: the shipments ticked in the Priority column; on its right **Delivered N** and **Undelivered N**,
    each a button that lists those.
- **Shipments:** the title row says how many, when AfterShip was last read and the next check ("Updated 8:04 PM ·
  next 10:00 PM"), and has **Update all** (below). One row per tracking number: a small icon for its state (truck on
  the way, alert delayed, check delivered, clock no status yet), a 3-step strip, Shipped → In transit → Delivered
  (**Delayed** turns the middle step red) with "Last location: Winnipeg, MB" under it in small grey (AfterShip's last
  scan place; nothing when unknown), the ETA (AfterShip's expected date, else the promised date, over "promised …";
  for a delivered one its date over the promised date) and the **Priority** tick. Delayed ones first, then the ones
  with no update for 2+ days, delivered ones last; the column titles sort (Priority: ticked first). 10 a page: the
  page numbers under the table (‹ 1 2 3 ›; arrow keys work too); a new filter, search or sort starts at page 1;
  printing lists every row.
  - **Priority tick:** a round check like Kit Clean? on Purchase Orders. Saved for everyone (below); read-only in a
    snapshot.
  - **Update all:** asks AfterShip about every shipment now (the same "refresh now" as `POST /api/shipping`, once per
    10 minutes for the whole site), then reads the results again. A second try within 10 minutes says "Updated less
    than 10 minutes ago, try again at 8:14 PM". Shown only where the site has the AfterShip key, never in a snapshot.
  - **Arrow icon** (an arrow out of a box) at the end of each row: opens `https://www.aftership.com/track/<tracking
    number>` in a new tab. AfterShip works out the carrier from the number.
  - Click a row (or press Enter) for its details: the status and its date, **Source** ("From AfterShip" or "Set by
    Pat · Oct 9, 10:40 AM"), what AfterShip says, the last scan (message, place, time), the expected, promised and SAP
    ship dates, carrier and ship method, ship-to country, the delivery's order lines, **Open tracking page** and
    **Update status**.
- **Update status:** pick **Shipped**, **In transit**, **Delayed** or **Delivered**, a date and an optional note up to
  200 characters, then **Save**. It counts until AfterShip reports something newer (a later scan); then AfterShip's
  status shows again. Use it for numbers AfterShip cannot track.
- **Add tracking #:** a tracking number (any carrier) and, optionally, its sales order, for a shipment whose SAP
  delivery has no tracking number yet. Listed for 45 days; AfterShip picks it up at the next check.
- **Cross-border** and **Delayed** lists beside the table, 5 a page each with their own page numbers; **About these
  numbers** at the bottom.

## Where the shipments come from

1. **The KPI export.** The KPI query (`queries/sap_b1_hana_kpi_current_dashboard_so_po_with_lagging.sql`) adds
   `TrackingNumber` (`ODLN.TrackNo`; one field can hold several numbers separated by commas), `ShipMethod`,
   `ShipToCountry` and `ShipDate` to every delivery row. Sales deliveries shipped in the **30 days before the export
   date** are listed.
2. **Add tracking #** on the page (45 days).

When the page opens on the hosted site it sends this list to `/api/shipping` (only when it changed), with the carrier
the SAP ship method names. The Worker adds each new number to AfterShip once (passing the carrier only for FedEx, FedEx
Freight, UPS, Purolator, Canpar, Canada Post and Loomis; otherwise AfterShip works it out), then reads the latest
status of the ones still moving in batches of 50. Delivered numbers are final and are not asked again.

## Set up AfterShip (once)

1. In AfterShip (https://admin.aftership.com), open the API keys settings and create a key. Every number added counts
   toward the AfterShip plan's monthly shipments.
2. Add the key as a **Worker secret** and deploy the Worker (Node.js 20 or newer, signed in with `npx wrangler login`):

   ```
   cd workers/shipping-poller
   npx wrangler secret put AFTERSHIP_API_KEY
   npx wrangler deploy
   ```

   `wrangler.toml` there already has the cron (`crons = ["0 */2 * * *"]`, every even hour UTC) and the same
   `REPORT_STORE` KV namespace as the site. More in [workers/shipping-poller/README.md](../workers/shipping-poller/README.md).
3. Add the same key as a **Pages secret** (the page then knows tracking is on, and `POST /api/shipping` can check at
   once), then redeploy the site:

   ```
   npx wrangler pages secret put AFTERSHIP_API_KEY --project-name spyder-kpi-dashboard
   ```

The key is only ever sent to AfterShip; it is never stored in KV or returned to the page.

## How it works

- **Worker** (`workers/shipping-poller`, code shared with the site in `shared/aftership.mjs`): every 2 hours reads
  `tracking:wanted`, adds new numbers (`POST https://api.aftership.com/tracking/2026-07/trackings`), reads the others
  (`GET …/trackings?tracking_numbers=…&limit=200`, following `next_cursor`), and saves `tracking:index` (one status per
  number) and `tracking:aftership` (the numbers AfterShip already has). A check makes at most 40 AfterShip requests
  and reads at most 150 numbers, stalest first, so it fits the Workers Free plan (50 subrequests per run); the rest
  wait for the next check. On Workers Paid, raise `AFTERSHIP_MAX_PER_RUN` / `AFTERSHIP_MAX_CALLS` in its `wrangler.toml`.
- **AfterShip tag → page status:** Pending, InfoReceived → Shipped; InTransit, OutForDelivery, AvailableForPickup → In
  transit; AttemptFail, Exception, Expired → Delayed; Delivered → Delivered (with the delivery date).
- **`/api/shipping`** (`functions/api/shipping.js`): `GET` returns the last results (`configured` = the AfterShip key
  is set on the site), `PUT` saves the page's list, `POST` checks now (at most once per 10 minutes for the whole site).
- **Page:** reads `GET /api/shipping` when Shipping opens (at most every 5 minutes), when its browser tab comes back
  into view, and 3 minutes after each 2-hourly check while it stays open.
- **Errors:** a refused key (401) or too many requests (429) keeps the last results; the page shows one line with the
  reason, and the Worker's run shows in **Workers & Pages → spyder-shipping-poller → Logs**. A number AfterShip does not
  recognise shows "AfterShip does not recognise this tracking number" in its details and is offered again a day later.

## Where hand-set statuses are kept

In the shared notes store, like line notes (`functions/api/notes.js`, Workers KV key `overrides`, map `shipments`):

- A hand-added number: id = the tracking number, `{order, number, deleted?, by, at}`.
- A hand-set status: id = `st:<tracking number>`,
  `{order, number, status: 'shipped'|'transit'|'delayed'|'delivered', statusDate: 'YYYY-MM-DD', note, by, at}`.
- A Priority tick (2v6.9): id = `pr:<tracking number>`, `{order, number, priority: true|false, by, at}` (an untick is
  saved as `false`, so it reaches every browser).

On a static host or a file they stay in that browser (`localStorage` `spyderKpiShipmentsV1`). A **Share snapshot**
carries the hand-set and AfterShip statuses on screen and the Priority ticks (read-only, no form).

## Checking that it works

1. After the setup above, wait for the next even hour (or check the Worker's **Logs**), then open **Shipping** on the
   hosted site: the Shipments title row says "Updated … · next …" and rows show AfterShip statuses.
2. Click the arrow icon on a row: AfterShip's tracking page opens in a new tab.
3. Open a row, set **Delayed** with a note and **Save**: the Delayed card goes up by one and the row says "Set by …".
   When AfterShip has a newer scan for it, its status shows again ("From AfterShip").

## Troubleshooting

| What you see | What to do |
|---|---|
| "Automatic tracking isn't set up" | Add `AFTERSHIP_API_KEY` as a Worker secret and deploy the Worker, and add it as a Pages secret (above). A file copy or an IIS copy never has AfterShip. |
| "AfterShip check stopped: AfterShip refused the API key" | Check the key in AfterShip, then `npx wrangler secret put AFTERSHIP_API_KEY` (Worker) and `npx wrangler pages secret put AFTERSHIP_API_KEY --project-name spyder-kpi-dashboard`. |
| "AfterShip says too many requests" | Nothing: the rest is read at the next check. |
| A row has no status | AfterShip has not been asked yet (long list: it takes a few checks), or does not recognise the number (see its details). Set a status by hand. |
| "This export has no TrackingNumber column" | Re-run the updated SAP query and load the new export. |
| A hand-set status saved on one computer is missing on another | Wait a minute and reload: the store re-reads changes about a minute after each save. |
