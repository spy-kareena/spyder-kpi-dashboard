# Spyder KPI Dashboard

A browser dashboard for Spyder Controls' SAP Business One KPI exports: order health, monthly shipments, warehouses, purchase orders, supply and shipping. The whole app is one `index.html`. On the hosted site the data comes live from SAP (or, in import mode, from the last uploaded report), and the notes are shared by everyone who signs in.

Live site: https://spyder-kpi-dashboard.pages.dev

## Use

1. Sign in. By default the dashboard reads SAP live through the SAP bridge and reads it again every 5 minutes; a green dot next to the date means live, red means the link is down and the last data stays on screen ([docs/LIVE_SAP.md](docs/LIVE_SAP.md)). To upload exports by hand instead, pick **Import files** in **Settings → Data Source** and load the KPI export (`queries/sap_b1_hana_kpi_current_dashboard_so_po_with_lagging.sql`). SAP's "Export to Excel" `.xls` works as-is, as do `.xlsx`, `.csv` and `.txt`.
2. Pick a page in the top menu (see **Pages**). Click a KPI card to list its lines. Rest on any card, bar, heading or button for a short tip; **About these numbers** at the bottom of a page defines its terms.
3. **Add note** on a line sets an override or a note (your name plus a ready-made or custom comment).
4. On Order Health, tick rows to set an override or a cause on many lines at once, or to delete them. Deleted lines can be restored in **Settings → Data Check**.

KPIs are calculated as of the export's `ExportDate`, so an older file or a shared snapshot keeps the numbers it had that day.

## Header

- **Export date:** the dot left of it shows Live SAP (green: live, red: disconnected; none when importing files). It opens a short popover. Live: the status, **Refresh now**, **Add file** (a Clear To Build workbook or the Logican sheet) and **Share snapshot**. Import: the file names, **Add file** (supply / demand, Clear To Build, Logican), **New file** (the load screen; the current report stays until the new file is read) and **Share snapshot** (a self-contained `.html` copy with the notes on its rows).
- **Search** (Ctrl+K, Cmd+K on a Mac): order lines by number, customer, vendor, item, warehouse, owner, tracking number or at-risk reason.
- **Ask AI:** a chat about the loaded export (see below).
- **Dark mode** and the **Settings** gear. The gear shows a red dot when rows or files need fixing in SAP, and a yellow dot when something is worth a look.

To print a page or save it as a PDF, use the browser's Print. In import mode, **Settings → Data Source → Upload files** loads several files at once (or drop them anywhere); the Import report says what each file was read as and how to fix a problem, and **Fix with AI** suggests a column mapping for a file it does not recognise (hosted site, with an Anthropic key).

## Pages

| Page | Menu | What it shows |
|---|---|---|
| Order Health | Top | **Leading:** at-risk orders, status and top reasons, open lines by due week, customers at risk (also by supply source), when flagged, date changes and the Lines table. **Lagging:** monthly and quarterly on time, fill rate, perfect order, days late, reschedule hit, late orders and top offenders. |
| Monthly | Top | Shipped and open sales-order value by month, year over year, and a ship target scenario |
| Warehouses | Top | Open value, late lines and risk by warehouse and due month |
| Metrics | Top | Order quality rates (on track, perfect order, backorder, partial ship) by due month |
| Shipping | Top | Recent SAP deliveries for every carrier, checked by hand: a Check link to each tracking page and a shared status. Demo data shows until a real status is saved. |
| Purchase Orders | Supply ▾ | Late, unconfirmed and no-commit PO lines, PO At Risk with its owners, Kits Clean / Kits Not Clean, receiving and late POs by vendor |
| Supply / Demand | Supply ▾ | Open demand against open PO supply by warehouse and month (needs the supply / demand snapshot, `queries/sap_b1_hana_supply_demand_snapshot_v2.sql`) |
| Supply Mix | Supply ▾ | Net quantity by month, demand by warehouse and risk by item group (needs the snapshot) |
| Build Risk | Supply ▾ | The Clear To Build report against open sales orders by CM and week (needs the Clear To Build workbook) |
| Forecast | Supply ▾ | The Logican forecast against open orders (needs the Logican sheet) |

## Settings

The gear opens Settings, also before an export is loaded:

- **Profile:** your name, stamped on the notes you save.
- **Order Health:** at-risk target, on-track tolerance, look-ahead window, lines shown, opening view.
- **Notes:** the ready-made comments for sales-order and purchase-order lines.
- **Shipping:** whether the page opens on demo shipments.
- **Pages & Display:** theme (light, dark, match system), background colour, line lists folded or open, when the Import report shows.
- **Data:** the loaded files, export date and where the report is saved. **Ask AI:** provider and model.
- **Data Check** (only when there is something to report): rows to fix in SAP, non-inventory charges, deleted lines with Restore.
- **Connect An AI App:** the MCP connector setup. **About:** the version, plus Export / Import settings as a small JSON file.

