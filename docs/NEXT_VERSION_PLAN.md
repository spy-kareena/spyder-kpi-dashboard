# Spyder KPI Dashboard — next version plan

> **Status (2026-10-09): built.** Steps 1–8 (waves 1 and 2) are in version 2v1 (see `VERSION.txt`, entries 1v6 to 2v1); all tests pass with `node tests/run-all.js`. What is left needs the owner: [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md) (Cloudflare deploy, KV id, secrets, FedEx Worker, SQL re-run, real-data checks). Line numbers and file names below are from when the plan was written (for example `functions/api/gemini/` has since been removed).

## Context
Owner wants the dashboard to keep its uploaded SAP report, get a matching login screen, roomier shadcn-style UI, a rebuilt Ask AI (Anthropic, ChatGPT, Groq, OpenRouter with shared server keys), Order Health split into Leading/Lagging tabs with Us/Them cause, reasons, "when flagged", $20k waffle offenders, CM SFG split in the Warehouse scorecard, Sankey "big picture" toggles, and a live FedEx (parcel + Freight LTL) shipping page with cross-border tracking. Decisions from Q&A:
- **No TypeScript/React rewrite.** Stay with the single `index.html` (vanilla JS, inline CSS, bundled SheetJS). Update what exists (SheetJS, wrangler config, docs). shadcn **look** rebuilt in plain CSS.
- **Accounts:** sign out `aaronjoseph94` / current Cloudflare; owner signs in as Kareena's GitHub + Cloudflare. All deploys go to `spy-kareena/spyder-kpi-dashboard` → Cloudflare Pages `spyder-kpi-dashboard`.
- **Persistence:** shared on the server (Cloudflare KV) — report files (already coded, commit `2828f64`, unpushed), plus notes/overrides/causes/shipment entries, plus at-risk history per upload. Browser IndexedDB/localStorage stay as offline fallback.
- **AI keys:** server secrets, shared. MCP connector stays.
- **Order Health:** two tabs (Leading | Lagging); Us/Them = default mapping + per-line manual cause; "when flagged" = age since first seen at risk (server history) + top-6 reasons chart.
- **Sankey:** 4 flows (open SO value, at-risk value, Build Risk, Supply).
- **Shipping:** tracking # from SAP `ODLN.TrackNo` (SQL change) + manual entry; FedEx Track API polled every 4 h by a scheduled Worker; cross-border = ship-to country ≠ origin + FedEx customs events.

Repo root. Key files: `index.html` (6,235 lines), `functions/_middleware.js` (login gate, `loginPage()` at :141), `functions/api/report.js` (shared report), `functions/api/gemini/[[path]].js` (to delete), `mcp/spyder-kpi-mcp.mjs` (loads index.html in a Node vm — every page global it uses must survive), `tests/harness.js` + `node tests/run-all.js` (147 tests), `queries/sap_b1_hana_kpi_current_dashboard_so_po_with_lagging.sql` (delivery part `FROM ODLN D0` at :259), docs in `README.md`, `docs/*.md`, `VERSION.txt`.

Rules for every step: update README/docs/in-app help/comments with the change; add tests in `tests/` (harness fixtures only, never customer data); run `node tests/run-all.js`; browser check with the real export via `scratchpad/wr/dev.js` (wrangler pages dev :8788, local KV) counting only; commit + push; verify live. Never commit the export/CTB workbook or keys.

## Step 0 — account switch (needs owner)
1. Me: `gh auth logout -h github.com -u aaronjoseph94`, `npx wrangler logout` (scratchpad `wr/`).
2. Owner: `gh auth login` as spy-kareena; `npx wrangler login` in Kareena's Cloudflare.
3. Me: push `main` (2828f64), confirm Pages auto-deploys from GitHub (Deployments tab) or `wrangler pages deploy`.

## Step 1 — 1v5 finish shared report (already coded)
- Add `wrangler.toml` at repo root: `name="spyder-kpi-dashboard"`, `pages_build_output_dir="."`, `compatibility_date`, `[[kv_namespaces]] binding="REPORT_STORE" id=<created via wrangler kv namespace create spyder-kpi-report>`. Pages reads bindings from wrangler.toml on Git builds, so no dashboard clicking. Secrets stay `wrangler pages secret put`.
- Verify on live site: upload → sidebar "Saved for everyone who signs in"; second browser opens on it.

