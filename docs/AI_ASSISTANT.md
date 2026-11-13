# Ask AI

**Ask AI** opens a chat panel on the right of the dashboard. Ask a question in plain English, such as "What is at risk right now?". The AI looks up the numbers it needs in the loaded export (the same numbers the pages show, as of the export date) and lists what it looked up under each answer.

| Provider | Tier | Billed to | Models | What happens to the data | Server secret |
|---|---|---|---|---|---|
| **Anthropic** | Paid | Spyder Controls' Anthropic account | Opus 5.5 (default, most capable), Sonnet 5.5, Haiku 5.5 | Not used to train models. Kept for a limited time for safety checks. | `ANTHROPIC_API_KEY` |
| **ChatGPT** (OpenAI) | Paid | Spyder Controls' OpenAI account | GPT-5, GPT-5 mini, GPT-5 nano, GPT-4.1 (newer models in these families appear on their own) | Not used to train models by default. Kept up to 30 days for abuse checks. | `OPENAI_API_KEY` |
| **Groq** | Free | Nobody (free tier) | Open models such as gpt-oss-120b and Llama 3.3 70B | Groq says it does not train on API data, but free-tier terms can change. Tight limits per minute and per day. | `GROQ_API_KEY` |
| **OpenRouter** | Free | Nobody (free models only) | Free models on OpenRouter that can use tools | Passed to outside providers that host the models. Many keep prompts and may train on or publish them. Treat it as public. | `OPENROUTER_API_KEY` |

Any AI can be wrong. Check a number against the page before you act on it.

## Privacy

- Your question and the data needed to answer it (order and PO lines, customer and vendor names, warehouses, values, saved notes) go from the site to the provider you picked.
- **Paid** providers are covered by Spyder Controls' agreement with them and do not train on what you send. **Free** providers have weaker terms; use them only for data Spyder Controls may share.
- Nothing is sent until you tick the provider's consent box in **Settings**. The tick is saved in your browser for each provider (allowing Anthropic does not allow Groq); untick it to stop.
- The AI keys stay on the server. They never reach the browser or a **Share snapshot** file. The chat is not saved anywhere.
- With live SAP, what an SAP lookup returns (order, PO, stock, item or customer rows) goes to the same provider. Settings says so under the consent box.

## Board first, then SAP (2v6.9)

Ask AI answers from the board (the data loaded in the dashboard). When the board does not hold the answer (an order,
PO, item or customer not on the board, stock on hand, deliveries, invoices, prices, lead times, production orders, older
history) and the site has live SAP ([LIVE_SAP.md](LIVE_SAP.md)), it looks it up in SAP through the bridge. While it does,
the chat shows **Asking SAP: order 45126…**. Each answer ends with its source: **From the board**, **From SAP · live at
2:14 PM**, or **From SAP · last good read at …** when SAP could not be read and the bridge sent its last good result.
At most 50 rows of one lookup go to the AI; it says when a list is cut.

The SAP lookups are the bridge's named queries: `so_detail`, `po_detail`, `item_stock`, `customer_orders`,
`order_deliveries`, `item_info`, `production_orders`, `open_sales_orders`, `sales_by_month`, `stock_by_warehouse`,
`open_purchase_orders`. Ask AI offers one only when the bridge lists it. The AI app connection (MCP) has the board tools only.

## Using it

1. Load an export and click **Ask AI** at the top of any page.
2. The first time, the panel opens on **Settings**: pick a provider and model, read the notice and tick the box.
3. Click **Back to chat** and ask. Enter sends; Shift+Enter adds a line. **Stop** cancels a slow question; **Clear chat** starts again.
4. Follow-up questions remember the chat. A new provider, model or export starts a new chat.

Providers without a key show as "(not set up)". If none has a key, the panel says so and links to this guide.

Ask AI needs the hosted dashboard: a copy opened as a file, a **Share snapshot** or a copy on IIS has no server for the keys. To ask about exports on your own computer, connect your own AI app instead ([MCP.md](MCP.md)).

## Setup (site admin)

