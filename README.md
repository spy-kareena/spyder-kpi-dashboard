# Spyder KPI Dashboard

Browser dashboard for SAP Business One KPI exports: load an Excel or CSV export and review order health, purchase orders and supply. The export is read in the browser; the hosted Cloudflare site also keeps a copy of the last loaded files on the server, so everyone who signs in sees the same report (see below).

Live site: https://spyder-kpi-dashboard.pages.dev

## Use

1. Sign in and load the KPI export. SAP's "Export to Excel" `.xls` works as-is, as do `.csv` and `.xlsx`.
2. **Add file** (the export-date popover in the header) loads a supply/demand snapshot or a Clear To Build report next to the KPI export. **New file** opens the load screen; the current report stays until a new file is read. If two exports of the same report have different export dates, only the newest is used and **Data check** names the file left out.
3. Pick a page in the top menu (Order Health · Monthly · Warehouses · Metrics · Shipping · **Supply** ▾). Ask AI, Export PDF, search and your name are the icons at the right; Share snapshot, Change name and Connect an AI are in the avatar menu. Click a KPI card to list its lines. **Add note** on a line sets an override or a note: pick your name and a ready-made comment, or write your own.
4. Rest the pointer on any card, chart bar, column heading, filter or button (or Tab to it, or press and hold on a phone) for a short tip with the numbers in full. Rest on a section title the same way for what that section shows and what clicking does; **About these numbers** at the bottom of each page defines the key terms. First-visit hints close with ×; **Show hints again** (sidebar, Help) brings them back.

| Page | Menu | What it shows |
|---|---|---|
| Order Health | Top menu | **Leading** (what needs action now: at-risk orders with the most affected warehouse, production issues and override tiles, status and top reasons, open lines by due week, customers at risk, when flagged, date changes and what the CM can deliver, and the Lines table) and **Lagging** (monthly and quarterly on-time, fill rate, perfect order, days late, reschedule hit and late orders against the period before, and top offenders by warehouse and vendor), switched at the top |
| Monthly | Top menu | Shipped and open sales-order value by month, year over year, and a ship target scenario |
| Warehouses | Top menu | Open value, late lines and on-track rate by warehouse and due month, plus **Warehouses to watch** |
| Metrics | Top menu | Order quality rates (on-track, perfect order, backorder, partial ship) and risk by due month |
| Shipping | Top menu | Recent deliveries for every carrier, checked by hand: a Check link to each tracking page and a shared manual status (demo data shown by default until the owner asks to remove it) |
| Purchase Orders | Supply ▾ | Late, unconfirmed and no-commit PO lines, receiving performance and late value by vendor |
| Supply / Demand | Supply ▾ | Open sales-order demand against open PO supply by warehouse and month: shortages and risky supply (needs the supply / demand snapshot) |
| Supply Mix | Supply ▾ | Net quantity by month, demand by warehouse, risk by item group, and **Big picture** (needs the supply / demand snapshot) |
| Build Risk | Supply ▾ | The Clear To Build report matched to open sales orders by CM and month, and **Big picture** (needs the Clear To Build workbook) |
| Connect an AI | Avatar menu | How to ask an AI about the export: **Ask AI** on the site, or Claude Desktop / Claude Code through the MCP connector |

KPIs are calculated as of the export's `ExportDate`, so an older file or a shared snapshot keeps the numbers it had that day. Rows the export could not fully use (for example a due date typed as year 0202) are listed under the amber **Data check** pill next to the page title.

What is kept, and for whom:

- **Shared report:** the last loaded files reopen on the next visit until a new export replaces them. On Cloudflare Pages with the `REPORT_STORE` KV binding they are kept on the server for everyone who signs in (`functions/api/report.js`; the sidebar says "Saved for everyone who signs in"); on other hosts, in that browser.
- **Shared notes:** notes, override statuses, deleted lines, and tracking numbers and statuses typed in on the Shipping page are shared the same way: on the hosted site everyone who signs in sees the same ones (`functions/api/notes.js`, merged line by line, the newest edit wins; the sidebar says "Notes shared · last edit Kareena · Oct 8"), and each edit carries the editor's name, asked once per browser. Names are saved for everyone (`functions/api/people.js`), so anyone asked later picks theirs with one click; × next to a name removes it, and a name not used for 180 days drops off. On other hosts, or when the server cannot be reached, they stay in that browser and are sent the next time the page opens.
- **At-risk history:** each upload on the hosted site records which lines were on the At Risk card (`functions/api/history.js`, one entry per week, last 52 weeks); it drives **When flagged** on Order Health.
- **Share snapshot** saves a self-contained `.html` copy of the loaded data (compressed, about 2 MB for a year of SO/PO lines) with the notes for those rows. **Export PDF** prints the open page.

