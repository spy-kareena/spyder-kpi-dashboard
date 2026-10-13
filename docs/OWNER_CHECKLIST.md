# Owner checklist: put version 2v1 live

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

3. **Turn on shared storage (one KV namespace, bound as `REPORT_STORE`).** It holds the shared report, notes, at-risk history and FedEx results.

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

   - Set a monthly spend limit on the paid accounts (Claude Console > Limits, OpenAI > Limits). The site also caps each paid provider at 300 requests a day (`AI_DAILY_REQUESTS` changes it; see AI_ASSISTANT.md).
   - OpenRouter: decide on Settings > Privacy. Free models only work if the account allows providers that may train on or publish prompts; otherwise OpenRouter models say they "could not be used with this account's privacy settings". Treat anything sent to OpenRouter as public.
   - Redeploy (push, or Deployments > latest > Retry deployment) so new secrets take effect. Details: [AI_ASSISTANT.md](AI_ASSISTANT.md).

5. **Set up live FedEx tracking.**
   - At developer.fedex.com, sign in with Spyder Controls' fedex.com user, create an API project with the **Track API** and ask for **production** keys (FedEx asks for the account number). The API key is `FEDEX_CLIENT_ID`, the Secret key is `FEDEX_CLIENT_SECRET`.
   - In the `workers/shipping-poller` folder (after step 3):

     ```
     npx wrangler secret put FEDEX_CLIENT_ID
     npx wrangler secret put FEDEX_CLIENT_SECRET
     npx wrangler deploy
     ```

     Workers & Pages > **spyder-shipping-poller** > Settings > Trigger events should show `0 */4 * * *` (every 4 hours).
   - Optional, for the **Refresh now** button: put the same two keys on the Pages project (`npx wrangler pages secret put FEDEX_CLIENT_ID --project-name spyder-kpi-dashboard`, the same for `FEDEX_CLIENT_SECRET`) and redeploy. Details: [SHIPPING.md](SHIPPING.md).

6. **Re-run the updated SQL in SAP.** Replace the saved KPI query with `queries/sap_b1_hana_kpi_current_dashboard_so_po_with_lagging.sql` (it adds `TrackingNumber`, `ShipMethod`, `ShipToCountry` and `ShipDate` to delivery rows), run it and Export to Excel. The supply / demand query is unchanged. Ask the shipping team to fill **Tracking No.** on deliveries.

7. **Check the numbers on your PC with the real export** (counts only; nothing leaves the PC). Open the dashboard and load the files:
   - With the same export as last time, the Order Health **At risk** card still shows **62 orders / 124 lines / $836,876**.
   - With the new export: on the **Leading** tab the open order states (On track, Due this week, Rescheduled, Past due, No commit) add up to **All open**.
   - **Big picture** on Order Health: each column (including the middle status column) adds up to **All open**, the at-risk status boxes add up to the **At risk** card, and the at-risk chart totals the At risk value. On Build Risk the three middle boxes (Clear to build, At risk, Late) match the cards above.
   - The **Shipping** page lists the tracking numbers from the new export (live status comes after deploy).
   - The MCP connector still reads it: `node mcp/spyder-kpi-mcp.mjs --check "C:\path\to\kpi_export.xls"` prints the overview with the same at-risk numbers.

8. **After deploy, on https://spyder-kpi-dashboard.pages.dev:**
   - Sign in (the sign-in page shows the logo). Upload the export and the Clear To Build workbook; the sidebar says "Saved for everyone who signs in".
   - Add a note on a line (pick or type your name when asked); the sidebar says "Notes shared · last edit ...". In the second browser below, your name is listed in the "Your name" dialog.
   - Open the site in a second browser (or a private window) and sign in: the same report opens without uploading, with your note on the line.
   - Ask AI: for each provider with a key, tick its box in Settings and ask one question, such as "What is at risk right now?". The answer should match the At risk card. Providers without a key show "(not set up)".
   - Shipping: click **Refresh now** (if the Pages project has the FedEx keys) or wait for the next 4-hour check; the header then says "Updated ... ago" and rows show FedEx statuses. The Worker's Logs show "checked N tracking numbers".

If something does not work, the troubleshooting tables in [SHIPPING.md](SHIPPING.md), [AI_ASSISTANT.md](AI_ASSISTANT.md) and [IT_HOSTING_README.md](IT_HOSTING_README.md) list messages and fixes.
