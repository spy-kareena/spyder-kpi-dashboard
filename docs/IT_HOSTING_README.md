# Spyder KPI Dashboard 1v2 - IT Hosting Notes

## What this is

This package is a static browser dashboard for SAP B1 KPI exports.

It does not need a database, application server, Node, Python, or internet access. The user opens the page, uploads Excel/CSV exports, and the dashboard processes the files in the browser.

## Files

- `index.html` - the dashboard page to host
- `queries/` - SAP B1 HANA query templates used to generate Excel exports
- `samples/` - example CSV for a local smoke test
- `VERSION.txt` - package/version marker
- `functions/` - Cloudflare Pages Functions: the sign-in gate and the optional Ask AI key proxy (`functions/api/gemini/`)
- `mcp/spyder-kpi-mcp.mjs` - optional MCP server users run on their own computer (Node 18+) to connect Claude or other AI apps; see `docs/MCP.md`
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

The files of the last report are kept in that browser (IndexedDB, database `spyderKpiReport`) so the report reopens on the next visit; loading a new report replaces them. To remove them, clear the site data for the dashboard in the browser settings. On a shared computer, use a separate browser profile per person.

Important: saved notes/override selections are stored in that user's browser storage. They are not shared live between users unless a shared backend is added later. A **Share snapshot** file does carry the loaded rows and the notes on those rows, so treat snapshot files like the SAP export itself.

If the team needs shared live notes, the next version should add a shared storage layer such as SharePoint List, SQL database, or another internal API.

## Security notes

- No external data upload is required by this package. The optional **Ask AI** panel sends questions and the data needed to answer them to Google's Gemini API, only after the user ticks a consent box; on the free tier Google may use that data to improve its products. See `docs/AI_ASSISTANT.md`. To offer it without per-user keys on Cloudflare Pages, set the `GEMINI_API_KEY` Pages secret; the `/api/gemini` proxy is behind the same sign-in gate. IIS has no proxy, so users there enter their own key.
- No SAP credentials are stored in the dashboard.
- SAP exports are loaded by the user from their local machine.
- Restrict access to internal users only. Uploaded KPI data never reaches the server, but the page itself lists customer codes (for segment grouping) and `queries/` shows SAP table/UDF names.
- Cloudflare Pages: set `DASHBOARD_PASSWORD` and `SESSION_SECRET` (32+ random characters) as Pages secrets for Production and Preview. Both are required; the site returns a "not configured" error until both are set. Changing either signs everyone out. Failed sign-ins are delayed by one second; for stronger protection put the project behind Cloudflare Access, or add a rate-limiting rule matching the path `/login` with method POST (and redirect `<project>.pages.dev` to the custom domain so the rule cannot be bypassed).
- IIS: this package does not configure authentication, because the IIS authentication sections are locked by default and a web.config that sets them would fail on a default install. To require Windows sign-in, install the Windows Authentication role service, then in IIS Manager for this site disable Anonymous Authentication, enable Windows Authentication, and add an Authorization rule for the allowed AD group. The included web.config hides the `functions` and `tests` folders.

## Tests

With Node 18+ (no install needed): `node tests/run-all.js`.

## Updating later

To update the dashboard later, replace `index.html` with a newer version and update `VERSION.txt`.
