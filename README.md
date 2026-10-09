# Spyder KPI Dashboard

Browser dashboard for SAP Business One KPI exports. Open the page, load an Excel or CSV export, and review order health, purchase orders, and supply in the browser. The export is read in the browser. On the hosted Cloudflare site a copy of the last loaded files is also kept on the server, so everyone who signs in sees the same report (see below).

Live site: https://spyder-kpi-dashboard.pages.dev

## Use

1. Sign in, then load the KPI export. SAP's "Export to Excel" `.xls` file works as-is, and so do `.csv` and `.xlsx`.
2. Use **Add file** at the bottom of the sidebar to load a supply/demand snapshot or a Clear To Build report next to the KPI export. **New file** opens the load screen. The current report stays loaded until a new file is read successfully. If two exports of the same report have different export dates, only the newest is used and **Data check** names the file left out.
3. Choose a page in the sidebar. Click a KPI card to list the lines behind it. Use **Add note** on a line to set an override, mark the cause (**Us** or **Them**) or write a note.
4. Not sure what a number means? Rest the pointer on any card, tile, chart bar, column heading, filter or button (or Tab to it, or press and hold on a phone) for a short plain-English explanation with the numbers in full. The **ⓘ** next to a section title explains what the section shows, which SAP fields feed it and what clicking does; the same texts are under **About these numbers** at the bottom of each page. Short first-visit hints can be closed with ×; **Show hints again** (sidebar, Help) brings them back.

| Group | Pages |
|---|---|
| Sales | Order Health, Monthly, Warehouse Timeline, Metrics Timeline, Shipping |
| Supply | Purchase Orders, Supply / Demand, Supply Mix, Build Risk |

KPIs are calculated as of the export's `ExportDate`, so an older file or a shared snapshot keeps the numbers it had on that day. Rows the export could not fully use (for example a due date typed as year 0202) are listed under the amber **Data check** pill next to the page title.

The last loaded files reopen on the next visit until a new export is loaded in their place: on Cloudflare Pages with the `REPORT_STORE` KV binding they are kept on the server for everyone who signs in (`functions/api/report.js`, setup in [docs/IT_HOSTING_README.md](docs/IT_HOSTING_README.md)); on other hosts they are kept in that browser. Notes, override statuses, Us / Them causes and deleted lines are shared the same way: on the hosted site everyone who signs in sees the same ones (`functions/api/notes.js`, merged line by line, the newest edit wins; the sidebar says "Notes shared · last edit KK Oct 8"), and each edit carries the editor's initials, asked once per browser. On other hosts, or when the server cannot be reached, they stay in that browser. **Share snapshot** saves a self-contained `.html` copy of the loaded data (compressed, about 2 MB for a year of SO/PO lines) with the notes for those rows. **Export PDF** prints the page that is open.

Supply / Demand and Supply Mix need `queries/sap_b1_hana_supply_demand_snapshot_v2.sql`. Build Risk needs the Clear To Build report as Excel or CSV. Until those files are added, those pages explain what to load.

- **Order Health tabs:** **Leading** shows what needs action now: the At risk cards, the open order states (On track, Due this week, Rescheduled, Past due, No commit; they add up to all open lines), the top 6 at-risk reasons by open value, **When flagged** (weeks since a line was first at risk, from the history of earlier uploads on the hosted site; with no history every line counts as new this week) and **Us vs Them** (who the at-risk value is waiting on: Us = Spyder, Them = the customer or carrier). **Lagging** shows how deliveries went: OTD 3 mo, shipped this week, fill rate, reschedule hit 12 mo, perfect order 12 mo and average days late 3 mo, each with a 12-month trend and the Us / Them split of its misses. The cause of a line is the one picked on it, else its override (for example Hold = Them, Supplier Late = Us), else its SAP signal (no commit date, past due with no reschedule = Us); the full rules are under **About these numbers** at the bottom of the page. Click a reason, a cause or a when-flagged bar to filter the page to those lines (chips under the tabs remove the filters). **Top offenders** draws each customer, warehouse, owner or vendor as blocks of $20,000 coloured by Us / Them; click one to filter the page to it.
- **Linked lines (Order Health):** tick rows, or the header box for the whole list, to set an override or a cause (**Set cause**) on many lines at once or to delete them. Deleted lines are hidden from every page (for everyone who signs in on the hosted site, otherwise in that browser) and can be restored from **Data check**. A short confirmation appears in the corner after Apply, Delete, Restore and when a note is saved. Click any column header to sort; click again to reverse. Purchase Orders linked lines are sorted with **Sort rows** and edited one line at a time.
- **Warehouse scorecard (Order Health):** the CM SFG warehouses and all other warehouses are listed as two groups in the one card, each with a subtotal row (open value, at-risk value, past-due lines, OTD 3 mo). The top 9 of each group show until **Show all**; clicking a row still focuses the page on that warehouse.
- **Search:** type in the box under the logo, or press Ctrl+K (Cmd+K on a Mac). It finds order lines by SO/PO, delivery or receipt number, customer PO, customer or vendor, item, warehouse, owner, project or FedEx tracking number, and by at-risk reason or cause (for example "no commit date", "supplier late" or "caused by them"). Every word must match. Notes can be edited from the results. Press Esc to go back.
- **Shipping (live FedEx):** recent deliveries with a FedEx tracking number (parcel and FedEx Freight LTL), with a 6-step progress strip (label created to delivered), cards for in transit, out for delivery, delivered this week, exceptions and in customs, the FedEx estimate against the promised date ("2 days late"), a cross-border section (clearance delays, days in customs), and **Add tracking #** for numbers that are not in SAP. Tracking numbers come from the `TrackingNumber` column the KPI query now adds to delivery rows (SAP `ODLN.TrackNo`; re-run the query once). FedEx is checked every 4 hours by the Worker in `workers/shipping-poller` and on **Refresh now** (`functions/api/shipping.js`, `shared/fedex.mjs`). Without that setup, or on a static host, the page lists the tracking numbers without live status. Setup, FedEx keys and limits: [docs/SHIPPING.md](docs/SHIPPING.md).
- **Build Risk:** add the "Orders At Risk - Clear to Build" workbook (.xlsx) with **Add file**. Every weekly "Orders at Risk" sheet is read; the page opens on the newest week, and **Report week** picks another. Weeks are never added together. "CTB % by CM" shows the last 8 weeks. The Lacombe block is shown but not matched to sales order lines.
- **Big picture:** a button on Order Health, Build Risk and Supply Mix opens a flow (Sankey) chart of the page: boxes in columns joined by bands as thick as the value they carry. Order Health shows open order value from warehouse to status to customer segment, and at-risk value from reason to Us / Them to customer (top 8, the rest grouped as Other). Build Risk shows each CM's orders in the picked report week flowing into clear to build, at risk and late, then the month due. Supply Mix shows open demand value from warehouse to item group to demand month, coloured by how well open POs cover it. The columns add up to the page's own cards. Hover or Tab to a box for its full numbers; click it (or press Enter / Space) to apply that page's filter: warehouse, segment, customer or the matching card on Order Health, the CM on Build Risk, the warehouse on Supply Mix (shared with Supply / Demand). Click the same warehouse, segment, customer or CM again to undo; boxes with no filter (months, item groups) stay highlighted until clicked again. Arrow keys move between boxes. The chart scrolls sideways inside its card on a phone, prints as drawn, and stays still when the computer asks for reduced motion. Which charts are open, and a CM picked on Build Risk, travel in a share snapshot. The layout is the page's own `sankeyLayout` (no chart library).
- **Ask AI:** a chat panel (page header) that answers questions about the loaded export with the AI provider you pick: Claude or ChatGPT (paid) or Groq or OpenRouter's free models (free), using the same numbers as the pages. The keys are server secrets shared by everyone who signs in (`functions/api/ai/`); nothing is sent to a provider until the user ticks its consent box. Setup, costs and each provider's data terms: [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md).
- **Connect an AI (MCP):** `mcp/spyder-kpi-mcp.mjs` is a dependency-free MCP server (Node 18+) that gives Claude Desktop, Claude Code and other MCP apps the same tools as Ask AI, reading SAP exports on that computer. Setup: the **Connect an AI** page (sidebar, Help) or [docs/MCP.md](docs/MCP.md). Check it with `node mcp/spyder-kpi-mcp.mjs --check "C:\path\to\kpi_export.xls"`.

