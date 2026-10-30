# Shipping page: checked by hand

The **Shipping** page (top menu) lists recent shipments from SAP delivery tickets, for **every carrier** (FedEx,
FedEx Freight, UPS, Purolator, Canpar, DHL, Loomis, Day & Ross…). Nobody's tracking system is called from the page:
each shipment has a **Check** link to its public tracking page, and whoever looks it up records what they saw
(Shipped, In transit, Delayed or Delivered, with a date and a short note). Everyone who signs in sees those statuses,
and the page's cards come from them.

For now the page opens on **demo data** (12 made-up shipments) so you can see how it looks; **Show real shipments**
switches to the real list.

## What the page shows

- **Bar:** the **Carrier**, **Customer**, **Status** and **Destination** filters (Destination is left out on a phone),
  the **Show demo data / Show real shipments** switch and **Add tracking #**. Statuses are shared with everyone on the
  hosted site, or kept in this browser (a file or a static web server); **About these numbers** says which.
- **Demo data banner** (demo mode only): a yellow "Demo data" note saying the shipments are made up.
- **Map and status cards** in one row: the delivery map on the left, the four cards as a 2 x 2 grid on the right
  (stacked on a narrow screen, cards first). Each card shows its count; its tooltip adds the orders and value. Click a
  card to list only those shipments, click again for all:
  - **In transit**: marked Shipped or In transit.
  - **Delayed**: marked Delayed.
  - **Delivered this week**: marked Delivered with a date since Monday.
  - **Not checked in 2+ days**: not delivered, and nobody has saved a status for 2 days or more (or ever). This is
    the "go and check these" list.
- **Shipments:** one row per tracking number with a 3-step strip, Shipped → In transit → Delivered, filled up to the
  saved status. **Delayed** turns the middle step red with a **!**. On the right: the status and when it was last
  checked ("Checked 3 h ago"), or for a delivered one its date against the promised date ("Oct 8 · 1 day late").
  Delayed ones are listed first, then the ones not checked for 2+ days, delivered ones last.
  - **Check** (next to each row): opens `https://www.aftership.com/track/<tracking number>` in a new tab. AfterShip
    works out the carrier from the number, so the same link works for FedEx, UPS, Purolator, Canpar, DHL and most
    others. A number AfterShip does not recognise can still be looked up on the carrier's own site.
  - Click a row (or press Enter) for its details: the saved status and note, who checked and when, the promised and
    SAP ship dates, carrier and ship method, ship-to country, the delivery's order lines, and **Update status**.
- **Update status:** pick **Shipped** (left Spyder Controls), **In transit**, **Delayed** or **Delivered**, a date
  (the delivery date for Delivered, else the day you checked; today by default) and an optional note up to 200
  characters ("Held at customs, invoice missing"), then **Save**. Saving again, even with nothing changed, marks the
  shipment as checked now.
- **Add tracking #:** a tracking number (any carrier) and, optionally, its sales order, for a shipment whose SAP
  delivery has no tracking number yet. Listed for 45 days.
- **Cross-border:** shipments to an address outside Canada, with their status, last check and note.
- **About these numbers** at the bottom sums up the rules.

Every card, button, link and column has a short plain-English tooltip. **Search** (the box under the logo) finds
tracking numbers, typed with or without spaces.

## Where the shipments come from

1. **The KPI export.** The KPI query (`queries/sap_b1_hana_kpi_current_dashboard_so_po_with_lagging.sql`) adds four
   columns to every delivery row:
   - `TrackingNumber`: the delivery's tracking number (`ODLN.TrackNo`, **Tracking No.** on the delivery's Logistics
     tab). One field can hold several numbers separated by commas; the delivery's value is then shared between them,
     so the "worth" totals on the cards count it once. Text with no digit ("Customer Pickup", "Will Call") is ignored.
   - `ShipMethod`: the delivery's shipping type (`OSHP`), shown as the carrier ("UPS Standard" → UPS).
   - `ShipToCountry`: the ship-to country (`CRD1`, address type S); anything other than CA is cross-border.
   - `ShipDate`: the delivery date.

   Sales deliveries that **shipped in the 30 days before the export date** are listed. Re-run the updated query in
   SAP and load the new export to bring the columns in; older exports still load and the page says the column is
   missing.