Supply / Demand and Supply Mix need `queries/sap_b1_hana_supply_demand_snapshot_v2.sql`; Build Risk needs the Clear To Build report as Excel or CSV. Until then those pages say what to load.

- **Order Health tabs:** a pill switch at the top left picks **Leading** or **Lagging**; filters (Warehouse, Segment, Customer, plus Department / Project / Order type when the export has them) sit at the right and persist across the switch. **Leading** shows what needs action now: **At risk** (order count first, with the most affected warehouse, its production issues and the by-override tiles), **Status & top reasons** (On track, Due this week, Rescheduled, Past due, No commit, then the top at-risk reasons as bars), **Open lines by due week**, **Customers at risk**, **When flagged** (weeks since a line was first at risk, from earlier uploads on the hosted site; with no history every line counts as new), **Date changes** (open sales-order lines whose date moved more than 2 days past due, and whether the CM can deliver them: ready or blocked, from the CM sheet) and the **Lines** table. **Lagging** shows how deliveries went: **Monthly** and **Quarterly** cards (on time, fill rate, perfect order, average days late, reschedule hit, late orders, each against the period before) and **Top offenders** by warehouse and by vendor. Click any number or bar to filter the page (the Lines table narrows to match). The six by-override tiles are Shipping Delay, QC Delay, R&D Hold, Supplier Delay, Supply Chain Delay and Wait on Prod; those last three are shown in these words everywhere (dropdowns, charts, Search, Ask AI) but stored, and read from SAP's OverrideStatus, as Supplier Late, Supply Chain and Waiting on Production.
- **Lines to act on (Order Health):** tick rows, or the header box for the whole list, to set an override or a cause (**Set cause**) on many lines at once or to delete them. Deleted lines are hidden from every page (for everyone who signs in on the hosted site, otherwise in that browser) and can be restored from **Data check**. A short confirmation appears after Apply, Delete, Restore and a saved note. Click a column header to sort, again to reverse. Purchase Orders linked lines are sorted with **Sort lines** and edited one line at a time.
- **Warehouse scorecard (Order Health):** CM SFG warehouses and all other warehouses are two groups in one card, each with a subtotal row (open value, at-risk value, past-due lines, OTD 3 mo). The top 9 of each group show until **Show all**; clicking a row focuses the page on that warehouse.
- **Search:** type in the box under the logo, or press Ctrl+K (Cmd+K on a Mac). It finds order lines by SO/PO, delivery or receipt number, customer PO, customer or vendor, item, warehouse, owner, project or tracking number, and by at-risk reason or cause (for example "no commit date", "supplier late" or "caused by them"). Every word must match. Notes can be edited from the results; Esc goes back.
- **Shipping (checked by hand):** recent SAP deliveries with a tracking number, for every carrier (`TrackingNumber` = SAP `ODLN.TrackNo`, `ShipMethod` = the delivery's shipping type; re-run the KPI query once). Each shipment has a **Check** link to AfterShip's public tracking page (new tab); whoever checks sets **Shipped / In transit / Delayed / Delivered** with a date and a short note, saved with the shared notes so everyone sees it. Cards: in transit, delayed, delivered this week and not checked in 2+ days; a 3-step strip per shipment; a cross-border section; **Add tracking #** for numbers not in SAP. Until a real status is saved the page shows clearly labelled **demo data** (12 made-up shipments, toggle in the bar); demo data never counts anywhere else. The page calls no tracking API; the FedEx code (`shared/fedex.mjs`, `functions/api/shipping.js`, `workers/shipping-poller`) stays in the repo unused. Details: [docs/SHIPPING.md](docs/SHIPPING.md).
- **Build Risk:** add the "Orders At Risk - Clear to Build" workbook (.xlsx) with **Add file**. Every weekly "Orders at Risk" sheet is read; the page opens on the newest week and **Report week** picks another. Weeks are never added together. "CTB % by CM" shows the last 8 weeks. The Lacombe block is shown but not matched to sales order lines.
- **Big picture:** the **Big picture** switch at the top right of Order Health, Build Risk and Supply Mix shows a flow (Sankey) chart at the top of the page (on Order Health, below the filters; on there until you switch it off, off elsewhere until you switch it on; each browser remembers it): boxes in columns joined by bands as thick as the value they carry. Order Health: open order value from warehouse to status to customer segment, or at-risk value from reason to Us / Them to customer (top 8, the rest grouped as Other; pick the chart in the card). Build Risk: each CM's orders in the picked report week into clear to build, at risk and late, then the month due. Supply Mix: open demand value from warehouse to item group to demand month, coloured by open PO coverage. The columns add up to the page's own cards. Hover a box for its numbers (from the keyboard each chart is one Tab stop; arrow keys move between boxes); click it (or Enter / Space) to apply that page's filter: warehouse, segment, customer or the matching card on Order Health, the CM on Build Risk, the warehouse on Supply Mix (shared with Supply / Demand). Click the same box again to undo; boxes with no filter (months, item groups) stay highlighted until clicked again. On a phone the chart scrolls sideways inside its card; it prints as drawn (without the hover / click hints) and stays still when the computer asks for reduced motion. The switches, the Order Health chart picked and a CM picked on Build Risk travel in a share snapshot. The layout is the page's own `sankeyLayout` (no chart library).
- **Ask AI:** a chat panel (page header) that answers questions about the loaded export with the provider you pick: Claude or ChatGPT (paid), or Groq or OpenRouter's free models, using the same numbers as the pages. The keys are server secrets shared by everyone who signs in (`functions/api/ai/`); nothing is sent to a provider until the user ticks its consent box. Setup, costs and data terms: [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md).
- **Connect an AI (MCP):** `mcp/spyder-kpi-mcp.mjs` is a dependency-free MCP server (Node.js 20 or newer) that gives Claude Desktop, Claude Code and other MCP apps the same tools as Ask AI, reading SAP exports on that computer. Setup: the **Connect an AI** page (sidebar, Help) or [docs/MCP.md](docs/MCP.md). Check it with `node mcp/spyder-kpi-mcp.mjs --check "C:\path\to\kpi_export.xls"`.
- **Page layout:** each page is a few named groups in the same order: a summary first, breakdowns named **By …**, then **Lines to act on** (with a count pill); at most four cards in a row; what a card counts is in its tooltip. On Supply / Demand the short or at-risk lines are one table with a sub-heading per warehouse and a **Supply at risk only** chip; Supply Mix shows the gaps by month, warehouse and item group and leaves the totals and lines to Supply / Demand. Long lists open on request and always print: **All open lines** on Supply / Demand (**Show all**) and the **Scenario lines** on Monthly (**Show lines**). On a phone, order lines and table rows stack as cards. The load screen lists what each page shows. On Build Risk the report's line count sits next to **Report week**, and each order's override and cause read as text with one **Edit** button and an Amount column; on Purchase Orders the reschedule date (↻) sits under each line's status.

## Hosting

Cloudflare Pages serves the site (project `spyder-kpi-dashboard`, deployed from GitHub `spy-kareena/spyder-kpi-dashboard`, branch `main`). Sign-in is the Pages Function in `functions/_middleware.js`. **First deploy or new Cloudflare account: follow [docs/OWNER_CHECKLIST.md](docs/OWNER_CHECKLIST.md)** (KV namespace, secrets, checks after deploy).

Secrets are set in Cloudflare (`npx wrangler pages secret put <NAME> --project-name spyder-kpi-dashboard`, or `npx wrangler secret put <NAME>` for the Worker), never in this repo:

| Secret | Where | Needed? | What it is for |
|---|---|---|---|
| `DASHBOARD_PASSWORD` | Pages | Required | The shared sign-in password |
| `SESSION_SECRET` | Pages | Required | 32 or more random characters that sign the session cookie |
| `ANTHROPIC_API_KEY` | Pages | Optional | Ask AI with Claude (paid) |
| `OPENAI_API_KEY` | Pages | Optional | Ask AI with ChatGPT (paid) |
| `GROQ_API_KEY` | Pages | Optional | Ask AI with Groq (free) |
| `OPENROUTER_API_KEY` | Pages | Optional | Ask AI with OpenRouter's free models (free) |
| `FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET` | Worker `workers/shipping-poller` (not deployed) | Not used since 2v4 | FedEx Track API keys for the dormant FedEx module; Shipping is checked by hand |

Set at least one AI key to turn Ask AI on ([docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md)); the AI keys are shared by everyone who signs in (`functions/api/ai/`). The FedEx Worker and keys are not needed: the Shipping page is checked by hand ([docs/SHIPPING.md](docs/SHIPPING.md)). Keep `DASHBOARD_PASSWORD` and `SESSION_SECRET` as encrypted secrets: the repo has a `wrangler.toml`, so plain-text variables typed into the Cloudflare dashboard are replaced on each deploy.


Without the two required secrets every page returns a "not configured" error; changing either signs everyone out. Open `/logout` to clear the sign-in cookie. The sign-in page shows the logo from `assets/spyder-logo.png`, the only file served before signing in (it holds nothing private).

For IIS or another static host, serve `index.html` as the default document. That path does not use the Cloudflare login gate. See `docs/IT_HOSTING_README.md`.

SAP query templates are in `queries/`.

The page uses the Inter font from Google Fonts and falls back to the system font offline. The logo is embedded in the page (the sign-in page uses the copy in `assets/`). Excel and CSV files are read by SheetJS Community Edition 0.20.3, built into `index.html` (the `<script id="sheetjs-lib">` block); to update it, replace that block's contents with a newer `xlsx.full.min.js` from https://cdn.sheetjs.com and run the tests.

### Page conventions (for whoever changes the page next)

- **Tooltips:** give any element `data-tip="plain-English text"`: one short sentence, about 20 words at most, amounts in full (e.g. $1,721,806). One shared bubble shows it on hover, keyboard focus and a long press; `data-tip-pos="bottom"` (or `left` / `right`) picks the preferred side. Screen readers get the text as a description automatically (not when the element's `aria-label` is the same text, so a row named by its tip is read once); for an element built in code use `tip(el, text)`. A control inside a modal `<dialog>` gets its bubble drawn inside that dialog, and Esc there closes both. Do not add tooltip CSS of your own. Wrap a wide table in `<div class="table-scroll" tabindex="0" role="region" aria-label="…">` so a keyboard can scroll it.
- **Section help and About these numbers:** add the section's `what` and `click` texts (one short sentence each) to `SECTION_INFO` in `index.html` and put `sectionTip('<key>')` on its title (`<h2${sectionTip('<key>')}>`; `pageGroupHtml` and `renderTableCard` take it as `info`). The text is the title's tooltip: there is no ⓘ button. `renderAbout([...keys])` builds the page's About list from `ABOUT_NOTES` (3 to 5 short definitions per page, picked by the keys' prefix). Column heading tips live in `COLUMN_TIPS` (a `"<table key>|<heading>"` entry wins over the plain heading); a hand-built table header uses `tipAttr(columnTip('<table key>', label))`, so every heading has a tip.
- **Toasts:** `showToast('…')` shows a short confirmation (also read by screen readers).

## Tests

No build step or dependencies. With Node.js 20 or newer:

```
node tests/run-all.js
```

That runs every `tests/*.test.js` and `*.test.mjs` file: the page's own scripts (`tests/harness.js`), the Cloudflare functions, the shipping poller Worker and the MCP server over stdio, all against synthetic SAP-style exports and stand-ins for Workers KV and FedEx (no real data, no network), plus a check that the hosting files (`wrangler.toml`, the Worker's `wrangler.toml`, `web.config`) agree.