## Step 2 — 1v6 UI polish (items 3, 5, 6, shadcn look, CM SFG)
- Logo gap: `.sidebar-brand{gap:7px}` (:196) → 14px; product label `.product` smaller tracking; phone rule :713 same ratio.
- Roomier: `.main{gap:24px}`→32px (:77), `.grid-lead/.grid-4/.grid-5 gap 14`→20px (:269-270), `.card padding 20px 22px`→24px 26px (:103), mini-strip padding +4px, section head margins. Keep print block compact (print CSS at :740-835 overrides to old values).
- shadcn look, CSS only: tokens on `:root` (:47) → zinc neutrals, `--r-card:12px --r-ctl:8px --r-btn:8px`, 1px `zinc-200` borders, `box-shadow` hairline, `--ring` focus `2px` offset ring, Inter via `--font`; restyle `.btn` (default/primary/ghost/destructive sizes), `.select`, `.chip`→badge, `.segmented`→tabs list, note editor inputs, `.data-table` (muted header, row hover `zinc-50`), popover/dialog (Data check, note editor, Ask AI drawer), add a toast element (`#toast`, role=status) used by bulk Apply/Delete/Restore/Save. Transitions 150–200 ms, `prefers-reduced-motion` guard. Keep every selector/id tests rely on (`linked-select-all`, `data-focus-key`, etc.).
- Login page (`functions/_middleware.js` `loginPage()` :141-186): same tokens/fonts; add `assets/spyder-logo.png` (same bytes as `LOGO_SRC` in index.html; index.html keeps its inline data URI for Share snapshot), message "Welcome back / Sign in to see this week's order health, purchase orders and build risk." + footer "Internal use · Spyder Controls"; error state inline; `autocomplete=current-password`. Middleware must serve `/assets/*` without a session (add to the pass-through list before the cookie check). Tests in `tests/middleware.test.mjs`: logo path served unauthenticated, HTML contains message.
- Warehouse scorecard (`index.html` :5072-5137): split rows into two groups inside the one card — **CM SFG** (`/^CM SFG - /i`) and **All other warehouses** — each with a group header row and a subtotal row (open, risk, past due, OTD%); "Show top 9" applies per group. Click behaviour unchanged. Test: fixture with 2 SFG + 3 other warehouses → two headers, subtotals add up.

## Step 3 — 1v7 shared notes/overrides/causes + at-risk history
- `functions/api/notes.js`: KV key `overrides`, doc `{v:1,rows:{[rowKey]:{status,notes,cause,deleted,by,at}}}`; `GET` → doc; `PATCH` body `{rows:{key:entry}}` merges by `at` (newer wins), same-origin check like report.js, size cap. KV ops: 1 read per page open, 1 write per edit (debounced 800 ms per key).
- Client (`index.html` `loadRowOverrides` :1298, `updateRowOverride` :1390, `writeRowOverride`/`setRowOverrides`): after `restoreSavedReport()` fetch `/api/notes`, merge with localStorage by `at`; every write stamps `by` (editor initials asked once, `localStorage spyderKpiEditor`) and `at`, saves locally and queues a PATCH; sidebar line "Notes shared · last edit KK Oct 8". Snapshot export embeds merged doc as today. Offline/static host → local only (404/503 detection as in `shareReportFiles`).
- Manual cause: `OVERRIDE_OPTIONS` (:983) stays; add `cause` select (`Us`/`Them`/blank) next to override in `renderOverrideSelect` (:1544) and bulk bar (:5346). `rowOverrides` entries gain `cause`.
- At-risk history: `functions/api/report.js` PUT also accepts header field `atRisk:{asOf,keys:[rowKey...]}` computed client-side from `orderHealthData(m).lateTileRows` (cap 5k keys, ~200 KB) and appends to KV key `history` (`{weeks:[{asOf,keys}]}`, keep 52, skip if same `asOf`). `GET /api/history` returns it. Client computes `firstFlagged[key]` = earliest week containing the key.
- Tests: `tests/notes-store.test.mjs` (merge rules, origin check), `tests/shared-notes.test.js` (two browsers see one override; offline fallback), history append/no-dup.