## Hosting

Cloudflare Pages serves the site. Sign-in is the Pages Function in `functions/_middleware.js`. Production needs two secrets, set in the Cloudflare project and not in this repo:

- `DASHBOARD_PASSWORD` — the shared sign-in password
- `SESSION_SECRET` — 32 or more random characters that sign the session cookie
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` (each optional) — AI keys for Ask AI (Claude, ChatGPT, Groq, OpenRouter free models), shared by everyone who signs in (`functions/api/ai/`). Set at least one to turn Ask AI on; see [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md)
- `FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET` (optional) — FedEx Track API keys for the Shipping page's **Refresh now**; the 4-hourly checks run in the separate Worker `workers/shipping-poller`, which has its own copy of these secrets ([docs/SHIPPING.md](docs/SHIPPING.md))

One Workers KV namespace bound as `REPORT_STORE` holds what everyone shares: the last report (`report`), notes / overrides / causes and typed-in tracking numbers (`overrides`), and which lines were at risk in each of the last 52 uploads (`history`, used for "first flagged"). Setup and what is stored: [docs/IT_HOSTING_README.md](docs/IT_HOSTING_README.md).

Without the first two, every page returns a "not configured" error. Changing either of those two signs everyone out. Open `/logout` to clear the sign-in cookie. The sign-in page shows the logo from `assets/spyder-logo.jpg`; files directly in `assets/` are the only ones served before signing in (they hold nothing private).

For IIS or another static host, serve `index.html` as the default document. That path does not use the Cloudflare login gate. See `docs/IT_HOSTING_README.md`.

SAP query templates are in `queries/`.

The page uses the Inter font from Google Fonts. With no internet access it falls back to the system font. The logo is embedded in the page (a copy in `assets/` is used by the sign-in page).

### Page conventions (for whoever changes the page next)

- **Tooltips:** give any element `data-tip="plain-English text"` (write amounts in full, e.g. $1,721,806). One shared bubble shows it on hover, keyboard focus and a long press; `data-tip-pos="bottom"` (or `left` / `right`) picks the preferred side. Screen readers get the text as a description automatically; for an element built in code use `tip(el, text)`. Do not add tooltip CSS of your own.
- **Section ⓘ and About these numbers:** add the section's texts to `SECTION_INFO` in `index.html` and put `infoButton('<key>')` next to its title; `renderAbout([...keys])` builds the page's About block from the same texts. Column heading tips for data tables live in `COLUMN_TIPS`.
- **Toasts and hints:** `showToast('…')` shows a short confirmation (also read by screen readers). `renderHint('<id>', html)` returns a dismissable first-visit hint (stored in the browser under `spyderKpiHints`).

## Tests

No build step or dependencies. With Node 18 or newer:

```
node tests/run-all.js
```

That runs every `tests/*.test.js` and `*.test.mjs` file. They load the page's own scripts (`tests/harness.js`), the Cloudflare functions, the shipping poller Worker, and the MCP server over stdio, all against synthetic SAP-style exports and stand-ins for Workers KV and FedEx (no real data, no network).
