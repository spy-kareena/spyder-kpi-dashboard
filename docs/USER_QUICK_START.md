# Spyder KPI Dashboard 1v2 - User Quick Start

1. Open the dashboard link from IT.
2. Run the SAP KPI query (`queries/sap_b1_hana_kpi_current_dashboard_so_po_with_lagging.sql`).
3. Export the result to Excel (SAP saves it as an `.xls` file; upload it as-is).
4. Upload the file into the dashboard.
5. Use the Order Health and Purchase Orders pages (left sidebar) to review risks, reschedules, OTD, and notes. Click a KPI card to see its lines; use **Add note** on a line to set an override or write a note.
6. Optional: run `queries/sap_b1_hana_supply_demand_snapshot_v2.sql`, export it, and click **Add file** (bottom of the sidebar) to load it next to the KPI export for the Supply / Demand and Supply Mix pages.
7. Optional: add the "Orders At Risk - Clear to Build" workbook with **Add file** for the Build Risk page. It opens on the newest week; pick another under **Report week**.

**What does this number mean?** Rest the pointer on any card, chart bar, column heading, filter or button (or press Tab to reach it, or press and hold it on a phone) for a short explanation with the full amounts. Click the **ⓘ** next to a section title to see what the section shows, where its numbers come from in SAP and what clicking does. **About these numbers** at the bottom of each page has the same explanations in one place. The first time you open a page a short hint may appear; close it with ×. **Show hints again** in the sidebar (under Help) brings the hints back.

On Order Health, the **Warehouse scorecard** lists the CM SFG warehouses and all other warehouses as two groups, each with a subtotal row. Click a warehouse row to show only that warehouse on the page; click it again to show all.

On the Order Health linked-lines list, tick rows (or the header box for the whole list) to set an override on many lines at once or delete them. Deleted lines are hidden on every page in your browser; restore them from **Data check**. A short confirmation appears in the bottom corner after Apply, Delete, Restore and when you close a note. Click a column header to sort. On Purchase Orders, sort with **Sort rows** and use **Add note** on each line.

Use the search box under the logo (or press Ctrl+K, Cmd+K on a Mac) to find any order line by number, customer, vendor, item or warehouse.

**Ask AI** opens a chat on the right. Ask things like "What is at risk right now?" or "Which vendors have the most late POs?". It sends your question and the data needed to answer it to Google Gemini, so only use it for data your company has approved for sharing. Setup and privacy: docs/AI_ASSISTANT.md.

**Help > Connect an AI** in the sidebar shows how to use the same data from Claude Desktop, Claude Code or another MCP app. The page opens before an export is loaded.

The page header shows the date the KPIs are calculated for (the export date). If the amber **Data check** pill appears, click it to see the SAP rows with unreadable dates (for example a year typed as 0202 or 2626); fix those in SAP and re-export.

The dashboard remembers the last files loaded: anyone who opens the hosted site sees that report, on any computer, until someone loads a new export with **New file** (which replaces it for everyone). The sidebar says "Saved for everyone who signs in" once it is stored; "Saved in this browser only" means the site has no shared storage set up. Notes and override dropdown selections save in your own browser. If you switch computers or browsers, those saved notes will not follow automatically. **Share snapshot** makes a file that includes all loaded rows and the notes on them.