## Step 4 — 1v8 Order Health v2 (item 7)
Pure additions inside `renderResults()`'s weekly branch (`orderHealthData` :3459, weekly render ~:4900-5400); existing KPI rules untouched.
- State `weeklyView='leading'|'lagging'` (persisted in snapshot/resetViewState); tabs list under the filter bar (shadcn tabs, arrow-key navigation). Shared filters + linked lines stay below both tabs.
- Cause engine: `CAUSE_MAP` const (Us: Waiting on Production, QC Delay, Supply Chain, Supplier Late, Waiting on PO, Partial Coverage, R&D Hold, No Commit, past-due-no-reschedule, Confirmed≠Y; Them: Hold, Urgent, Close Short, Short Ship, Shipping Delay, customer reschedule; Neutral: Not At Risk, Covered). `lineCause(r)` = manual `cause` ?? map(override) ?? map(SAP signal) ?? 'unknown'. `lineReasons(r)` → list from SAP (Past due · no reschedule, No commit date, Rescheduled later, Unconfirmed, Supply shortage via S/D rows) + override reason.
- **Leading tab:** cards — At risk ($, orders, Us/Them split bar), Open orders (count/value) with **Top 6 at-risk reasons** chart (horizontal bars by open value, click → `weeklyReasonFilter`), **Open order states** strip (On track / Due this week / Rescheduled / Past due / No commit; click → tile filter), **When flagged** chart (New this week / 1–2 wk / 3–4 / 5–8 / 9+ from history; click filters), Due next week / Due this month kept. Us vs Them card: value + count, click → `weeklyCauseFilter`.
- **Lagging tab:** OTD 3 mo, Shipped this week, Fill rate, Reschedule hit 12 mo, Perfect order %, Avg days late (closed last 3 mo), each with sparkline and Us/Them split using stored `cause` on closed lines (cause persists by rowKey across uploads) or SAP flags.
- **Top offenders** (weeklyOffenderView ~:5049): waffle grid, `BLOCK_VALUE=20000`, blocks tinted by Us/Them share, hover title full value, click filters; tiny values show a half block, legend "■ = $20k".
- New filters (`weeklyReasonFilter`, `weeklyCauseFilter`, `weeklyAgeFilter`) flow through `cachedByFilter` keys, linked lines, Search, KPI_TOOLS (`get_overview` gains `leading/lagging` + `cause` fields; MCP docs updated).
- Tests: `tests/order-health-v2.test.js` (cause mapping precedence, reasons ranking, states partition sums to open lines, waffle block counts, tab state in snapshot, filters compose).

## Step 5 — 1v9 Ask AI rebuild (item 4)
- Remove: `index.html` Gemini panel code :3962-~4300 (`aiState`…`aiResetClone`) and its CSS/markup (`#ai-panel`), `functions/api/gemini/`, `docs/AI_ASSISTANT.md` (rewrite), tests `tests/ai.test.js`, `tests/gemini-proxy.test.mjs`, Gemini parts of `tests/review-ai-proxy-mcp.test.js`. Keep `KPI_TOOLS`/`aiRunTool` (:3765-3960; MCP uses them).
- New `functions/api/ai/[[path]].js`: `GET status` → providers configured + model lists; `POST chat` body `{provider, model, messages, tools}`; providers: `anthropic` (Messages API, `x-api-key`, `anthropic-version`), `openai` (Chat Completions), `groq` (`api.groq.com/openai/v1`), `openrouter` (`openrouter.ai/api/v1`, free models only = pricing 0). Secrets `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`. Model allowlist per provider (constant + `/models` fetch filtered by prefix), 1 MB body cap, no-store, same session gate.
- New panel: provider/model picker grouped **Paid** (Anthropic, ChatGPT) / **Free** (Groq, OpenRouter), per-provider data-use notice + consent tick (free tiers may train on data), chat with tool loop for two dialects (Anthropic tools vs OpenAI-style for the other three), stop/clear, markdown-lite reuse, drawer focus trap/Esc as today, reset on new data. Snapshots strip the panel.
- Tests: `tests/ai-proxy.test.mjs` (routing, allowlist, 503 when key missing, body cap, no key leak), `tests/ask-ai.test.js` (tool loop both dialects with mocked fetch, consent gate, status rendering).
- Docs: `docs/AI_ASSISTANT.md` rewritten (keys, costs, data terms per provider), README, IT_HOSTING (secrets list), Connect an AI page text.

