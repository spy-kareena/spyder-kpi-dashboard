# Spyder KPI Dashboard 1v2 - IT Hosting Notes

## What this is

This package is a static browser dashboard for SAP B1 KPI exports.

It does not need a database, application server, Node, Python, or internet access. The user opens the page, uploads Excel/CSV exports, and the dashboard processes the files in the browser.

## Files

- `index.html` - the dashboard page to host
- `queries/` - SAP B1 HANA query templates used to generate Excel exports
- `samples/` - example CSV for a local smoke test
- `VERSION.txt` - package/version marker
- `functions/` - Cloudflare Pages Functions: the sign-in gate, the optional Ask AI key proxy (`functions/api/gemini/`), the shared report (`functions/api/report.js`) and live shipping (`functions/api/shipping.js`)
- `shared/fedex.mjs` - FedEx tracking code used by `functions/api/shipping.js` and the shipping poller Worker
- `workers/shipping-poller/` - optional Cloudflare Worker that checks FedEx every 4 hours for the Shipping page (its own `wrangler.toml` and README); see `docs/SHIPPING.md`
- `mcp/spyder-kpi-mcp.mjs` - optional MCP server users run on their own computer (Node 18+) to connect Claude or other AI apps; see `docs/MCP.md`
- `web.config` - optional IIS static hosting config

## Hosting

Host this project folder as a static site. The default document is `index.html`.

For IIS:

1. Copy the folder to the web server, for example:
   `C:\inetpub\wwwroot\spyder-kpi-dashboard`
2. Create an IIS site or virtual directory pointing at that folder.
3. Set the default document to `index.html`.
4. Bind the site to the internal IP/host name IT wants to use.
5. Users can open the dashboard from a URL like:
   `http://internal-server-name/spyder-kpi-dashboard/`

For any other internal static server, point the document root at this folder and serve `index.html`.

## Data and notes behavior

The dashboard reads uploaded Excel/CSV files locally in the browser.

The files of the last report are kept so the dashboard reopens on them; loading a new report replaces them.

- **Cloudflare Pages with shared storage:** a compressed copy of the files (about 1.5 MB for a year of SO/PO lines plus the Clear To Build workbook) is kept in Workers KV, and everyone who signs in opens on it. One upload replaces it for everyone. Setup below.
- **Other hosts, or Cloudflare without the binding:** the files are kept in each browser (IndexedDB, database `spyderKpiReport`). To remove them, clear the site data for the dashboard in the browser settings. On a shared computer, use a separate browser profile per person.

### Shared report storage (Cloudflare Pages)

1. Cloudflare dashboard > Storage & Databases > Workers KV > **Create namespace**, name it `spyder-kpi-report` (or run `npx wrangler kv namespace create spyder-kpi-report`).
2. Workers & Pages > **spyder-kpi-dashboard** > Settings > Bindings > **Add** > KV namespace: variable name `REPORT_STORE`, namespace `spyder-kpi-report`. Add it for Production (and Preview if previews should share it).
3. Redeploy (Deployments > latest > Retry deployment) so the binding takes effect. The sidebar then says "Saved for everyone who signs in" after an upload.

The same namespace also holds the Shipping page's FedEx results (keys starting with `tracking:`, see below).

`/api/report` sits behind the same sign-in as the page; only a signed-in page on the same site can replace the report. The free tier allows 1,000 writes and 100,000 reads a day (one write per upload, one read per page open). To delete the shared copy: `npx wrangler kv key delete report --namespace-id <id> --remote`.

### Live shipping (FedEx, optional)

The **Shipping** page shows FedEx statuses for recent deliveries. It needs the shared storage above, a FedEx developer
project with the Track API, and the scheduled Worker in `workers/shipping-poller` (every 4 hours, `crons = ["0 */4 * * *"]`).
Full steps: [SHIPPING.md](SHIPPING.md). In short:

