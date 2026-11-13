# Live SAP (2v6.7, live by default since 2v6.8)

The dashboard reads the KPI query and the supply / demand snapshot straight from SAP Business One, instead of someone
running them in Query Manager and uploading the export. The live data goes through the same steps as an upload: the
same numbers, Data Check, notes and overrides.

**Live SAP is the default data source.** Settings → **Data Source** switches between **Live SAP** and **Import files**
(uploading exports, as before 2v6.8). Until the settings below are in place, live mode says "Live SAP isn't set up on
this site" with a **Use import files** button.

## How it fits together

```
Browser ── /api/sap/kpi ──> functions/api/sap ──> Cloudflare Tunnel + Access ──> SAP bridge ──SELECT──> SAP B1 HANA
 (signed in)               (holds the keys)       (service token)                (company network) (read-only user)
```

- **The SAP bridge** is a small read-only service on the company network: [github.com/DavidP-M/SAP-app](https://github.com/DavidP-M/SAP-app).
  It runs the same SQL as `queries/` with a HANA user that can only read. It can't change anything in SAP.
- **`functions/api/sap/[[path]].js`** sits behind the sign-in gate. It calls the bridge with the keys below and returns the
  report as the tab-delimited file SAP's Export to Excel makes. None of the keys reach the browser.
- **`GET /api/sap/status`** tells the page whether the site has a bridge (`{"configured": true}`). It shows nothing else.
- The function passes on the bridge's `X-Row-Count`, `X-Refreshed-At` and `X-Stale` headers.
- **Ask AI's SAP lookups (2v6.9)**: `GET /api/sap/catalog` lists the lookups Ask AI may offer (the bridge's `/api/catalog`,
  only the names on the function's list, kept 60 s). `GET /api/sap/data/<name>?…` runs one: the function sends only that
  lookup's own params, checked first (whole numbers in range; text up to its length, letters, digits, space `. _ / -`), and
  returns the bridge's JSON. Unknown lookup 404, bad params 400, no bridge 503, bridge down 502. The lookups need the
  bridge update that adds them; until then Ask AI answers from the board only. See [AI_ASSISTANT.md](AI_ASSISTANT.md).

## Settings (Pages secrets)

In the Cloudflare dashboard: **Workers & Pages →** the dashboard's project (its address is
`spyder-kpi-dashboard.pages.dev`) **→ Settings → Variables and Secrets**, type **Secret**. Add them to **Preview** first to
try a branch preview (`https://<branch>.spyder-kpi-dashboard.pages.dev`), then to **Production**, and redeploy. From a
terminal: `npx wrangler pages secret put <NAME> --project-name spyder-kpi-dashboard`.

| Secret | What it is |
|---|---|
| `SAP_BRIDGE_URL` | The bridge's tunnel address, e.g. `https://sap-bridge.yourdomain.com` |
| `SAP_BRIDGE_KEY` | One of the keys in the bridge's `API_KEYS` (its `.env`) |
| `CF_ACCESS_CLIENT_ID` | The Cloudflare Access service token in front of the tunnel: Client ID |
| `CF_ACCESS_CLIENT_SECRET` | The same service token: Client Secret |

`SAP_BRIDGE_URL` and `SAP_BRIDGE_KEY` turn the feature on. The two Access values are strongly recommended, so that
nothing but this site can reach the bridge. To turn it off, delete `SAP_BRIDGE_URL` and redeploy; the load screen then offers **Use import files** (each
browser keeps that choice).

## Live mode (the default)

- **When the page opens** it reads `/api/sap/status`, then `/api/sap/kpi` and `/api/sap/supply-demand`. The last saved
  report and the last import are not reopened.
- **Every 5 minutes** while the page is open and visible it reads both again, through the bridge's 5-minute cache (no
  `refresh=1`), so SAP is asked at most once per 5 minutes however many people have the page open. A read that falls
  due while the tab is hidden happens when it is shown again. If SAP sent the same text as before nothing is reloaded
  (filters, scroll and open lists stay); new data reloads in place, on the same page with the same filters.
