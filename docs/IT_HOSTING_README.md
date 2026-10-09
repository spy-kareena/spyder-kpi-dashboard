# Spyder KPI Dashboard 1v2 - IT Hosting Notes

## What this is

This package is a static browser dashboard for SAP B1 KPI exports.

It does not need a database, application server, Node, Python, or internet access. The user opens the page, uploads Excel/CSV exports, and the dashboard processes the files in the browser.

## Files

- `index.html` - the dashboard page to host
- `queries/` - SAP B1 HANA query templates used to generate Excel exports
- `samples/` - example CSV for a local smoke test
- `VERSION.txt` - package/version marker
- `functions/` - Cloudflare Pages Functions: the sign-in gate, the shared report store (`functions/api/report.js`) and the Ask AI proxy for Claude, ChatGPT, Groq and OpenRouter (`functions/api/ai/`)
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

`/api/report` sits behind the same sign-in as the page; only a signed-in page on the same site can replace the report. The free tier allows 1,000 writes and 100,000 reads a day (one write per upload, one read per page open). To delete the shared copy: `npx wrangler kv key delete report --namespace-id <id> --remote`.

Important: saved notes/override selections are stored in that user's browser storage. They are not shared live between users unless a shared backend is added later. A **Share snapshot** file does carry the loaded rows and the notes on those rows, so treat snapshot files like the SAP export itself.

If the team needs shared live notes, the next version should add a shared storage layer such as SharePoint List, SQL database, or another internal API.

## Security notes

- No external data upload is required by this package. The optional **Ask AI** panel sends questions and the data needed to answer them to the AI provider the user picks, only after the user ticks that provider's consent box. Paid providers (Claude, ChatGPT) do not train on API data; the free ones (Groq, OpenRouter free models) have weaker terms, and OpenRouter's free hosts may keep or publish prompts. See `docs/AI_ASSISTANT.md`.
- Ask AI keys (Cloudflare Pages secrets, each optional; set at least one to turn Ask AI on, for Production and Preview as needed, then redeploy):
  - `ANTHROPIC_API_KEY` - Claude (paid, billed to the Anthropic account)
  - `OPENAI_API_KEY` - ChatGPT (paid, billed to the OpenAI account)
  - `GROQ_API_KEY` - Groq (free tier)
  - `OPENROUTER_API_KEY` - OpenRouter (free models only)

  Set each with `npx wrangler pages secret put <NAME> --project-name spyder-kpi-dashboard`. The keys never reach the browser: the page calls `/api/ai/status` and `/api/ai/chat`, which sit behind the same sign-in gate, accept chat requests only from the dashboard page itself, cap each request at 1 MB and allow only listed models. Set a monthly spend limit on the paid accounts. IIS and other static hosts have no proxy, so Ask AI is not available there (users can connect Claude Desktop instead, see `docs/MCP.md`).
- No SAP credentials are stored in the dashboard.
- SAP exports are loaded by the user from their local machine.
- Restrict access to internal users only. On Cloudflare Pages with `REPORT_STORE` bound, the last uploaded export is stored in Workers KV and readable by anyone with the dashboard password; otherwise uploaded KPI data never reaches the server. The page itself lists customer codes (for segment grouping) and `queries/` shows SAP table/UDF names.
- Cloudflare Pages: set `DASHBOARD_PASSWORD` and `SESSION_SECRET` (32+ random characters) as Pages secrets for Production and Preview. Both are required; the site returns a "not configured" error until both are set. Changing either signs everyone out. Failed sign-ins are delayed by one second; for stronger protection put the project behind Cloudflare Access, or add a rate-limiting rule matching the path `/login` with method POST (and redirect `<project>.pages.dev` to the custom domain so the rule cannot be bypassed).
- IIS: this package does not configure authentication, because the IIS authentication sections are locked by default and a web.config that sets them would fail on a default install. To require Windows sign-in, install the Windows Authentication role service, then in IIS Manager for this site disable Anonymous Authentication, enable Windows Authentication, and add an Authorization rule for the allowed AD group. The included web.config hides the `functions` and `tests` folders.

## Tests

With Node 18+ (no install needed): `node tests/run-all.js`.

## Updating later

To update the dashboard later, replace `index.html` with a newer version and update `VERSION.txt`.
