# Ask AI

**Ask AI** opens a chat panel on the right of the dashboard. You type a question in plain English, such as "What is at risk right now?". The AI looks up the numbers it needs from the loaded export and answers. It uses the same numbers the pages show, as of the export date, and lists what it looked up under each answer.

You can pick one of four AI providers. Two are paid, two are free:

| Provider | Tier | Who pays | Models offered | What happens to the data | Server secret |
|---|---|---|---|---|---|
| **Claude** (Anthropic) | Paid | The company's Anthropic account | Claude Opus 5.5 (default, most capable), Claude Sonnet 5.5, Claude Haiku 5.5 | Not used to train models. Kept for a limited time for safety checks. | `ANTHROPIC_API_KEY` |
| **ChatGPT** (OpenAI) | Paid | The company's OpenAI account | GPT-5, GPT-5 mini, GPT-5 nano, GPT-4.1 (newer GPT models in these families appear on their own) | Not used to train models by default. Kept up to 30 days for abuse checks. | `OPENAI_API_KEY` |
| **Groq** | Free | Nobody (free tier) | Open models such as gpt-oss-120b and Llama 3.3 70B | Groq says it does not train on API data, but free-tier terms can change. Tight limits per minute and per day. | `GROQ_API_KEY` |
| **OpenRouter** | Free | Nobody (free models only) | Whatever free models OpenRouter lists that can use tools | Passed to outside companies that host the models. Many free hosts keep prompts and may train on them or publish them. Treat it as public. | `OPENROUTER_API_KEY` |

Any AI can be wrong. Check any number you are going to act on against the page.

## Privacy: read this first

- Your question, and the dashboard data needed to answer it, go from the site to the provider you picked. That data can include order and PO lines, customer and vendor names, warehouses, values and saved notes.
- **Paid** providers (Claude, ChatGPT) are covered by the company's agreement with them and do not train on what you send.
- **Free** providers (Groq, OpenRouter) cost nothing, but the free terms are weaker. OpenRouter's free models in particular may keep or publish what you send. Use free providers only for data your company is happy to share.
- Nothing is sent to a provider until you tick its consent box in **Settings**. The tick is saved in your browser, separately for each provider: allowing Claude does not allow Groq. Untick it to stop.
- The AI keys stay on the server. They never reach your browser, a log on the page, or a **Share snapshot** file. The chat is not saved anywhere and never goes into a snapshot.

## Using it

1. Load an export, then click **Ask AI** at the top of any page.
2. The first time, the panel opens on **Settings**. Pick a provider (grouped **Paid** and **Free**) and a model, read what gets sent, and tick the box.
3. Click **Back to chat**, then ask. Press Enter to send, Shift+Enter for a new line. **Stop** cancels a question that is taking too long; **Clear chat** starts again.
4. Follow-up questions remember the earlier ones in the same chat. Picking another provider or model, or loading a new export, starts a new chat.

Providers that are not set up on the site show as "(not set up)" and cannot be picked. If none is set up, the panel says so and lists the keys IT needs to add.

Ask AI needs the hosted dashboard. A copy opened as a file, a **Share snapshot**, or a copy on an IIS server has no server to hold the keys, so the panel explains that instead. To ask questions about exports on your own computer, use Claude Desktop or Claude Code: see [MCP.md](MCP.md).

## Setup (for IT)

The keys are Cloudflare Pages secrets. Set one or more, then redeploy. Run these from the project folder (each asks you to paste the key):

```
npx wrangler pages secret put ANTHROPIC_API_KEY  --project-name spyder-kpi-dashboard
npx wrangler pages secret put OPENAI_API_KEY     --project-name spyder-kpi-dashboard
npx wrangler pages secret put GROQ_API_KEY       --project-name spyder-kpi-dashboard
npx wrangler pages secret put OPENROUTER_API_KEY --project-name spyder-kpi-dashboard
```

Or in the Cloudflare dashboard: Workers & Pages > **spyder-kpi-dashboard** > Settings > Variables and Secrets > **Add** > type **Secret**. Then Deployments > latest > **Retry deployment** so the new secret takes effect. To turn a provider off, delete its secret and redeploy.