## Step 6 — 2v0 Sankey "big picture" (item 9)
- `sankeyLayout(nodes,links,{width,height})` pure function (~150 lines, no d3): columns by node level, order by value, 8 px node width, link paths as cubic béziers, min node height 4 px, value labels. SVG with CSS transitions on `d`/`y` (animate via Web Animations API on toggle), nodes are `<a role=button tabindex=0>` with `title`.
- Toggle button "Big picture" (`data-focus-key`) on Order Health (flows: Open SO value Warehouse/CM→Status→Segment; At-risk value Reason→Us/Them→Customer top 8 + Other), Build Risk (CM→CTB/At risk/Late→Month), Supply Mix (Source→Item group→Demand month). State `sankeyOpen[tab]` in snapshot. Clicking a node applies that page's existing filter (`weeklyWarehouseFilter`, segment, `weeklyTileFilter`, customer, `buildRiskSnapshot`/CM filter, supply warehouse) and highlights paths. Print renders static.
- Tests: `tests/sankey.test.js` (layout invariants: link widths sum to node heights, no overlaps, columns sorted; flows sum to page totals; node click sets filter).

## Step 7 — 2v1 Live shipping (item 8)
- SQL (`queries/...so_po_with_lagging.sql` delivery block :259-263): add `D0."TrackNo" AS "TrackingNumber"`, `SHP."TrnspName" AS "ShipMethod"` (`LEFT JOIN OSHP SHP ON D0."TrnspCode"=SHP."TrnspCode"`), `A."Country" AS "ShipToCountry"` (`LEFT JOIN CRD1 A ON A."CardCode"=D0."CardCode" AND A."Address"=D0."ShipToCode" AND A."AdresType"='S'`), `D0."DocDate" AS "ShipDate"`. Null-safe in `normalizeRows` (headers optional; `SAP_HEADERS` in tests gains them). Owner re-runs the query in SAP.
- Shared code `shared/fedex.mjs` (OAuth client-credentials token cached in KV, `POST https://apis.fedex.com/track/v1/trackingnumbers` in batches of 30, normalize → `{number, carrier:'FedEx'|'FedEx Freight', status, stage: label|pickedUp|inTransit|customs|outForDelivery|delivered|exception, lastEvent{at,city,desc}, eta, deliveredAt, customs[{at,desc}], exception}`), imported by both the Pages Function and the Worker.
- `functions/api/shipping.js`: `GET` → KV `tracking:index` statuses; `PUT wanted` (same-origin) stores the tracking set the page derived (delivery rows with TrackingNumber, DocumentDate ≤ 30 d, not delivered > 7 d, plus manual entries from the notes store `shipments`); `POST refresh` → on-demand poll (rate-limited to 1 per 10 min).
- `workers/shipping-poller/` (own `wrangler.toml`: `[triggers] crons=["0 */4 * * *"]`, same KV namespace, secrets `FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET`): `scheduled()` polls `tracking:wanted`, writes statuses + `polledAt`. Deployed with `wrangler deploy` from that folder. Owner creates FedEx Track API project at developer.fedex.com and sets the secrets.
- Page **Shipping** (Sales group, `PAGE_TITLES.shipping`): header "Updated 12 min ago · next check 3:40 PM"; cards: In transit / Out for delivery / Delivered this week / Exceptions / In customs; **horizontal process strip** per shipment (6 stages, filled to current, exception marker, click → expands order lines (linked rows by DeliveryDocNumber), last scan, ETA vs promised date → "2 days late"); **Cross-border** section: shipments with `ShipToCountry ≠ 'CA'` or customs events, stage In clearance / Clearance delay / Released, days in customs; manual **Add tracking #** (order + number) saved to shared notes; search works over tracking numbers. Static host: page explains it needs the hosted site.
- Tests: `tests/fedex.test.mjs` (normalize fixtures: parcel, freight, customs delay, exception, delivered), `tests/shipping-api.test.mjs` (wanted set rules, refresh rate limit), `tests/shipping-page.test.js` (strip stages, cross-border detection, manual entry), worker `scheduled()` with mocked fetch.
- Docs: `docs/SHIPPING.md` (FedEx setup, secrets, cron, limits), IT_HOSTING, README, quick start.

