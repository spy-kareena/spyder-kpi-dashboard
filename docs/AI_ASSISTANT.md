# Ask AI (Google Gemini)

**Ask AI** opens a chat panel on the right of the dashboard. You type a question in plain English. Google's Gemini model then looks up the numbers it needs from the loaded export and answers. It uses the same numbers the pages show, as of the export date, and lists what it looked up under each answer.

Gemini can be wrong. Check any number you are going to act on against the page.

## Privacy: read this first

- Your questions, and the dashboard data needed to answer them, are sent from your browser to Google's Gemini API. That data includes order and PO lines, customer and vendor names, warehouses, values and saved notes.
- On the **free tier**, Google may use prompts and responses to improve its products, and people at Google may review them. See the [Gemini API terms](https://ai.google.dev/gemini-api/terms). A paid (billing-enabled) key has stricter data terms.
- Don't use Ask AI for data your company hasn't approved for sharing with Google.
- Before it sends anything, the panel asks you to tick a consent box. The choice is saved per browser. Untick it in **Settings** to turn Ask AI off.
- The chat and the key never go into a **Share snapshot** file.

## Option A: use your own free key

1. Sign in at [Google AI Studio](https://aistudio.google.com/apikey) and click **Create API key**. The free tier needs no credit card.
2. In the dashboard, open a page, click **Ask AI** and tick the consent box.
3. Paste the key and click **Save key**.
   - **Remember on this browser** keeps the key in this browser's storage until you click **Remove key**.
   - If you leave it unticked, the key is kept only until the tab closes.
4. Pick a model. A Flash model is chosen by default, and Flash models are the ones the free tier allows the most use of.

The key goes from your browser straight to Google, in a request header. It is never put in a URL, a log, the page, or a snapshot file.

## Option B: one key on the hosted site (Cloudflare Pages)

If the dashboard is hosted on Cloudflare Pages, IT can store one key on the server. Then users don't need their own. The page checks `/api/gemini/status` and, when a key is set up, sends its requests through `/api/gemini/...`. The browser never sees the key.

```
wrangler pages secret put GEMINI_API_KEY
```

Redeploy after you set the secret. The proxy is in `functions/api/gemini/[[path]].js`. It sits behind the same password gate as the rest of the site (`functions/_middleware.js`).

The proxy only does three things:

- reports whether a key is set
- lists models
- forwards `generateContent` requests

Each request body is limited to 1 MB. Responses are never cached.

Usage counts against that one key's quota, so a shared free key can hit its daily limit when many people use it. A key with billing enabled avoids this, and its data terms also exclude using prompts to improve Google's products.

Opened from a file (`file://`) or from another web server, the page uses Option A.

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
| Google did not accept this API key | Check the key in Settings, or create a new one in AI Studio. |
| Free-tier limit was reached | Wait a minute (per-minute limit) or until tomorrow (daily limit), or pick a lighter model. |
| Could not reach Google's Gemini API | Something on the network blocks `generativelanguage.googleapis.com`: a firewall, a proxy, or a browser extension. |
| Safety filter blocked it | Rephrase the question. |
| Load a KPI export first | Ask AI only answers from loaded data. |
