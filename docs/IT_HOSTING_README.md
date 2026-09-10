# Spyder KPI Dashboard 1v0 - IT Hosting Notes

## What this is

This package is a static browser dashboard for SAP B1 KPI exports.

It does not need a database, application server, Node, Python, or internet access. The user opens the page, uploads Excel/CSV exports, and the dashboard processes the files in the browser.

## Files

- `index.html` - the dashboard page to host
- `queries/` - SAP B1 HANA query templates used to generate Excel exports
- `samples/` - example CSV for a local smoke test
- `VERSION.txt` - package/version marker
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

Important: saved notes/override selections are stored in that user's browser storage. They are not shared between users unless a shared backend is added later.

If the team needs shared live notes, the next version should add a shared storage layer such as SharePoint List, SQL database, or another internal API.

## Security notes

- No external data upload is required by this package.
- No SAP credentials are stored in the dashboard.
- SAP exports are loaded by the user from their local machine.
- Restrict access to internal users only, since uploaded KPI data may contain customer/order/vendor information.

## Updating later

To update the dashboard later, replace `index.html` with a newer version and update `VERSION.txt`.