## Step 8 — dependencies & docs sweep (item 2, "whatever exists is updated")
- SheetJS inline bundle → latest community build (check `XLSX.version`; replace `<script id="sheetjs-lib">` contents), rerun import tests on the real export (counts only).
- `wrangler.toml` compatibility_date current; `mcp/` Node ≥ 20 note; `web.config` MIME for `.mjs`/assets.
- Final pass: README feature list, `docs/USER_QUICK_START.md`, `docs/IT_HOSTING_README.md` (secrets: DASHBOARD_PASSWORD, SESSION_SECRET, 4 AI keys, 2 FedEx; KV binding; Worker cron), `docs/MCP.md`, `VERSION.txt` entries per step, in-app help texts (Connect an AI, Order Health "About these numbers", Shipping intro).

## Cross-cutting — tooltips & descriptions (every agent, every step)
- One tooltip mechanism, built in Step 2 by the UI agent, used by all: `data-tip="text"` on any control/card/chart element → CSS-only shadcn-style tooltip (`::after`, 200 ms delay, dark zinc bubble, arrow, shown on hover **and** `:focus-visible`), plus `aria-describedby` wiring via a tiny `tip()` helper for screen readers. Touch: long-press shows it; print hides.
- Every KPI card, tile, chart, column header, filter chip, preset, toggle, button and sidebar page gets a plain-English `data-tip` ("At risk = open lines past due with no reschedule, no commit date, or rescheduled later. Click to list them."). Numbers formatted in full inside tips ($1,721,806).
- Section **ⓘ** buttons open a popover with definition, data source (SAP field / override), and what clicking does. Each page's "About these numbers" block expanded accordingly; sidebar nav items carry one-line descriptions (visible as tip, and under the title on the upload screen).
- First-visit hints (dismissable, stored in localStorage `spyderKpiHints`): upload screen (what to load), Order Health tabs (Leading vs Lagging), Shipping (where tracking numbers come from), Ask AI (data terms). "Show hints again" link in the Help group.
- Agents writing new UI must add tips in the same change; the review wave checks for untipped controls (test: every `.kpi`, `.chip`, `.th-sort`, `.btn` in rendered pages has `data-tip` or `title`).

## Execution — multiple agents in parallel (Workflow tool)
Per-agent git worktrees from `main` (`scratchpad/wt/<stream>`), feature branches, frequent WIP commits (network drops happened before). Agents reuse `tests/harness.js`, never touch customer data, print counts only. Contracts fixed up front so streams do not block each other:
- `rowOverrides[key].cause ∈ 'us'|'them'|''`, `.by`, `.at` (Stream B defines, D consumes).
- `firstFlagged[rowKey] → asOf string` global (B defines, D consumes).
- `data-tip` attribute + `tip()` (A defines, all use).
- KV keys: `report`, `overrides`, `history`, `tracking:*` (B/E), one namespace.
- Index.html regions: each stream edits only its own functions/sections; new code goes in new `// --- <stream> ---` blocks near the end of `#kpi-app` to minimise merge conflicts.

**Wave 1 (parallel, ~2–3 h wall-clock):**
- A — UI polish: tokens/shadcn look, spacing, logo gap, tooltips mechanism, toast, login page, CM SFG scorecard split (Step 2 + tooltips).
- B — Shared notes/overrides/cause + at-risk history API and client (Step 3).
- C — Ask AI rebuild, 4 providers (Step 5).
- D — Order Health v2: Leading/Lagging, cause engine, reasons, states, when-flagged, $20k waffle (Step 4) coded against B's contract with a local stub.
- E — Shipping: SQL, `shared/fedex.mjs`, Pages API, Worker cron, page (Step 7).
- F — Sankey layout + toggles (Step 6).
Each ends with its tests green and a report (what changed, open questions).