2. **Add tracking #** on the page (45 days).

## Where the statuses are kept

Statuses go into the same shared notes store as line notes and overrides (`functions/api/notes.js`, Workers KV key
`overrides`, map `shipments`):

- A hand-added number: id = the tracking number, `{order, number, deleted?, by, at}`.
- A manual status: id = `st:<tracking number>`,
  `{order, number, status: 'shipped'|'transit'|'delayed'|'delivered', statusDate: 'YYYY-MM-DD', note, by, at}`.

Each id is merged on its own (the newest edit wins), so two people updating different shipments never overwrite each
other. On the hosted site everyone who signs in sees them within about a minute; on a static host (IIS, a file share)
or from a file they stay in that browser (`localStorage` `spyderKpiShipmentsV1`) and are sent the next time the page
opens on the hosted site. A **Share snapshot** carries the statuses on screen (read-only, no form).

## Demo data

- **On by default for everyone**, even after real statuses are saved, until the owner asks to remove it
  (`SHIP_DEMO_DEFAULT` in `index.html`).
- **Show demo data / Show real shipments** switches it for you (remembered in this browser only).
- 12 made-up shipments, built in the page, covering every stage: shipped, in transit, delayed (one weather hold, one
  held at customs), delivered this week and last week, never checked, and checked more than 2 days ago, including
  cross-border ones to the US and Mexico. Customers are fake ("Demo RV Co", "Demo Marine Supply"…) and tracking numbers
  start with `DEMO`.
- Statuses set on demo shipments stay on the page until you reload; they are never saved or shared. Demo shipments
  never appear in Search, Order Health, other pages, Ask AI or the shared report.

## The FedEx API module (kept, not used)

Earlier versions asked FedEx for live statuses. That code is **still in the repo but unused and not deployed**; the
Shipping page never calls it:

- `shared/fedex.mjs` (Track API client and status reader),
- `functions/api/shipping.js` (`GET`/`PUT`/`POST /api/shipping`; deployed with the other Pages Functions but idle, as
  no page calls it),
- `workers/shipping-poller/` (the 4-hourly Worker; do not deploy it).

Its tests (`tests/fedex.test.mjs`, `tests/shipping-api.test.mjs`, `tests/shipping-worker.test.mjs`) keep passing so it
can be turned back on later. That would need a FedEx developer project with Track API production keys
(`FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET`) as Worker secrets, the `REPORT_STORE` namespace id in
`workers/shipping-poller/wrangler.toml`, `npx wrangler deploy` from that folder (Node.js 20 or newer), and page code to
read `/api/shipping` again. It only covers FedEx; the manual flow covers every carrier and has no keys or limits.

## Checking that it works

1. Open **Shipping** on the hosted site after loading an export from the updated query. With no statuses yet you see
   the **Demo data** banner; click **Show real shipments**.
2. Click **Check** on a row: AfterShip opens in a new tab.
3. Open the row, set **In transit** with a note and **Save**. The In transit card goes up by one, and the toast says
   "saved for everyone".
4. Open the page in another browser (or another person's computer): click **Show real shipments**; the same status shows.

## Troubleshooting

| What you see | What to do |
|---|---|
| "This export has no TrackingNumber column" | Re-run the updated SAP query and load the new export. |
| Only demo shipments | Nobody has saved a real status yet. Click **Show real shipments**. |
| "statuses kept in this browser" | The page was opened from a file or a server without the Cloudflare functions, or shared storage (`REPORT_STORE`) is not set up. Use https://spyder-kpi-dashboard.pages.dev (IT_HOSTING_README.md). |
| AfterShip says it cannot find the number | The label may not be scanned yet, or the number has a typo. Try the carrier's own site. |
| A status saved on one computer is missing on another | Wait a minute and reload: the store re-reads changes about a minute after each save. |