1. In `workers/shipping-poller/wrangler.toml`, set the `REPORT_STORE` namespace id (the same namespace as above).
2. In that folder: `npx wrangler secret put FEDEX_CLIENT_ID`, `npx wrangler secret put FEDEX_CLIENT_SECRET`, then `npx wrangler deploy`.
3. Optional, for the page's **Refresh now** button: `npx wrangler pages secret put FEDEX_CLIENT_ID --project-name spyder-kpi-dashboard` and the same for `FEDEX_CLIENT_SECRET`, then redeploy.
4. Sandbox (test) keys only: set `FEDEX_API_BASE` to `https://apis-sandbox.fedex.com` (Worker `[vars]` and/or Pages environment variable).

KV keys used: `tracking:wanted` (the list the page sends), `tracking:index` (FedEx results), `tracking:token` (the FedEx
sign-in, expires on its own) and `tracking:refresh` (the 10-minute Refresh limit). Only tracking numbers are sent to
FedEx. On IIS or another static host the Shipping page lists the tracking numbers from the export without live status.

The SAP KPI query must be re-run once with the updated `queries/sap_b1_hana_kpi_current_dashboard_so_po_with_lagging.sql`
so the export carries `TrackingNumber`, `ShipMethod`, `ShipToCountry` and `ShipDate` on delivery rows.

Important: saved notes/override selections are stored in that user's browser storage. They are not shared live between users unless a shared backend is added later. A **Share snapshot** file does carry the loaded rows and the notes on those rows, so treat snapshot files like the SAP export itself.

If the team needs shared live notes, the next version should add a shared storage layer such as SharePoint List, SQL database, or another internal API.

## Security notes

- No external data upload is required by this package. The optional **Ask AI** panel sends questions and the data needed to answer them to Google's Gemini API, only after the user ticks a consent box; on the free tier Google may use that data to improve its products. See `docs/AI_ASSISTANT.md`. To offer it without per-user keys on Cloudflare Pages, set the `GEMINI_API_KEY` Pages secret; the `/api/gemini` proxy is behind the same sign-in gate. IIS has no proxy, so users there enter their own key.
- No SAP credentials are stored in the dashboard.
- SAP exports are loaded by the user from their local machine.
- Restrict access to internal users only. On Cloudflare Pages with `REPORT_STORE` bound, the last uploaded export is stored in Workers KV and readable by anyone with the dashboard password; otherwise uploaded KPI data never reaches the server. The page itself lists customer codes (for segment grouping) and `queries/` shows SAP table/UDF names.
- FedEx keys (`FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET`) live only as Worker / Pages secrets; they and the FedEx sign-in token are never sent to the browser. `/api/shipping` is behind the sign-in; changing the tracking list or asking FedEx now is accepted only from the dashboard page itself (same origin), and Refresh now is limited to once per 10 minutes for the whole site.
- Cloudflare Pages: set `DASHBOARD_PASSWORD` and `SESSION_SECRET` (32+ random characters) as Pages secrets for Production and Preview. Both are required; the site returns a "not configured" error until both are set. Changing either signs everyone out. Failed sign-ins are delayed by one second; for stronger protection put the project behind Cloudflare Access, or add a rate-limiting rule matching the path `/login` with method POST (and redirect `<project>.pages.dev` to the custom domain so the rule cannot be bypassed).
- IIS: this package does not configure authentication, because the IIS authentication sections are locked by default and a web.config that sets them would fail on a default install. To require Windows sign-in, install the Windows Authentication role service, then in IIS Manager for this site disable Anonymous Authentication, enable Windows Authentication, and add an Authorization rule for the allowed AD group. The included web.config hides the `functions`, `shared`, `workers` and `tests` folders (server code that IIS does not run).

## Tests

With Node 18+ (no install needed): `node tests/run-all.js`.

## Updating later

To update the dashboard later, replace `index.html` with a newer version and update `VERSION.txt`.
