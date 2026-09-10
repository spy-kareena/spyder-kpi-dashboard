# Spyder KPI Dashboard

Static, offline-capable browser dashboard for SAP B1 KPI exports. Open the page, upload Excel or CSV, and review order health, purchase orders, and supply/demand in the browser.

## Use

1. Open the hosted site or `index.html`.
2. Upload one combined export, or separate sales-order, delivery, PO, and supply/demand files.
3. Review the Order Health, Purchase Orders, and Supply / Demand tabs.

Notes and override selections stay in that browser only.

## Hosting

Cloudflare Pages serves the site and a login gate in `functions/_middleware.js`. Set the password as a Pages secret named `DASHBOARD_PASSWORD` — do not put it in this repo.

Open `/logout` to clear the sign-in cookie.

For IIS or another static host, serve `index.html` as the default document. That path does not use the Cloudflare login gate.

SAP query templates used to generate exports are in `queries/`.