The keys are Cloudflare Pages secrets. Set one or more from the project folder (each asks for the key), then redeploy:

```
npx wrangler pages secret put ANTHROPIC_API_KEY  --project-name spyder-kpi-dashboard
npx wrangler pages secret put OPENAI_API_KEY     --project-name spyder-kpi-dashboard
npx wrangler pages secret put GROQ_API_KEY       --project-name spyder-kpi-dashboard
npx wrangler pages secret put OPENROUTER_API_KEY --project-name spyder-kpi-dashboard
```

Or in the Cloudflare dashboard: Workers & Pages > **spyder-kpi-dashboard** > Settings > Variables and Secrets > **Add** > type **Secret**, then Deployments > latest > **Retry deployment**. To turn a provider off, delete its secret and redeploy.

Where to get each key (use a key made only for this dashboard, so it can be limited or replaced on its own):

- **Anthropic:** [console.anthropic.com](https://console.anthropic.com) (the Anthropic console) > API keys. Add a payment method and set a monthly spend limit under Limits.
- **ChatGPT:** [platform.openai.com/api-keys](https://platform.openai.com/api-keys). Add a payment method and set a monthly budget under Limits. (ChatGPT Plus or Team does not include API use.)
- **Groq:** [console.groq.com/keys](https://console.groq.com/keys). Free; no card needed.
- **OpenRouter:** [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). Free models need no credit. They only work if [Settings > Privacy](https://openrouter.ai/settings/privacy) allows providers that may train on or publish prompts; otherwise the panel says the model "could not be used with this account's privacy settings".

## What it costs

- **Anthropic** is billed per token (about 4 characters). Per million tokens, input / output: Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50. A typical question reads 20,000 to 40,000 tokens and writes 2,000 to 4,000 (hidden reasoning counts as written): roughly **10 to 20 cents with Opus, 5 to 10 cents with Sonnet, under 1 cent with Haiku**. Repeated parts of a chat are cached, which lowers follow-ups. Opus is the default because it answers best; pick Sonnet or Haiku in Settings to spend less. [Anthropic API pricing](https://www.anthropic.com/pricing#api).
- **ChatGPT** is billed per token; GPT-5 mini and nano cost a few cents or less per question. [openai.com/api/pricing](https://openai.com/api/pricing/).
- **Groq** and **OpenRouter free models** cost nothing but limit use per minute and per day (shared by everyone who signs in); the panel says when a limit is reached.
- **Cap on the paid providers:** at most **300 requests a day** per paid provider for the whole site, and 15 a minute per signed-in browser. A question is one request per model turn, usually 2 to 4 (at most 8). To change the daily number, set `AI_DAILY_REQUESTS` (`npx wrangler pages secret put AI_DAILY_REQUESTS --project-name spyder-kpi-dashboard`, then redeploy); `0` turns the paid providers off. The cap is counted in the `REPORT_STORE` KV namespace (key `ai:day:<provider>:<date>`, gone after two days), so it needs that binding. It is a soft cap: the monthly spend limit in each provider's console is the real backstop.

## How it works (site admin)

- Two routes, behind the same sign-in as the rest of the site (`functions/_middleware.js`), in `functions/api/ai/[[path]].js`:
  - `GET /api/ai/status`: the four providers, which have a key, their models and the data notice shown in the panel.
  - `POST /api/ai/chat`: one step of a conversation to the chosen provider. The key is added on the server; the browser never sees it.
- The AI cannot read the export itself. It calls six read-only tools (overview tiles, line search, group totals, monthly summary, build risk, supply / demand), which the page runs in the browser on the loaded data; only the results are sent. They are the same tools the MCP connector offers (`KPI_TOOLS` in `index.html`). A question may take up to 8 steps.
- The Anthropic provider uses the Messages API (`anthropic-version: 2023-06-01`) with adaptive thinking at medium effort and prompt caching, plus two options:
  - **Fallback** (Opus and Sonnet, `server-side-fallback-2026-07-01`): if a safety check declines a question, Anthropic re-runs it on its recommended fallback model in the same call; the answer says which model replied.
  - **Thinking kept with its chat** (`thinking-binding-controls-2026-08-01`): earlier reasoning is sent back with the chat. The page only ever adds to a chat (fixed instructions and tools per chat); if something earlier differs, the model drops the old reasoning instead of refusing.

  If the account rejects either option, the request is sent once more without them. ChatGPT, Groq and OpenRouter use the OpenAI Chat Completions format.
- Answers can be up to 16,000 tokens on the paid providers (reasoning included), 2,048 on Groq and 4,096 on OpenRouter (Groq counts this against its per-minute limit).

Safeguards in the proxy:

- Only the dashboard page may call `/api/ai/chat` (same-origin check), and only when signed in.
- Paid providers are capped per site per day and per browser per minute (see **What it costs**). Anyone with the shared password can sign in for 14 days; to shut everyone out (for example after a leak), change `DASHBOARD_PASSWORD` or `SESSION_SECRET`.
- Each request is limited to 1 MB. Every model turn resends the whole chat, so the page keeps requests under about 800 KB (counted in bytes as sent): when lookups would pass that, their results are cut down and the model answers with what it has. Free providers get smaller tool results and a shorter history.
- Questions and tool results must be plain text: no images, files or links, so nobody can make a provider fetch something on Spyder Controls' account.
- Each provider has a model allowlist. Anthropic: the three models above. ChatGPT and Groq: the listed models plus newer ones in the same families, read from the provider's model list hourly (no "pro" or dated models). OpenRouter: free (`:free`, price 0) models with tool support only.
- Replies are never cached. Provider calls time out after 95 seconds.
- Errors are plain English. A rejected key only names the secret to check; the provider's message (which can contain part of the key) is never passed on, and anything that looks like a key is removed from other messages.

## Questions that work well

- "What is at risk right now, and which customers have the most value at risk?"
- "Which warehouses have the most past-due open value?"
- "Show the 10 most overdue lines for Aqua Hot."
- "Which vendors have the most late PO lines?"
- "What is due next week at CM - Alta?"
- "How are OTD, fill rate and reschedule hit rate doing?"
- "Find SO 12345" or "Which lines have a note mentioning 'board'?"

The tools cover the overview tiles (with the Leading / Lagging numbers and the Us / Them cause split), line search (each at-risk line's cause and reasons), group totals, the monthly summary, build risk and supply / demand. Ask AI does not see charts and cannot change notes, filters or data. Questions about history the export does not hold, or stock on hand, get "the data isn't loaded" rather than a guess.

## When something goes wrong

| Message | What to do |
|---|---|
| Ask AI is not set up | No provider has a key, or this copy has no server. The site admin adds a key (see Setup). |
| Tick the box above to allow … first | Read the notice in Settings and tick the box for that provider. |
| The site's … key was rejected | The site admin checks the secret named in the message (wrong, revoked or out of credit). |
| … is out of credit or has a billing problem | The site admin adds credit or raises the limit in the provider's console. |
| …'s free limit was reached | Wait a minute (or until tomorrow for the daily limit), ask a narrower question, or pick a paid provider. |
| Daily Ask AI limit reached for this site | The site's daily cap on a paid provider is used up. Try tomorrow, pick a free provider, or the site admin raises `AI_DAILY_REQUESTS`. |
| Too many Ask AI requests from this browser in the last minute | Wait a minute. |
| The question and its data were too large / This question and the chat before it are too large to send | Click **Clear chat** and ask a narrower question. |
| … could not use that model | Pick another model. "No tool support": it cannot look up data; "privacy settings": see the OpenRouter note under Setup. |
| … declined to answer this one | Rephrase, or pick another model. |
| …'s answer was cut off | Ask a narrower question; a paid provider allows longer answers. |
| This question needed too many lookups | Ask about one thing at a time (one customer, warehouse or week). |
| Your sign-in to this site has expired | Reload the page and sign in again. |
| Load a KPI export first | Ask AI only answers from loaded data. |
