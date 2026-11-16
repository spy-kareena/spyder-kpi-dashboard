# Sign-in with Cloudflare Access

For whoever manages the Cloudflare account. This moves the board from one shared password to everyone signing in as
themselves, and nobody is locked out on the way: the shared password keeps working until the very last step.

## What changes for people

- Before the board opens, Cloudflare asks them to sign in: they type their work email and get a 6-digit code by email
  (one-time PIN), or use the company's Microsoft or Google sign-in if you set that up.
- The board knows who is signed in. Notes, overrides and Shipping statuses saved while signed in this way also store
  the email address Cloudflare checked (`byEmail`), next to the name shown on the board.
- Adding or removing a person is one edit in Cloudflare. Nobody shares or changes a password again.
- Settings follow people: each person's look and opening page are saved to their sign-in, and the rules behind the
  numbers are one copy for everyone, changed only by the admins you name ([Admins and team settings](#admins-and-team-settings)).

## How it works

Cloudflare Access sits in front of the site and signs people in before any page loads. It then sends each request to
the board with a signed token saying who the person is. The board checks that token itself on every request
(`functions/_middleware.js`, with the two settings `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` below). So even an address
that Access does not cover by mistake shows only "This board signs in through Cloudflare Access", never any data.

| Settings on the Pages project | What the board does |
|---|---|
| Access settings only | Cloudflare sign-in only; no password page |
| Access settings and `DASHBOARD_PASSWORD` | Both: Cloudflare sign-in, then the shared password (the changeover) |
| `DASHBOARD_PASSWORD` only | The shared password, as before |
| Neither, or only one of the two Access settings | Every page says "Dashboard sign-in is not configured" (on purpose) |

## Before you start

- You need to be an administrator on the Cloudflare account that holds the Pages project `spyder-kpi-dashboard`.
- Allow about 30 minutes. Cloudflare moves its menus around from time to time: if a menu name below is not where it
  says, search the dashboard for it.

## Step by step

### 1. Create the Zero Trust team (free for up to 50 users)

1. In the Cloudflare dashboard, open **Zero Trust**.
2. Pick a team name, for example `spyder`. Your **team domain** is then `spyder.cloudflareaccess.com`.
3. Choose the **Free** plan (up to 50 users). Cloudflare may ask for a payment card even for the free plan.

### 2. Add a login method

Zero Trust > **Settings > Authentication > Login methods** (newer dashboards: **Integrations > Identity providers**).

- **One-time PIN** works at once, with nothing else to set up: people type their email and get a code. Add it.
- **Microsoft Entra ID** (Microsoft 365) or **Google Workspace**: recommended if the company uses one of them. People
  then use their normal work sign-in, and someone who leaves the company loses access when their work account is
  closed. It needs the company's Microsoft or Google administrator to register Cloudflare as an app; Cloudflare's guide
  for each login method walks through it. You can add it later; the board does not change.

### 3. Create the Access application

The application is what Access puts in front of the board. It must cover every address the board is opened at:

- `spyder-kpi-dashboard.pages.dev` (the live site)
- `*.spyder-kpi-dashboard.pages.dev` (preview deployments, one per branch)
- the board's own custom domain, if it has one

The easiest start is from the Pages project:

1. Cloudflare dashboard > **Workers & Pages > spyder-kpi-dashboard > Settings > General**, under **Access policy**:
   select **Enable access policy**. This protects the preview deployments and creates an Access application for them.
2. Select **Manage** next to it. This opens the application in Zero Trust (**Access > Applications**). Edit it
   (**Configure** or **Edit**):
   - **Public hostnames / Application domain:** keep `*.spyder-kpi-dashboard.pages.dev` and add
     `spyder-kpi-dashboard.pages.dev` (subdomain `spyder-kpi-dashboard`, domain `pages.dev`, no `*`). Add the custom
     domain too if the board has one.
   - If Cloudflare does not let you add one of these addresses here, create another application for it instead:
     **Access > Applications > Add an application > Self-hosted**, with that address and the same policy, login
     methods and session duration as below. That is fine: the board accepts more than one application (step 4).
   - If the board has a custom domain and you would rather nobody used the `pages.dev` address, you can redirect it to
     the custom domain instead (Cloudflare's guide "Redirecting *.pages.dev to a custom domain").
3. **Policies:** remove the policy Cloudflare made by default (it only lets in the Cloudflare account's own members) and
   add one:
   - Action **Allow**, name it for example "Spyder staff".
   - **Include:** **Emails ending in** `@spydercontrols.com`. For people outside the company (a contractor), add an
     **Emails** rule with their exact addresses. Each Include rule lets people in on its own.
4. **Session duration:** how long a sign-in lasts before Cloudflare asks again, for example 24 hours or 1 week.
5. **Login methods:** tick the ones from step 2.
6. Save the application.

### 4. Copy two values

- **Team domain:** Zero Trust > **Settings** (team name and domain, or **Custom Pages**): for example
  `spyder.cloudflareaccess.com`.
- **AUD tag:** Zero Trust > **Access > Applications** > the application > **Overview** (or **Configure > Basic
  information**): **Application Audience (AUD) Tag**, a long code of letters and numbers. If more than one application
  covers the board (step 3), copy the AUD tag of each.

### 5. Put them in the Pages project

Cloudflare dashboard > **Workers & Pages > spyder-kpi-dashboard > Settings > Variables and Secrets** > **Add**:

| Name | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | The team domain: `spyder`, `spyder.cloudflareaccess.com` or `https://spyder.cloudflareaccess.com` all work |
| `ACCESS_AUD` | The AUD tag. Several applications: all their tags, separated by commas |

- Choose type **Secret** for both, like the board's other settings: the repo's `wrangler.toml` replaces plain-text
  variables on every deploy.
- Add both to **Production** and to **Preview**.
- Add them together. With only one of the two, every page says "Dashboard sign-in is not configured" until the other
  is there too. This is on purpose, so a half-finished setup can never look as if it works.

From a terminal in the dashboard folder this sets them for Production:

```
npx wrangler pages secret put ACCESS_TEAM_DOMAIN --project-name spyder-kpi-dashboard
npx wrangler pages secret put ACCESS_AUD --project-name spyder-kpi-dashboard
```

### 6. Redeploy

New settings only reach the site with a new deployment: push to `main`, or **Deployments** > the latest one > **Retry
deployment**.

### 7. Check it

1. Open the board in a private window. Cloudflare's sign-in page comes first; sign in with your email.
2. The board's own password page still follows. That is the changeover: both are on. Sign in with the password.
3. Open `https://spyder-kpi-dashboard.pages.dev/api/me` (or the same path on the custom domain). It should show
   `"access":true`, `"password":true` and your email address under `"user"`.
4. If you use previews, open a preview link too: Cloudflare's sign-in should come first there as well.

If the board shows "This board signs in through Cloudflare Access. Reload the page to sign in." after you signed in,
see the table at the end.

### 8. Retire the shared password

Once everyone knows about the new sign-in (they need nothing but their work email):

1. **Settings > Variables and Secrets:** delete `DASHBOARD_PASSWORD` from Production and Preview.
2. Redeploy (step 6).
3. Check `/api/me` again: `"password":false`, and there is no password page any more.

`SESSION_SECRET` is no longer used then. Delete it, or keep it in case you ever turn the password back on. To go
back, add `DASHBOARD_PASSWORD` again and redeploy.

## Day to day

- **Add someone:** with a `@spydercontrols.com` address there is nothing to do. Anyone else: add their email to the
  policy's **Emails** rule (Access > Applications > the application > Policies).
- **Remove someone:** take their email out of the policy (with Microsoft or Google sign-in, closing their work account
  is enough). To end a sign-in that is still open: Zero Trust > **My Team > Users** > the person > **Revoke session**.
- **Sign out:** the board's Sign out (`/logout`) ends the board's own session and the Cloudflare sign-in.
- **Scripts and tools:** a program can reach the board with an Access **service token** and a **Service Auth** policy
  on this application. The board lets it in and records it as a service, not a person. (While the shared password
  is still on, a program would need that too, so service tokens are for after step 8.)
- **The SAP bridge is separate.** Live SAP already uses an Access service token (`CF_ACCESS_CLIENT_ID` and
  `CF_ACCESS_CLIENT_SECRET`) for the bridge's own tunnel application ([LIVE_SAP.md](LIVE_SAP.md)). That has nothing to
  do with signing people in: leave it as it is, and do not put its AUD tag in `ACCESS_AUD`.

## Admins and team settings

With Access on, the board saves settings to people's sign-ins instead of to each browser. There are two kinds:

- **Personal settings** change how the board looks and opens, for one person. Each person sets their own and they
  follow them to any computer they sign in on: the theme, the background, the Christmas theme, how many lines the
  lists show, the view Sales Order Health opens on, the view Purchase Orders opens on, the page the board opens on,
  whether line lists start folded or open, when the Import report shows, the data source (Live SAP or Import files) and
  the hidden pages. Nobody else sees them. They work as soon as Access is on; nothing else to set.
- **Team settings** are the rules behind the numbers, one copy for everyone: the at-risk target, the on-track
  tolerance (days), the look-ahead window, the on-time goals for sales orders and for vendors, and the ready-made note
  comments for sales-order and purchase-order lines. Everyone sees the same numbers, and only **admins** can change
  them. The board keeps the last 20 changes (when, who, which settings).

Name the admins in one secret:

1. **Workers & Pages > spyder-kpi-dashboard > Settings > Variables and Secrets** > **Add**: name `ADMIN_EMAILS`, type
   **Secret**, value the admins' work email addresses separated by commas, for example
   `name@spydercontrols.com, other@spydercontrols.com`. Add it to **Production** and to **Preview**.
   From a terminal: `npx wrangler pages secret put ADMIN_EMAILS --project-name spyder-kpi-dashboard`
2. Redeploy (step 6).
3. Signed in as an admin, open `/api/me`: it shows `"admin":true` and `"teamSettings":true`. Anyone else sees
   `"admin":false`.

- **Add or remove an admin:** edit `ADMIN_EMAILS` and redeploy. Cloudflare does not show a secret's value again, so
  type the whole list each time. Commas, semicolons or spaces between addresses all work, capitals do not matter, and
  anything that is not an email address is ignored. Each admin must sign in to Access with exactly that address.
- **Before Access is on** (the shared password alone), everything stays in each browser, as today: the shared
  password cannot tell people apart. With Access on but no admin named in `ADMIN_EMAILS`, personal settings follow
  people and team settings stay in each browser.
- **Turning team settings off:** delete `ADMIN_EMAILS` and redeploy. Each browser goes back to its own copy; the saved
  team settings stay in storage (key `team-settings`) for when admins are named again.
- Both kinds are kept in the board's shared storage (`REPORT_STORE`, already set up for the shared notes). A person's
  settings are stored under a one-way code made from their email address, not the address itself.

## If something is wrong

| What you see | Why | Fix |
|---|---|---|
| "Dashboard sign-in is not configured: ACCESS_TEAM_DOMAIN is set but ACCESS_AUD is not" (or the other way round) | Only one of the two settings is in this deployment | Add the other one (Production and Preview), redeploy |
| "ACCESS_TEAM_DOMAIN must look like ..." | The team domain has a typo or a path after it | Use just the team name, for example `spyder` |
| "This board signs in through Cloudflare Access. Reload the page to sign in." after signing in | The sign-in was for another application (its AUD tag is not in `ACCESS_AUD`), another team, or this address is not in the application | Check the AUD tags (every application that covers the board, separated by commas), the team domain, and the application's addresses; redeploy |
| The same message on an address with no Cloudflare sign-in before it | Access does not cover that address | Add it to the application (step 3) |
| Cloudflare says your account does not have access | Your email is not in the policy | Add it to the policy |
| `/api/me` shows `"access":false` | The settings are not in this deployment (Preview and Production have their own) | Add them to both, redeploy |
| The board's password page still shows after step 8 | `DASHBOARD_PASSWORD` is still set in this environment, or no redeploy yet | Delete it from both, redeploy |
| `/api/me` shows `"admin":false` for someone who should be an admin | Their address is not in `ADMIN_EMAILS` exactly as they sign in (see `"user"` in the same answer), the secret is not in this environment, or no redeploy yet | Fix `ADMIN_EMAILS` (Production and Preview), redeploy |
| `/api/me` shows `"teamSettings":false` with Access on | `ADMIN_EMAILS` is missing in this environment or holds no valid email address | Add it, redeploy |
