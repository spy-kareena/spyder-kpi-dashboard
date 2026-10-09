# Spyder KPI Dashboard 1v2 - IT Hosting Notes

## What this is

This package is a static browser dashboard for SAP B1 KPI exports.

It does not need a database, application server, Node, Python, or internet access. The user opens the page, uploads Excel/CSV exports, and the dashboard processes the files in the browser.

## Files

- `index.html` - the dashboard page to host
- `queries/` - SAP B1 HANA query templates used to generate Excel exports
- `samples/` - example CSV for a local smoke test
- `VERSION.txt` - package/version marker
- `functions/` - Cloudflare Pages Functions: the sign-in gate, shared storage (`functions/api/report.js` the last report, `functions/api/notes.js` notes / overrides / causes, `functions/api/history.js` at-risk history) and the optional Ask AI key proxy (`functions/api/gemini/`)
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

The files of the last report are kept so the dashboard reopens on them; loading a new report replaces them.

- **Cloudflare Pages with shared storage:** a compressed copy of the files (about 1.5 MB for a year of SO/PO lines plus the Clear To Build workbook) is kept in Workers KV, and everyone who signs in opens on it. One upload replaces it for everyone. Setup below.
- **Other hosts, or Cloudflare without the binding:** the files are kept in each browser (IndexedDB, database `spyderKpiReport`). To remove them, clear the site data for the dashboard in the browser settings. On a shared computer, use a separate browser profile per person.

### Shared report storage (Cloudflare Pages)

1. Cloudflare dashboard > Storage & Databases > Workers KV > **Create namespace**, name it `spyder-kpi-report` (or run `npx wrangler kv namespace create spyder-kpi-report`).
2. Workers & Pages > **spyder-kpi-dashboard** > Settings > Bindings > **Add** > KV namespace: variable name `REPORT_STORE`, namespace `spyder-kpi-report`. Add it for Production (and Preview if previews should share it).
3. Redeploy (Deployments > latest > Retry deployment) so the binding takes effect. The sidebar then says "Saved for everyone who signs in" after an upload.

`/api/report`, `/api/notes` and `/api/history` sit behind the same sign-in as the page; only a signed-in page on the same site can change what is stored (requests from another site are refused). The same binding turns on shared notes and the at-risk history; nothing else needs setting up.

### What is stored in the KV namespace

| Key | What it holds | Written | Size |
|---|---|---|---|
| `report` | Compressed copy of the last loaded export files | Each upload (replaces the last one) | About 1.5 MB |
| `overrides` | Notes, override statuses, Us / Them causes and "deleted" flags on order lines, each with the editor's initials and the time of the edit; tracking numbers typed in on the Shipping page (`shipments`) | About 1 second after an edit stops (one write per batch of edits) | Capped at 5 MB |
| `history` | For each of the last 52 uploads (one per export date): the export date and the keys of the lines on the At Risk card (SO number, line, item, warehouse). Used to show how long a line has been at risk | Each upload | Capped at 8 MB |
| `tracking:*` | Reserved for live shipment tracking (Shipping page) | — | — |

A line key looks like `Sales Order|1234|5678|0|SPY-100|Spyder - Lacombe`. Notes are free text typed by users, so treat the namespace like the SAP export itself. Initials are what each person types the first time they edit a note (kept in their browser as `spyderKpiEditor`); they are not checked against accounts, since the site has one shared password.

How shared notes merge: every browser keeps its own copy (localStorage) and, when the page opens (and again when it comes back into view, at most once a minute), reads the server copy and merges line by line. The newer edit wins, so if two people change the same line the later change stays. Times come from each computer's clock; a time ahead of the server's is saved as the server's time. Workers KV has no locking, so two saves from different computers in the same second can, rarely, overwrite each other; the browser whose edit was lost still has it and sends it again the next time it opens the page. A line whose note was cleared is kept as a small marker (initials and time only) so other browsers drop their copy; markers older than 180 days are removed only when the 5 MB cap is reached. If the server cannot be reached, edits stay in that browser and are sent the next time the page opens. Hosts without these functions (IIS, a file share) keep notes in each browser, as before.

Free tier: 1,000 writes and 100,000 reads a day. One upload is two writes (report and history), each batch of note edits is one write, and each page open is three reads. A team of a few people stays well inside the limit.

To look at or clear what is stored (with the namespace id from the Cloudflare dashboard):

```
npx wrangler kv key get overrides --namespace-id <id> --remote
npx wrangler kv key delete report --namespace-id <id> --remote     # the shared report
npx wrangler kv key delete overrides --namespace-id <id> --remote  # every shared note, override and cause
npx wrangler kv key delete history --namespace-id <id> --remote    # the at-risk history ("first flagged" starts again)
```

Deleting `overrides` does not remove the notes kept in each person's browser: the next time they open the dashboard their copy is shared again. To start notes over, also clear the site data in each browser.

A **Share snapshot** file carries the loaded rows and the notes on those rows, so treat snapshot files like the SAP export itself.

## Security notes

- No external data upload is required by this package. The optional **Ask AI** panel sends questions and the data needed to answer them to Google's Gemini API, only after the user ticks a consent box; on the free tier Google may use that data to improve its products. See `docs/AI_ASSISTANT.md`. To offer it without per-user keys on Cloudflare Pages, set the `GEMINI_API_KEY` Pages secret; the `/api/gemini` proxy is behind the same sign-in gate. IIS has no proxy, so users there enter their own key.
- No SAP credentials are stored in the dashboard.
- SAP exports are loaded by the user from their local machine.
- Restrict access to internal users only. On Cloudflare Pages with `REPORT_STORE` bound, the last uploaded export, the shared notes and the at-risk history are stored in Workers KV and readable by anyone with the dashboard password; otherwise uploaded KPI data and notes never reach the server. The page itself lists customer codes (for segment grouping) and `queries/` shows SAP table/UDF names.
- Cloudflare Pages: set `DASHBOARD_PASSWORD` and `SESSION_SECRET` (32+ random characters) as Pages secrets for Production and Preview. Both are required; the site returns a "not configured" error until both are set. Changing either signs everyone out. Failed sign-ins are delayed by one second; for stronger protection put the project behind Cloudflare Access, or add a rate-limiting rule matching the path `/login` with method POST (and redirect `<project>.pages.dev` to the custom domain so the rule cannot be bypassed).
- IIS: this package does not configure authentication, because the IIS authentication sections are locked by default and a web.config that sets them would fail on a default install. To require Windows sign-in, install the Windows Authentication role service, then in IIS Manager for this site disable Anonymous Authentication, enable Windows Authentication, and add an Authorization rule for the allowed AD group. The included web.config hides the `functions` and `tests` folders.

## Tests

With Node 18+ (no install needed): `node tests/run-all.js`.

## Updating later

To update the dashboard later, replace `index.html` with a newer version and update `VERSION.txt`.