**Wave 2 (~1 h):** me — merge A→B→D→C→F→E into `main` in that order, resolve conflicts, `node tests/run-all.js`, SheetJS/wrangler/docs sweep (Step 8), browser check on local Cloudflare stack, push, verify live.

**Wave 3 (~1.5–2 h):** review workflow as before — 6 lenses (correctness/state, security/privacy, a11y + tooltips coverage, layout/print, edge cases, performance) → triage → skeptic verify → per-area fixers in worktrees → merge, tests, push.

**Estimate:** ~6–8 hours of agent wall-clock across the three waves, plus owner steps (sign-ins now; secrets, FedEx project and SQL re-run whenever ready — streams build against mocks until then). Each wave ends with a push, so the live site improves in stages rather than at the end.

## Verification (every step)
1. `node tests/run-all.js` → all files pass (expect ~190 tests by 2v1).
2. Local Cloudflare stack: `preview_start kpi-wrangler` (scratchpad `wr/dev.js`, local KV + test password) → sign in, load real export + CTB via `/__data`, check counts only (At Risk 62/124/$836,876 unchanged unless a step says otherwise), reload in a wiped browser → report + notes come back; console clean; screenshot per page incl. 375 px and print.
3. MCP: `node mcp/spyder-kpi-mcp.mjs --check <export>` still works after each index.html change.
4. Live after push: sign in to spyder-kpi-dashboard.pages.dev, confirm version in sidebar/VERSION, shared report + notes visible from a second browser; Worker cron visible in Cloudflare → Workers → Triggers.

## Needs the owner (collected, not blocking the start)
- Step 0 sign-ins; Cloudflare secrets (`wrangler pages secret put` for AI keys; `wrangler secret put` in `workers/shipping-poller` for FedEx); FedEx developer project (Track API, production key); re-run the updated SQL in SAP for the next export; confirm login message wording; editor initials prompt on first note.

## Handoff to the cloud session (2026-10-08)
- **Build settings asked by the owner:** the most capable model, extra effort, multiple agents in parallel (Workflow tool, one worktree per stream, waves as above). Accept all defaults; do not ask the owner questions.
- **Repo state:** `main` includes 2828f64 (1v5 shared report on the server, `functions/api/report.js`) and this plan. All 147 tests pass: `node tests/run-all.js`.
- **No customer data in the cloud:** the real SAP export and the Clear To Build workbook stay on the owner's PC and are never committed. Build and test against the synthetic fixtures in `tests/harness.js`. Real-data checks (counts only) happen later on the owner's PC.
- **Local-only paths in this plan** (`scratchpad/wr/dev.js`, `/__data/export.xls`, the browser pane) do not exist in the cloud. For a local Cloudflare stack use `npx wrangler pages dev . --kv REPORT_STORE --binding DASHBOARD_PASSWORD=<test> --binding SESSION_SECRET=<test>` with generated test values.
- **Accounts:** GitHub `spy-kareena/spyder-kpi-dashboard` (cloud pushes through its own GitHub access). Cloudflare Pages project `spyder-kpi-dashboard` is in Kareena's Cloudflare account; there is no Cloudflare login in the cloud. Ship config in `wrangler.toml` (Git builds read its KV bindings) and list owner steps: create KV namespace `spyder-kpi-report` and paste its id into `wrangler.toml`, `wrangler pages secret put` for the AI keys, FedEx developer project + `wrangler secret put` for the poller, deploy `workers/shipping-poller`, re-run the updated SQL in SAP.
- **Known live-site facts:** live URL https://spyder-kpi-dashboard.pages.dev (password gate). Confirm in Cloudflare whether Pages deploys from GitHub on push; if not, the owner deploys with `npx wrangler pages deploy . --project-name spyder-kpi-dashboard`.
