# Spyder KPI Dashboard 2v2 - IT Hosting Notes

## What this is

A browser dashboard for SAP B1 KPI exports: users upload Excel/CSV exports and the page processes them in the browser.

There are two ways to host it:

- **Cloudflare Pages (the live site, https://spyder-kpi-dashboard.pages.dev):** adds a sign-in page, one shared report and shared notes for everyone who signs in, the at-risk history, Ask AI and shared Shipping statuses (checked by hand). These use the Pages Functions in `functions/` and one Workers KV namespace. Settings are listed under "Cloudflare settings at a glance" below; the owner's step-by-step list is [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md).
- **IIS or any other static web server:** serve the folder as it is. It needs no database, application server, Node, Python or internet access. Reports, notes and Shipping statuses stay in each browser, and Ask AI is not available.

## Files

- `index.html` - the dashboard page to host. The spreadsheet reader, SheetJS Community Edition 0.20.3 (`xlsx.full.min.js` from cdn.sheetjs.com, Apache 2.0 licence), is built into it, so no script is loaded from the internet
- `assets/spyder-logo.jpg` - the logo shown on the Cloudflare sign-in page (the dashboard itself has the logo built in)
- `queries/` - SAP B1 HANA query templates used to generate Excel exports
- `samples/` - example CSV for a local smoke test
- `VERSION.txt` - package/version marker
- `wrangler.toml` - Cloudflare Pages settings (project name, the `REPORT_STORE` KV binding); secrets are not kept in it
- `docs/` - guides: user quick start, this file, the owner checklist, Ask AI, MCP connector, Shipping
- `shared/fedex.mjs` - FedEx tracking code used by `functions/api/shipping.js` and the shipping poller Worker (kept, unused since 2v4)
- `workers/shipping-poller/` - Cloudflare Worker that checked FedEx every 4 hours (its own `wrangler.toml` and README); kept in the repo but **not deployed** since 2v4, see `docs/SHIPPING.md`
- `mcp/spyder-kpi-mcp.mjs` - optional MCP server users run on their own computer (Node.js 20 or newer) to connect Claude or other AI apps; see `docs/MCP.md`
- `web.config` - optional IIS static hosting config

## Hosting

**Cloudflare Pages:** the Pages project `spyder-kpi-dashboard` builds from GitHub `spy-kareena/spyder-kpi-dashboard` (branch `main`, output folder `.`, no build command), or is deployed by hand with `npx wrangler pages deploy . --project-name spyder-kpi-dashboard`. First-time setup: [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md).

**IIS or another static server:** host this project folder as a static site. The default document is `index.html`.

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

The dashboard reads uploaded Excel/CSV files in the browser and keeps the last report's files so it reopens on them; loading a new report replaces them.

- **Cloudflare Pages with shared storage:** a compressed copy of the files (about 1.5 MB for a year of SO/PO lines plus the Clear To Build workbook) is kept in Workers KV, and everyone who signs in opens on it. One upload replaces it for everyone. Setup below.
- **Other hosts, or Cloudflare without the binding:** the files are kept in each browser (IndexedDB, database `spyderKpiReport`). To remove them, clear the site data for the dashboard in the browser settings. On a shared computer, use a separate browser profile per person.

### Shared report storage (Cloudflare Pages)

The binding lives in the repo's `wrangler.toml`, which Cloudflare Pages reads on every deploy; bindings are then no longer edited in the Cloudflare dashboard.

1. Create the namespace once: `npx wrangler kv namespace create spyder-kpi-report` (or Cloudflare dashboard > Storage & Databases > Workers KV > **Create namespace**). If it already exists from an earlier version, keep it: `npx wrangler kv namespace list` shows its id.
2. In `wrangler.toml`, put the id in place of `REPLACE_WITH_REPORT_STORE_NAMESPACE_ID` and remove the `# ` in front of the three lines that start with `[[kv_namespaces]]`. Put the same id in `workers/shipping-poller/wrangler.toml`.
3. Commit and push to `main` (Pages builds from GitHub), or deploy by hand with `npx wrangler pages deploy . --project-name spyder-kpi-dashboard`. The sidebar then says "Saved for everyone who signs in" after an upload.

`/api/report`, `/api/notes`, `/api/people` and `/api/history` sit behind the same sign-in as the page; only a signed-in page on the same site can change what is stored (requests from another site are refused). The same binding turns on shared notes, saved names and the at-risk history; nothing else needs setting up. Shipping statuses set by hand are saved with the notes (key `overrides`), so they need nothing else either.

### Shipping (checked by hand; FedEx API not deployed)

Since 2v4 the **Shipping** page does not call any tracking API. It lists recent SAP deliveries for every carrier with a
**Check** link to AfterShip's public tracking page (`https://www.aftership.com/track/<number>`, opened in a new tab), and
people record the status by hand. Statuses are saved through `/api/notes` in the `overrides` key (map `shipments`, ids
`st:<tracking number>`), so the shared storage above is all it needs; on IIS or another static host they stay in each
browser. Until a real status exists the page shows clearly labelled demo data. Details: [SHIPPING.md](SHIPPING.md).

The earlier FedEx code is kept in the repo but unused: `shared/fedex.mjs`, `functions/api/shipping.js` (deployed with
the other functions, idle because no page calls it) and the scheduled Worker in `workers/shipping-poller`
(`crons = ["0 */4 * * *"]`), which should **not** be deployed. No `FEDEX_*` secrets are needed. If FedEx tracking is ever
turned back on, the Worker needs the `REPORT_STORE` namespace id in its `wrangler.toml`, `npx wrangler secret put
FEDEX_CLIENT_ID` / `FEDEX_CLIENT_SECRET` and `npx wrangler deploy` (plus page code to read `/api/shipping` again); it
would use the KV keys `tracking:wanted`, `tracking:index`, `tracking:token` and `tracking:refresh`.

The SAP KPI query must be re-run once with the updated `queries/sap_b1_hana_kpi_current_dashboard_so_po_with_lagging.sql`
so the export carries `TrackingNumber`, `ShipMethod`, `ShipToCountry` and `ShipDate` on delivery rows.

### Cloudflare settings at a glance

| Setting | Where it is set | Needed? | What it does |
|---|---|---|---|
| `DASHBOARD_PASSWORD` | Pages secret | Required | The shared sign-in password |
| `SESSION_SECRET` | Pages secret | Required | 32+ random characters that sign the session cookie; changing it signs everyone out |
| `ANTHROPIC_API_KEY` | Pages secret | Optional | Ask AI with Claude (paid) |
| `OPENAI_API_KEY` | Pages secret | Optional | Ask AI with ChatGPT (paid) |
| `GROQ_API_KEY` | Pages secret | Optional | Ask AI with Groq (free tier) |
| `OPENROUTER_API_KEY` | Pages secret | Optional | Ask AI with OpenRouter's free models |
| `FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET` | Worker secrets in `workers/shipping-poller` (not deployed) | Not used since 2v4 | FedEx Track API keys for the dormant FedEx module; the Shipping page is checked by hand |
| `FEDEX_API_BASE` | Worker `[vars]` / Pages secret | Not used since 2v4 | `https://apis-sandbox.fedex.com` for FedEx sandbox keys |
| `REPORT_STORE` | KV binding in `wrangler.toml` and `workers/shipping-poller/wrangler.toml` (same namespace, `spyder-kpi-report`) | Recommended | Shared report, notes, Shipping statuses and at-risk history (keys below) |
| Worker cron | `workers/shipping-poller/wrangler.toml`: `crons = ["0 */4 * * *"]` | Not used (Worker not deployed since 2v4) | Would check FedEx every 4 hours (00:00, 04:00, ... 20:00 UTC) |

Pages secrets: `npx wrangler pages secret put <NAME> --project-name spyder-kpi-dashboard` (or Workers & Pages > **spyder-kpi-dashboard** > Settings > Variables and Secrets, type **Secret**), then redeploy. Worker secrets: `npx wrangler secret put <NAME>` in `workers/shipping-poller`. The repo has a `wrangler.toml`, so plain-text variables typed into the Cloudflare dashboard are replaced on each deploy: use the **Secret** type for everything above.

### What is stored in the KV namespace

| Key | What it holds | Written | Size |
|---|---|---|---|
| `report` | Compressed copy of the last loaded export files | Each upload (replaces the last one) | About 1.5 MB |
| `overrides` | Notes, override statuses, Us / Them causes and "deleted" flags on order lines, each with the editor's name and the time of the edit; tracking numbers typed in on the Shipping page and the statuses set there by hand (`shipments`, status ids `st:<number>`) | About 1 second after an edit stops (one write per batch of edits) | Capped at 2 MB |
| `people` | The names people gave in the "Your name" dialog (`{name, firstSeen, lastSeen}`), offered to everyone as one-click choices | When a new name is added, or a name not seen for a day is used again (each browser sends its name at most once a day) | Capped at 300 names (the name seen longest ago gives way); names not seen for 180 days drop off, and the x beside a name in the dialog removes it (DELETE /api/people); a few KB |
| `history` | For each of the last 52 weeks (one entry per week; a second upload in the same week is merged into it): the earliest export date loaded that week and the keys of the lines on the At Risk card in any of that week's uploads (SO number, line, item, warehouse). New uploads are merged into it | Each upload | Capped at 8 MB |
| `history:first` | The same weeks with each line listed only under the first week it was at risk: what the page reads to show how long a line has been at risk ("first flagged"), so a line at risk all year is sent once instead of 52 times. Rebuilt from `history` on each upload | Each upload | Smaller than `history` |
| `tracking:*` | Dormant FedEx module: `tracking:wanted` (tracking numbers the page sends), `tracking:index` (FedEx results), `tracking:token` (FedEx sign-in, expires on its own), `tracking:refresh` (the 10-minute Refresh limit) | Not written since 2v4 (the page no longer calls `/api/shipping`); old keys can be deleted | Small |
| `ai:day:<provider>:<date>` | Ask AI request counts for a paid provider that day (the site's daily cap, `AI_DAILY_REQUESTS`) and per signed-in browser for the current minute (an id derived from the session cookie, not the cookie) | Each Ask AI request to Claude or ChatGPT | A few hundred bytes; expires after 2 days |

A line key looks like `Sales Order|1234|5678|0|SPY-100|Spyder - Lacombe`. Notes are free text typed by users, so treat the namespace like the SAP export itself. The name is what each person picks or types the first time they edit a note (kept in their browser as `spyderKpiEditorName`, and in the `people` list for everyone): 1 to 40 letters (any language), spaces and . ' - only. Names are not checked against accounts, since the site has one shared password. Initials saved before 2v2 (`spyderKpiEditor`) are still shown on older edits; each browser asks for the name once.

How shared notes merge:

- Every browser keeps its own copy (localStorage). When the page opens (and when it comes back into view, at most once a minute) it reads the server copy and merges line by line. The newer edit wins, so if two people change the same line the later change stays (with exactly the same time, the server keeps the one it stored first and every browser takes it).
- Times come from each computer's clock, corrected to the server's time (its Date header) when the clock is more than two minutes off. A time ahead of the server's is saved as the server's time and the page keeps that, so a computer with a fast clock does not keep overwriting newer edits.
- Workers KV has no locking and takes one write per second to the same key: the page waits at least 1.1 seconds between saves (edits made meanwhile go out together), the server retries a busy write once after a second, and the page sends a batch again (after 2, 4, 8 ... seconds) when the server is busy or fails. Other Cloudflare locations can see an older copy for up to about a minute, so two saves from different locations within about a minute (or at the same moment) can overwrite each other; the browser whose edit was dropped reads the notes again about a minute after its save and sends it again (or the next time it opens, if the page was closed).
- If the stored notes cannot be read, a save is refused (nothing is overwritten) and the page tries again.
- A line whose note was cleared is kept as a small marker (name and time only) so other browsers drop their copy; markers older than 180 days are dropped on every save.
- At the 2 MB cap (each save reads and rewrites the whole value, kept small for the Workers Free plan's 10 ms of CPU per request) the entries edited longest ago go, so new edits always save; a browser that still has a dropped note sends it back the next time it opens.
- At most 500 lines new to the server are taken per save. A save sent while the page is being hidden or closed is kept under 60 KB (browsers refuse larger keep-alive requests); the rest goes after, or the next time the page opens.
- If the server cannot be reached or answers with an error page, edits stay in that browser and are sent again shortly, when the page comes back into view, or the next time it opens. A save the server refuses (an expired sign-in, full storage) is not resent by itself: the sidebar says how many changes are not saved until they go out (the next read of the notes sends them).
- Only an answer that clearly says the site has no notes API (the function's own "not set up" reply, or a 404 / 405 page that is not JSON) makes the page keep notes in the browser for that visit. Hosts without these functions (IIS, a file share) keep notes in each browser, as before.

Free tier: 1,000 writes and 100,000 reads a day. One upload is three writes (report, history and history:first), each batch of note edits is one write (and one read about a minute later by the browser that saved), and each page open is three reads. Names add at most one read and one write a day per browser (plus a read when the "Your name" dialog opens, and on each page open before a name is given). A team of a few people stays well inside the limit.

To look at or clear what is stored (with the namespace id from the Cloudflare dashboard):

```
npx wrangler kv key get overrides --namespace-id <id> --remote
npx wrangler kv key delete report --namespace-id <id> --remote     # the shared report
npx wrangler kv key delete overrides --namespace-id <id> --remote  # every shared note, override and cause
npx wrangler kv key delete people --namespace-id <id> --remote     # the list of names (each browser keeps its own)
npx wrangler kv key delete history --namespace-id <id> --remote        # the at-risk history ("first flagged" starts
npx wrangler kv key delete history:first --namespace-id <id> --remote  # again): delete both keys
```

Deleting `overrides` does not remove the notes kept in each person's browser: the next time they open the dashboard their copy is shared again. To start notes over, also clear the site data in each browser.

A **Share snapshot** file carries the loaded rows and the notes on those rows, so treat snapshot files like the SAP export itself.

## Security notes

- No external data upload is required. The optional **Ask AI** panel sends questions and the data needed to answer them to the AI provider the user picks, only after the user ticks that provider's consent box. Paid providers (Claude, ChatGPT) do not train on API data; the free ones (Groq, OpenRouter free models) have weaker terms, and OpenRouter's free hosts may keep or publish prompts. See `docs/AI_ASSISTANT.md`.
- Ask AI keys (Cloudflare Pages secrets, each optional; set at least one to turn Ask AI on, for Production and Preview as needed, then redeploy):
  - `ANTHROPIC_API_KEY` - Claude (paid, billed to the Anthropic account)
  - `OPENAI_API_KEY` - ChatGPT (paid, billed to the OpenAI account)
  - `GROQ_API_KEY` - Groq (free tier)
  - `OPENROUTER_API_KEY` - OpenRouter (free models only)

  Set each with `npx wrangler pages secret put <NAME> --project-name spyder-kpi-dashboard`. The keys never reach the browser: the page calls `/api/ai/status` and `/api/ai/chat`, which sit behind the same sign-in gate, accept chat requests only from the dashboard page itself, cap each request at 1 MB and allow only listed models. Set a monthly spend limit on the paid accounts. IIS and other static hosts have no proxy, so Ask AI is not available there (users can connect Claude Desktop instead, see `docs/MCP.md`).
- No SAP credentials are stored in the dashboard.
- SAP exports are loaded by the user from their local machine.
- Restrict access to internal users only. On Cloudflare Pages with `REPORT_STORE` bound, the last uploaded export, the shared notes, the at-risk history and the Shipping statuses are stored in Workers KV and readable by anyone with the dashboard password; otherwise uploaded KPI data and notes never reach the server. The page itself lists customer codes (for segment grouping) and `queries/` shows SAP table/UDF names.
- Cloudflare Pages: only the sign-in page logo, `/assets/spyder-logo.jpg`, is served without signing in (an exact path in `functions/_middleware.js`). Every other path, including any other name under `/assets/`, needs a session; this matters because Cloudflare Pages answers a missing file with `index.html`. To make another file public, add its exact path to `PUBLIC_PATHS` there, and never put anything private in it.
- The page loads the Inter font from Google Fonts (fonts.googleapis.com, fonts.gstatic.com), as the sign-in page does. Without internet access both fall back to the system font; nothing else is loaded from outside.
- The Shipping page sends nothing to any carrier or tracking service; its **Check** links only open AfterShip's public page in the viewer's own browser tab. The dormant FedEx module's keys (`FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET`), if ever set, live only as Worker / Pages secrets; they and the FedEx sign-in token are never sent to the browser. `/api/shipping` is behind the sign-in; changing the tracking list or asking FedEx now is accepted only from the dashboard page itself (same origin), and Refresh now is limited to once per 10 minutes for the whole site.
- Cloudflare Pages: set `DASHBOARD_PASSWORD` and `SESSION_SECRET` (32+ random characters) as Pages secrets for Production and Preview. Both are required; the site returns a "not configured" error until both are set. Changing either signs everyone out. Failed sign-ins are delayed by one second; for stronger protection put the project behind Cloudflare Access, or add a rate-limiting rule matching the path `/login` with method POST (and redirect `<project>.pages.dev` to the custom domain so the rule cannot be bypassed).
- IIS: this package does not configure authentication, because the IIS authentication sections are locked by default and a web.config that sets them would fail on a default install. To require Windows sign-in, install the Windows Authentication role service, then in IIS Manager for this site disable Anonymous Authentication, enable Windows Authentication, and add an Authorization rule for the allowed AD group. The included web.config hides the `functions`, `shared`, `workers` and `tests` folders (server code that IIS does not run).

## Tests

With Node.js 20 or newer (no install needed): `node tests/run-all.js`.

## Updating later

To update the dashboard, replace `index.html` with a newer version and update `VERSION.txt`.
