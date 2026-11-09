# Live SAP (2v6.7)

**Load from SAP** reads the KPI query and the supply / demand snapshot straight from SAP Business One, instead of
someone running them in Query Manager and uploading the export. The live data goes through the same steps as an upload:
the same numbers, Data Check, notes, at-risk history, and the report saved for everyone who signs in.

Until the settings below are in place, nothing changes: the button does not show and files are uploaded as before.

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

## Settings (Pages secrets)

In the Cloudflare dashboard: **Workers & Pages → kpi-dashboard-spyder → Settings → Variables and Secrets**, type
**Secret**. Add them to **Preview** first to try the branch preview, then to **Production**, and redeploy. From a terminal:
`npx wrangler pages secret put <NAME> --project-name kpi-dashboard-spyder`. The Cloudflare project is named
`kpi-dashboard-spyder`; some older notes in this repo say `spyder-kpi-dashboard`.

| Secret | What it is |
|---|---|
| `SAP_BRIDGE_URL` | The bridge's tunnel address, e.g. `https://sap-bridge.yourdomain.com` |
| `SAP_BRIDGE_KEY` | One of the keys in the bridge's `API_KEYS` (its `.env`) |
| `CF_ACCESS_CLIENT_ID` | The Cloudflare Access service token in front of the tunnel: Client ID |
| `CF_ACCESS_CLIENT_SECRET` | The same service token: Client Secret |

`SAP_BRIDGE_URL` and `SAP_BRIDGE_KEY` turn the feature on. The two Access values are strongly recommended, so that
nothing but this site can reach the bridge. To turn it off, delete `SAP_BRIDGE_URL` and redeploy.

## Using it

- **Load screen:** **Load from SAP** under the drop area.
- **On a report:** the export-date popover has **Refresh from SAP**.
- Both read SAP now (they skip the bridge's 5-minute cache) and replace the loaded SAP export.
- A Clear To Build workbook or Logican sheet already loaded stays. Those still come as files.
- If the supply / demand snapshot can't be read, the one already loaded stays and a message says so.
- If SAP can't be read at all, the report on screen stays and a message gives the reason. Common reasons: the bridge
  PC is off, the tunnel isn't running, or the HANA password changed.
- The live file is named `SAP_live_KPI_<date>.txt`. Its export date is the day it was read, like a fresh export.

## Keeping the queries in step

The bridge keeps its own copy of the SQL (`sql/kpi_dashboard.sql`, `sql/supply_demand.sql` in the bridge repo). When a
query in `queries/` changes, copy it to the bridge too, and to the saved query in Query Manager if people still export
by hand.

## Tests

`node tests/sap-api.test.mjs` (the function) and `node tests/sap-live.test.js` (the page through the function, with a
stand-in bridge). Both are part of `node tests/run-all.js`.
