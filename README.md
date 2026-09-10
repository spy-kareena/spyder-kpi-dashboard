# Spyder KPI Dashboard

Static, offline-capable browser dashboard for SAP B1 KPI exports. Open the page, upload Excel or CSV, and review order health, purchase orders, and supply/demand in the browser.

## Use

1. Open the hosted site or `index.html`.
2. Upload one combined export, or separate sales-order, delivery, PO, and supply/demand files.
3. Review the Order Health, Purchase Orders, and Supply / Demand tabs.

Notes and override selections stay in that browser only.

## Hosting

This is a static site. Cloudflare Pages, IIS, or any static host can serve the folder as-is. Default document is `index.html`.

SAP query templates used to generate exports are in `queries/`.