## Shared or per browser

- **Shared** on the hosted site (Workers KV binding `REPORT_STORE`): the last loaded report (`functions/api/report.js`); notes, overrides, causes, deleted lines, Kit Clean ticks and shipping statuses (`functions/api/notes.js`, newest edit per line wins); the list of names (`functions/api/people.js`); and the weekly at-risk history behind When flagged (`functions/api/history.js`, 52 weeks).
- **Per browser:** Settings, Ask AI consent, folded lists and theme. Without the server (a file copy or IIS), everything stays in that browser.

## Ask AI and the MCP connector

- **Ask AI** answers questions about the loaded export with the provider picked in Settings: Anthropic or ChatGPT (paid), or Groq or OpenRouter's free models. It uses the same numbers as the pages. The keys are server secrets (`functions/api/ai/`), and nothing is sent until the user ticks that provider's consent box. Setup, costs and data terms: [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md).
- **MCP connector:** `mcp/spyder-kpi-mcp.mjs` is a dependency-free MCP server (Node.js 20 or newer). It gives any desktop AI app that supports MCP the same read-only tools as Ask AI, reading export files on that computer. Setup: **Settings → Connect An AI App** or [docs/MCP.md](docs/MCP.md). Check it with `node mcp/spyder-kpi-mcp.mjs --check "C:\path\to\kpi_export.xls"`.

## Hosting

Cloudflare Pages serves the site (project `spyder-kpi-dashboard`, deployed from GitHub `spy-kareena/spyder-kpi-dashboard`, branch `main`). `functions/_middleware.js` is the sign-in gate: one shared password and a 14-day session cookie; `/logout` signs out. Shared data lives in the KV binding `REPORT_STORE`. **First deploy or new Cloudflare account: follow [docs/OWNER_CHECKLIST.md](docs/OWNER_CHECKLIST.md).**

Secrets are set with `npx wrangler pages secret put <NAME> --project-name spyder-kpi-dashboard`, never in this repo:

- `DASHBOARD_PASSWORD` and `SESSION_SECRET` (32 or more random characters): required. Without them every page returns "not configured", and changing either one signs everyone out.
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`: optional. Set at least one to turn on Ask AI.
- `SAP_BRIDGE_URL`, `SAP_BRIDGE_KEY`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`: optional. Turn on Live SAP through the SAP bridge ([docs/LIVE_SAP.md](docs/LIVE_SAP.md)).
- `FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET`: not used. The FedEx module (`shared/fedex.mjs`, `functions/api/shipping.js`, `workers/shipping-poller`) stays in the repo, undeployed; Shipping is checked by hand ([docs/SHIPPING.md](docs/SHIPPING.md)).

Keep these as encrypted secrets: the repo has a `wrangler.toml`, so plain-text variables typed into the Cloudflare dashboard are replaced on each deploy. On IIS or another static host, serve `index.html` as the default document; there is no sign-in gate, shared data or Ask AI there ([docs/IT_HOSTING_README.md](docs/IT_HOSTING_README.md)).

## Tests

No build step or dependencies. With Node.js 20 or newer:

```
node tests/run-all.js
```

This runs every `tests/*.test.js` and `*.test.mjs` file: the page's scripts, the Cloudflare functions, the shipping Worker, the MCP server and the hosting config files. They run against synthetic SAP-style exports, with no real data and no network.

## Files

- `index.html`: the whole app (HTML, CSS and JavaScript, with SheetJS Community Edition 0.20.3 built in as `<script id="sheetjs-lib">`)
- `functions/`: Cloudflare Pages Functions (sign-in, report, notes, people, history, Ask AI proxy, Live SAP)
- `mcp/`: the MCP connector
- `queries/`: SAP HANA queries for the KPI export and the supply / demand snapshot
- `docs/`: user quick start, owner checklist, hosting notes, Ask AI, MCP connector, Shipping and Live SAP
- `tests/`: the test suite; `samples/`: a tiny fake export for a smoke test
- `assets/`: the logo for the sign-in page (the only file served before sign-in)
- `shared/`, `workers/`: the unused FedEx code; `web.config`: IIS; `wrangler.toml`: Pages config; `VERSION.txt`: release notes

## Changing the page

- **Tooltips:** give an element `data-tip="one short sentence"` (amounts in full), or use `tipAttr(text)` / `tip(el, text)` in code. Do not add tooltip CSS.
- **Section help:** add `what` and `click` texts to `SECTION_INFO` and put `sectionTip('<key>')` on the title. About these numbers comes from `ABOUT_NOTES`, and column heading tips from `COLUMN_TIPS`.
- **Toasts:** `showToast('…')` shows a short confirmation that screen readers also read.