Where to get each key:

- **Claude:** [platform.claude.com](https://platform.claude.com) (the Claude Console) > API keys. Add a payment method, and set a monthly spend limit under Limits.
- **ChatGPT:** [platform.openai.com/api-keys](https://platform.openai.com/api-keys). Add a payment method and set a monthly budget under Limits. (A ChatGPT Plus or Team subscription does not include API use.)
- **Groq:** [console.groq.com/keys](https://console.groq.com/keys). Free; no card needed.
- **OpenRouter:** [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). Free models need no credit. In [Settings > Privacy](https://openrouter.ai/settings/privacy), free models only work if the account allows providers that may train on or publish prompts; if it does not, the panel says the model "could not be used with this account's privacy settings".

Use a key made only for this dashboard, so it can be limited or replaced without affecting anything else.

## What it costs

- **Claude** is billed per token (about 4 characters each). Current prices per million tokens, input / output: Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50. A typical question reads 20,000 to 40,000 tokens (the question, the tool results and the earlier chat) and writes 2,000 to 4,000 (Claude's hidden reasoning counts as written tokens). That is roughly **10 to 20 cents with Opus, 5 to 10 cents with Sonnet, and under 1 cent with Haiku**. Repeated parts of a chat are cached (re-read at a small fraction of the input price), which lowers follow-ups. Opus 5.5 is the default because it answers best; pick Sonnet or Haiku in Settings to spend less. Prices: [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing).
- **ChatGPT** is billed per token too; the GPT-5 mini and nano models cost a few cents or less per question. Prices: [openai.com/api/pricing](https://openai.com/api/pricing/).
- **Groq** and **OpenRouter free models** cost nothing. Both limit how much you can ask per minute and per day; the panel says when a limit is reached. One key is shared by everyone who signs in, so the limits are shared too.
- **Cap on the paid providers:** the site itself allows at most **300 requests a day** per paid provider (Claude, ChatGPT) for everyone together, and 15 a minute from one signed-in browser. A question is one request per model turn, usually 2 to 4 (at most 8). To change the daily number, add `AI_DAILY_REQUESTS` to the Pages project (`npx wrangler pages secret put AI_DAILY_REQUESTS --project-name spyder-kpi-dashboard`, then redeploy); `0` turns the paid providers off. The cap is counted in the `REPORT_STORE` KV namespace (one write per request, key `ai:day:<provider>:<date>`, gone after two days), so it needs that binding; it is a soft cap, and the monthly spend limit in each provider's console stays the real backstop.

## How it works (for IT)

- The page calls two routes on the site, behind the same sign-in as everything else (`functions/_middleware.js`):
  - `GET /api/ai/status` lists the four providers, which ones have a key, their models, and the data notice shown in the panel.
  - `POST /api/ai/chat` sends one step of a conversation to the chosen provider and returns its reply.
- The code is `functions/api/ai/[[path]].js`. It adds the key on the server, so the browser never sees it.
- The AI cannot read the export by itself. It asks for numbers through six read-only tools (overview tiles, line search, group totals, monthly summary, build risk, supply / demand). The page runs those tools in the browser, on the loaded data, and sends back only the results. These are the same tools the MCP connector offers (`KPI_TOOLS` in `index.html`). Each question may take up to 8 steps.
- Claude uses Anthropic's Messages API (`anthropic-version: 2023-06-01`) with adaptive thinking at medium effort and prompt caching. Two Anthropic options are switched on:
  - **Fallback** (Opus and Sonnet, `server-side-fallback-2026-07-01`): if a safety check declines a question, Anthropic re-runs it on its recommended fallback model in the same call. The answer then says which model replied.
  - **Thinking kept with its chat** (`thinking-binding-controls-2026-08-01`): Claude's hidden reasoning from earlier steps is sent back with the chat, and Claude checks that the chat before it has not changed. The page only ever adds to a chat (it keeps one fixed set of instructions and tools per chat), and if something earlier ever differs, Claude drops that old reasoning instead of refusing the question.

  If the Anthropic account does not accept either option, the request is sent again once without them. ChatGPT, Groq and OpenRouter use the OpenAI Chat Completions format.
- Answers can be up to 16,000 tokens long on the paid providers (reasoning included), 2,048 on Groq and 4,096 on OpenRouter. Groq counts this allowance against its per-minute limit, so a smaller one lets more questions through; a short data answer fits easily.

Safeguards in the proxy:

- Only the dashboard page itself may call `/api/ai/chat` (same-origin check), and only when signed in.
- Paid providers are capped per site per day and per browser per minute (see **What it costs**). Everyone who knows the shared password can sign in, and a sign-in lasts 14 days; to shut out a browser (for example a leaked password), change `DASHBOARD_PASSWORD` or `SESSION_SECRET`, which signs everyone out.
- Each request is limited to 1 MB. Free providers get smaller tool results and a shorter chat history, to stay inside their limits.
- Questions and tool results must be plain text: the proxy refuses images, files or links, so nobody can make a provider fetch something on the company's account.
- Each provider has a model allowlist. Claude: the three models above only. ChatGPT and Groq: the listed models plus newer ones in the same families, read from the provider's model list once an hour (no "pro" or dated models). OpenRouter: free (`:free`, price 0) models that support tools only.
- Replies are never cached. Calls to a provider time out after 95 seconds.
- Error messages are plain English. When a provider rejects the key, the page only says which secret to check; the provider's own message (which can contain part of the key) is never passed on, and anything that looks like a key is removed from other messages.

## Questions that work well

- "What is at risk right now, and which customers have the most value at risk?"
- "Which warehouses have the most past-due open value?"
- "Show the 10 most overdue lines for Aqua Hot."
- "Which vendors have the most late PO lines?"
- "What is due next week at CM - Alta?"
- "How are OTD, fill rate and reschedule hit rate doing?"
- "What shipped this month compared with what is still open?"
- "Find SO 12345" or "Find item SPY-100."
- "Which lines have a note mentioning 'board'?"

Ask AI answers from these tools: overview tiles (with the Order Health Leading / Lagging numbers and the Us / Them cause split), line search (each at-risk line's cause and reasons), group totals, monthly summary, build risk, and supply / demand. It does not see charts. It cannot change notes, filters or data. Questions about history the export doesn't hold, or about stock on hand, get "the data isn't loaded" rather than a guess.

## When something goes wrong

| Message | What to do |
|---|---|
| Ask AI is not set up | No provider has a key on this site, or this copy is opened as a file. IT adds a key (see Setup). |
| Tick the box above to allow sending data to … | Read the notice in Settings and tick the box for that provider. |
| The site's … key was rejected | IT checks the secret named in the message (it may be wrong, revoked or out of credit). |
| … is out of credit or has a billing problem | IT adds credit or raises the limit in the provider's console. |
| …'s free limit was reached | Wait a minute (per-minute limit) or until tomorrow (daily limit), ask a narrower question, or pick a paid provider. |
| Daily Ask AI limit reached for this site | The site's own cap on a paid provider (300 requests a day by default) is used up. Try again tomorrow, pick a free provider, or IT raises `AI_DAILY_REQUESTS`. |
| Too many Ask AI requests from this browser in the last minute | Wait a minute. |
| The question and its data were too large | Click **Clear chat** and ask a narrower question. |
| … could not use that model | Pick another model in Settings. "No tool support" means the model cannot look up dashboard data; "privacy settings" means the OpenRouter privacy setting under Setup. |
| … declined to answer this one | Rephrase the question, or pick another model. |
| …'s answer was cut off | Ask a narrower question. Free providers allow shorter answers, so a paid provider may help. |
| This question needed too many lookups | Ask about one thing at a time (one customer, warehouse or week). |
| Your sign-in to this site has expired | Reload the page and sign in again. |
| Load a KPI export first | Ask AI only answers from loaded data. |