- **Refresh now** (the circular-arrows icon in the export-date popover, and Settings → Data Source) reads SAP at once
  and skips the cache. The bridge allows one such read every 30 seconds; a second one sooner gets the result just read.
  In the popover the arrows turn while SAP is read and the popover stays open, so the status line shows the result.
- **The live mark** left of the export date (on tablets and phones, on the date icon's corner): a short pipe with a
  green pulse running along it when the last read worked (tip: "Live · updated 2 min ago"), red and still when it did
  not ("Disconnected · showing data from 10:42", or "SAP not reachable" when the bridge sent its last good result
  because HANA could not be read: `X-Stale: 1`). No mark in import mode. With reduced motion the green pulse stands
  still. The popover's "Live SAP" label and Settings → Data Source show the same mark.
- **The export-date popover** is short: "Live SAP", the status line (and the bridge's message when disconnected), then
  three round icon buttons with tooltips: Refresh now, Add file, Share snapshot.
- **When the link drops** everything on screen stays. The page tries again after 30 s, 1, 2 and 5 minutes, then every
  5 minutes, and shows a short message only when the link drops and when it is back. The bridge's message (for example
  "SAP HANA could not be reached from the bridge PC… (bridge log ref ab12cd34)") is shown as it comes, in the popover
  and in Settings.
- **The last live data is kept in this browser** (IndexedDB `spyderKpiLive`, apart from the import copy): on the next
  visit it shows at once, with a red mark until the first read works, so the data from just before a disconnection stays
  until the link is back.
- **Add file** adds a Clear To Build workbook or the Logican sheet to the live data; it stays with it (also in the kept
  copy) when the live data updates. Dropping files on the page is off in live mode.
- Live reads are **not** written to the shared report store (`/api/report`), so the at-risk history does not get new
  weeks from live data (it still shows the weeks recorded from uploads). Notes and overrides work as before.
- If the supply / demand snapshot can't be read, the one already loaded stays.
- The live file is named `SAP_live_KPI_<date>.txt`. The header date is the query's `ExportDate`.
- `X-Refreshed-At` (the time the bridge read SAP) is ISO with a UTC offset on current bridges and is shown in local
  time; older bridges send the bridge PC's local time without an offset, which is read as local time.
- A shared snapshot always shows its own data. A `file://` copy or a static host has no bridge: pick **Import files**.

## Import mode

Settings → Data Source → **Import files**: exactly the upload flow of before. The last report reopens (the shared one,
or this browser's copy), the load screen has the drop area (and **Load from SAP** when the site has a bridge), and the
export-date popover has the file names and the icon buttons **Add file**, **New file** and **Share snapshot**. Settings → Data Source has **Upload files**,
**Add file** and **New file**. Switching back to Live SAP shows the kept live data and reads SAP.

## Data types

The bridge writes UTF-8 tab-separated text with a header row: dates `YYYY-MM-DD`, date-times `YYYY-MM-DD HH:MM:SS`,
plain decimals (`1234.5`, `-250.75`), floats as Python writes them (`1e-05`, `-0.0`), empty cells for NULL, and text
with tabs and line breaks made spaces. The page reads all of it exactly like a Query Manager export of the same lines
(`tests/bridge-data.test.js` compares every page). A whole number written as a float (`45001.0`) keys a line like
`45001`, so notes still find it.

## Keeping the queries in step

The bridge keeps its own copy of the SQL (`sql/kpi_dashboard.sql`, `sql/supply_demand.sql` in the bridge repo). When a
query in `queries/` changes, copy it to the bridge too, and to the saved query in Query Manager if people still export
by hand.

## Tests

`node tests/sap-api.test.mjs` (the function, with Ask AI's catalog and lookups), `node tests/ask-sap.test.js` (Ask AI's SAP
tools, source line and tables), `node tests/sap-live.test.js` (the page through the function, with a
stand-in bridge: start-up, the 5-minute read, disconnects, the kept data, Settings) and `node tests/bridge-data.test.js`
(the bridge's data types against a Query Manager export, with the bridge repo's fixture in `tests/fixtures/`). All are
part of `node tests/run-all.js`.
