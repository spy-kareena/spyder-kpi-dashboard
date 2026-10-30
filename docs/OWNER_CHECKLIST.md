# Owner checklist: put version 2v2 live

For the owner, deploying from Kareena's Cloudflare account. Run the commands in a terminal in the dashboard folder (GitHub repo `spy-kareena/spyder-kpi-dashboard`) on a computer with Node.js 20 or newer. Sign in to Cloudflare once with `npx wrangler login` (as Kareena's account; `npx wrangler whoami` shows which account is signed in).

Never commit the SAP export, the Clear To Build workbook or any key.

1. **Check how the site deploys.** Cloudflare > Workers & Pages > **spyder-kpi-dashboard** > Settings > Build (Builds & deployments) should be connected to GitHub `spy-kareena/spyder-kpi-dashboard`, production branch `main`, so every push to `main` deploys. If not, deploy by hand after each change:

   ```
   npx wrangler pages deploy . --project-name spyder-kpi-dashboard
   ```

2. **Make the sign-in settings secrets.** Same project > Settings > Variables and Secrets: `DASHBOARD_PASSWORD` and `SESSION_SECRET` must be type **Secret** (value hidden), not **Plain text**, for Production (and Preview if you use previews). The repo's `wrangler.toml` replaces plain-text variables on the next deploy, so a plain one would disappear and the site would say "not configured". To make one a secret, delete the plain-text entry, then:

   ```
   npx wrangler pages secret put DASHBOARD_PASSWORD --project-name spyder-kpi-dashboard
   npx wrangler pages secret put SESSION_SECRET --project-name spyder-kpi-dashboard
   ```

   `SESSION_SECRET` is 32 or more random characters (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` makes one). Changing it signs everyone out.

3. **Turn on shared storage (one KV namespace, bound as `REPORT_STORE`).** It holds the shared report, notes (including Shipping statuses) and at-risk history.

   ```
   npx wrangler kv namespace create spyder-kpi-report
   ```

   It prints an `id`. (If it says the namespace already exists, `npx wrangler kv namespace list` shows its id; keep using it.) Then:
   - In `wrangler.toml`, replace `REPLACE_WITH_REPORT_STORE_NAMESPACE_ID` with the id and remove the `# ` in front of the three lines `[[kv_namespaces]]`, `binding = ...` and `id = ...`.
   - In `workers/shipping-poller/wrangler.toml`, replace the same placeholder with the same id.
   - Run `node tests/run-all.js` (it checks both files carry the same id), commit, and push to `main` (or deploy by hand as in step 1).

4. **Add the Ask AI keys (any of the four; one is enough).**

   ```
   npx wrangler pages secret put ANTHROPIC_API_KEY  --project-name spyder-kpi-dashboard
   npx wrangler pages secret put OPENAI_API_KEY     --project-name spyder-kpi-dashboard
   npx wrangler pages secret put GROQ_API_KEY       --project-name spyder-kpi-dashboard
   npx wrangler pages secret put OPENROUTER_API_KEY --project-name spyder-kpi-dashboard
   ```

   - Set a monthly spend limit on the paid accounts (Anthropic console > Limits, OpenAI > Limits). The site also caps each paid provider at 300 requests a day (`AI_DAILY_REQUESTS` changes it; see AI_ASSISTANT.md).
   - OpenRouter: decide on Settings > Privacy. Free models only work if the account allows providers that may train on or publish prompts; otherwise OpenRouter models say they "could not be used with this account's privacy settings". Treat anything sent to OpenRouter as public.
   - Redeploy (push, or Deployments > latest > Retry deployment) so new secrets take effect. Details: [AI_ASSISTANT.md](AI_ASSISTANT.md).

5. **Shipping needs no setup (FedEx tracking is off since 2v4).** The Shipping page is checked by hand: a **Check** link per shipment opens AfterShip, and statuses are saved with the shared notes (step 3). Do **not** deploy `workers/shipping-poller`, and skip the `FEDEX_CLIENT_ID` / `FEDEX_CLIENT_SECRET` secrets; that code stays in the repo unused. Details: [SHIPPING.md](SHIPPING.md).

6. **Re-run the updated SQL in SAP.** Replace the saved KPI query with `queries/sap_b1_hana_kpi_current_dashboard_so_po_with_lagging.sql` (it adds `TrackingNumber`, `ShipMethod`, `ShipToCountry` and `ShipDate` to delivery rows), run it and Export to Excel. The supply / demand query is unchanged. Ask the shipping team to fill **Tracking No.** on deliveries.

7. **Check the numbers on your PC with the real export** (counts only; nothing leaves the PC). Open the dashboard and load the files:
   - With the same export as last time, the Order Health **At risk** card still shows **62 orders / 124 lines / $836,876**.
   - With the new export: on the **Leading** tab the open order states (On track, Due this week, Rescheduled, Past due, No commit) add up to **All open**.
   - **Big picture** on Order Health: each column (including the middle status column) adds up to **All open**, the at-risk status boxes add up to the **At risk** card, and the at-risk chart totals the At risk value. On Build Risk the three middle boxes (Clear to build, At risk, Late) match the cards above.
   - The **Shipping** page shows **Demo data**; **Show real shipments** lists the tracking numbers from the new export, each with a **Check** link.
   - The MCP connector still reads it: `node mcp/spyder-kpi-mcp.mjs --check "C:\path\to\kpi_export.xls"` prints the overview with the same at-risk numbers.

8. **After deploy, on https://spyder-kpi-dashboard.pages.dev:**
   - Sign in (the sign-in page shows the logo). Upload the export and the Clear To Build workbook; the sidebar says "Saved for everyone who signs in".
   - Add a note on a line (pick or type your name when asked); the sidebar says "Notes shared · last edit ...". In the second browser below, your name is listed in the "Your name" dialog.
   - Open the site in a second browser (or a private window) and sign in: the same report opens without uploading, with your note on the line.
   - Ask AI: for each provider with a key, tick its box in Settings and ask one question, such as "What is at risk right now?". The answer should match the At risk card. Providers without a key show "(not set up)".
   - Shipping: click **Show real shipments**, open a row, set **In transit** and **Save**; the toast says "saved for everyone", and the second browser shows the same status (with demo data off).

If something does not work, the troubleshooting tables in [SHIPPING.md](SHIPPING.md), [AI_ASSISTANT.md](AI_ASSISTANT.md) and [IT_HOSTING_README.md](IT_HOSTING_README.md) list messages and fixes.
