# Work Tracker

A clean, private tracker for your own tasks. Capture a task, set its priority, target date and progress, and keep a running log of progress updates.

- **List view** with priority stripes, status pills, progress bars, and overdue / due-soon highlighting
- **Board view**: drag cards between To do, In progress, Blocked and Done
- **Summary tiles** (Active, In progress, Due this week, Overdue, Done in the last 30 days). Click a tile to filter by it
- **Task drawer** for editing details and posting progress updates. Status, progress, priority and date changes are logged to the timeline automatically
- Search, priority filter, sorting, light/dark mode, works on mobile
- Shortcuts: `N` new task, `/` search, `Esc` close, `Ctrl/⌘+Enter` save or post

## Stack (all free tier)

| Piece | Cloudflare product | Free allowance |
| --- | --- | --- |
| Web app + API | Pages + Pages Functions | Unlimited static requests, 100k function requests/day |
| Database | D1 (SQLite) | 5 GB, 5M row reads/day |
| Login | Zero Trust / Access | Up to 50 users |

No frameworks and no third-party scripts. The front end is plain HTML, CSS and JS in `public/`, and the API is in `functions/api/`.

## Security

- **Cloudflare Access** puts a login screen in front of the whole site, so nobody reaches the page or the API without signing in. By default you sign in with a one-time code emailed to an address you've allowed.
- **The API also checks the Access token itself** (`lib/auth.js`): it verifies the token's signature, issuer, audience and expiry. If Access is ever misconfigured, the API refuses every request instead of serving data.
- **Each user only sees their own tasks.** Every query is filtered by the signed-in email.
- **Cross-site request forgery protection:** changes are only accepted as JSON from the site's own origin.
- **Strict security headers** (`public/_headers`): a Content Security Policy that only allows the site's own files, HSTS, no framing, `nosniff`, and no-referrer. User text is only ever written to the page as plain text, never as HTML.
- **Server-side validation** of every field, and parameterised SQL everywhere.

## Deploy with one command (recommended)

1. Create a Cloudflare API token (**My Profile → API Tokens → Create Token → Custom token**) with these **Account** permissions:
   - D1: Edit
   - Cloudflare Pages: Edit
   - Access: Apps and Policies: Edit
   - Access: Organizations, Identity Providers, and Groups: Edit
   - Account Settings: Read
2. Run:

```bash
npm install
CLOUDFLARE_API_TOKEN=<token> npm run setup -- you@example.com
# first time using Zero Trust on this account? add ACCESS_TEAM_NAME=<pick-a-name>
```

The script creates the D1 database and its tables, the Pages project, the Zero Trust login (one-time PIN emailed to you) and an Access application that only allows your email. It then writes the IDs into `wrangler.toml` and deploys the site. It's safe to re-run, and it reuses anything that already exists. Commit the updated `wrangler.toml` afterwards.

## Deploy manually (Cloudflare dashboard, about 15 minutes)

### 1. Create the database
1. Cloudflare dashboard → **Storage & Databases → D1 → Create database**. Name it `work-tracker`.
2. Open the database → **Console**, paste the contents of `migrations/0001_init.sql`, and run it.
3. Copy the **Database ID** into `wrangler.toml` as `database_id`, then commit the change. You can edit the file directly on GitHub.

### 2. Create the Pages site
1. **Workers & Pages → Create → Pages → Connect to Git** and pick this repository.
2. Framework preset: **None**. Leave the build command empty. Build output directory: `public`.
3. Deploy. Note your URL, e.g. `work-tracker-abc.pages.dev`.

   Until step 4 is done, the page loads but shows *"Cloudflare Access is not configured"*. That's expected: the API stays locked until Access is set up.

### 3. Lock it down with Cloudflare Access
1. Open **Zero Trust** from the dashboard. If it's your first time, choose a team name (this gives you `<team>.cloudflareaccess.com`) and pick the **Free** plan.
2. **Access → Applications → Add an application → Self-hosted.**
   - Add your hostname: `work-tracker-abc.pages.dev`. Also add `*.work-tracker-abc.pages.dev` so preview deployments are covered too. If you use a custom domain, add that as well.
   - Policy: **Allow**, Include → **Emails** → your email address.
   - Login methods: **One-time PIN** is enabled by default. You can add Google or GitHub login if you prefer.
3. Save, then open the application and copy its **Application Audience (AUD) Tag**.

### 4. Connect the app to Access
Edit `wrangler.toml`:

```toml
[vars]
ACCESS_TEAM_DOMAIN = "<team>.cloudflareaccess.com"
ACCESS_AUD = "<the AUD tag>"
ALLOWED_EMAILS = "you@example.com"   # optional second lock
```

Commit and push. Pages redeploys automatically. Visit your site, enter the code emailed to you, and you're in.

> Pages reads the D1 binding and variables from `wrangler.toml`, so you don't set them in the dashboard. None of these values are secrets.

## Deploy from the command line (alternative)

```bash
npm install
npx wrangler login
npm run db:create          # copy the printed database_id into wrangler.toml
npm run db:migrate         # creates the tables in the remote database
npm run deploy             # then do steps 3–4 above
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # sets DEV_AUTH_EMAIL, used only on localhost
npm run db:migrate:local
npm run dev                      # http://localhost:8788
```

`DEV_AUTH_EMAIL` only takes effect on `localhost` / `127.0.0.1`. `.dev.vars` is git-ignored and never deployed.

## Project layout

```
public/            static front end (index.html, app.css, app.js, _headers)
functions/api/     Pages Functions: /api/me, /api/tasks, /api/tasks/:id, /api/tasks/:id/updates
lib/               shared server code: auth, validation, queries
migrations/        D1 schema
```
