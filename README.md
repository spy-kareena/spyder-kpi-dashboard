# Spyder KPI Dashboard

Browser dashboard for SAP Business One KPI exports. Open the page, load an Excel or CSV export, and review order health, purchase orders, and supply in the browser. The export is read in the browser. On the hosted Cloudflare site a copy of the last loaded files is also kept on the server, so everyone who signs in sees the same report (see below).

Live site: https://spyder-kpi-dashboard.pages.dev

## Use

1. Sign in, then load the KPI export. SAP's "Export to Excel" `.xls` file works as-is, and so do `.csv` and `.xlsx`.
2. Use **Add file** at the bottom of the sidebar to load a supply/demand snapshot or a Clear To Build report next to the KPI export. **New file** opens the load screen. The current report stays loaded until a new file is read successfully. If two exports of the same report have different export dates, only the newest is used and **Data check** names the file left out.
3. Choose a page in the sidebar. Click a KPI card to list the lines behind it. Use **Add note** on a line to set an override or write a note.
4. Not sure what a number means? Rest the pointer on any card, tile, chart bar, column heading, filter or button (or Tab to it, or press and hold on a phone) for a short plain-English explanation with the numbers in full. The **ⓘ** next to a section title explains what the section shows, which SAP fields feed it and what clicking does; the same texts are under **About these numbers** at the bottom of each page. Short first-visit hints can be closed with ×; **Show hints again** (sidebar, Help) brings them back.

| Group | Pages |
|---|---|
| Sales | Order Health, Monthly, Warehouse Timeline, Metrics Timeline |
| Supply | Purchase Orders, Supply / Demand, Supply Mix, Build Risk |

KPIs are calculated as of the export's `ExportDate`, so an older file or a shared snapshot keeps the numbers it had on that day. Rows the export could not fully use (for example a due date typed as year 0202) are listed under the amber **Data check** pill next to the page title.

The last loaded files reopen on the next visit until a new export is loaded in their place: on Cloudflare Pages with the `REPORT_STORE` KV binding they are kept on the server for everyone who signs in (`functions/api/report.js`, setup in [docs/IT_HOSTING_README.md](docs/IT_HOSTING_README.md)); on other hosts they are kept in that browser. Notes and override selections stay in that browser only. **Share snapshot** saves a self-contained `.html` copy of the loaded data (compressed, about 2 MB for a year of SO/PO lines) with the notes for those rows. **Export PDF** prints the page that is open.

Supply / Demand and Supply Mix need `queries/sap_b1_hana_supply_demand_snapshot_v2.sql`. Build Risk needs the Clear To Build report as Excel or CSV. Until those files are added, those pages explain what to load.

- **Linked lines (Order Health):** tick rows, or the header box for the whole list, to set an override on many lines at once or to delete them. Deleted lines are hidden from every page in that browser and can be restored from **Data check**. A short confirmation appears in the corner after Apply, Delete, Restore and when a note is saved. Click any column header to sort; click again to reverse. Purchase Orders linked lines are sorted with **Sort rows** and edited one line at a time.
- **Warehouse scorecard (Order Health):** the CM SFG warehouses and all other warehouses are listed as two groups in the one card, each with a subtotal row (open value, at-risk value, past-due lines, OTD 3 mo). The top 9 of each group show until **Show all**; clicking a row still focuses the page on that warehouse.
- **Search:** type in the box under the logo, or press Ctrl+K (Cmd+K on a Mac). It finds order lines by SO/PO, delivery or receipt number, customer PO, customer or vendor, item, warehouse, owner or project. Every word must match. Notes can be edited from the results. Press Esc to go back.
- **Build Risk:** add the "Orders At Risk - Clear to Build" workbook (.xlsx) with **Add file**. Every weekly "Orders at Risk" sheet is read; the page opens on the newest week, and **Report week** picks another. Weeks are never added together. "CTB % by CM" shows the last 8 weeks. The Lacombe block is shown but not matched to sales order lines.
- **Ask AI:** a chat panel (page header) that answers questions about the loaded export with Google Gemini, using the same numbers as the pages. Nothing is sent until the user agrees to the privacy note. Keys, the optional server key and the free-tier data terms: [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md).
- **Connect an AI (MCP):** `mcp/spyder-kpi-mcp.mjs` is a dependency-free MCP server (Node 18+) that gives Claude Desktop, Claude Code and other MCP apps the same tools as Ask AI, reading SAP exports on that computer. Setup: the **Connect an AI** page (sidebar, Help) or [docs/MCP.md](docs/MCP.md). Check it with `node mcp/spyder-kpi-mcp.mjs --check "C:path	okpi_export.xls"`.

## Hosting

Cloudflare Pages serves the site. Sign-in is the Pages Function in `functions/_middleware.js`. Production needs two secrets, set in the Cloudflare project and not in this repo:

- `DASHBOARD_PASSWORD` — the shared sign-in password
- `SESSION_SECRET` — 32 or more random characters that sign the session cookie
- `GEMINI_API_KEY` (optional) — a Gemini API key for Ask AI, so users don't need their own (`functions/api/gemini/`)

Without both, every page returns a "not configured" error. Changing either one signs everyone out. Open `/logout` to clear the sign-in cookie. The sign-in page shows the logo from `assets/spyder-logo.jpg`; files directly in `assets/` are the only ones served before signing in (they hold nothing private).

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

That runs every `tests/*.test.js` and `*.test.mjs` file. They load the page's own scripts (`tests/harness.js`), the Cloudflare functions, and the MCP server over stdio, all against synthetic SAP-style exports (no real data).
