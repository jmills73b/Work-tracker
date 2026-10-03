# Work Tracker

A clean, private tracker for your own tasks. Capture a task, set its priority, target date and progress, and keep a running log of progress updates.

- **List view** with priority stripes, status pills, progress bars, and overdue / due-soon highlighting
- **Board view**: drag cards between To do, In progress, Blocked and Done
- **Summary tiles** (Active, In progress, Due this week, Overdue, Done in the last 30 days). Click a tile to filter by it
- **Task drawer** for editing details and posting progress updates. Status, progress, priority and date changes are logged to the timeline automatically
- Search, priority filter, sorting, light/dark mode, works on mobile
- Username and password sign-in, sign out, and change password
- Shortcuts: `N` new task, `/` search, `Esc` close, `Ctrl/⌘+Enter` save or post

## Stack (all free tier)

| Piece | Cloudflare product | Free allowance |
| --- | --- | --- |
| Web app + API | Pages + Pages Functions | Unlimited static requests, 100k function requests/day |
| Database | D1 (SQLite) | 5 GB, 5M row reads/day |

No frameworks and no third-party scripts. The front end is plain HTML, CSS and JS in `public/`, and the API is in `functions/api/`.

## Security

- **Passwords are never stored.** Only a salted PBKDF2-SHA256 hash is kept. The password is first mixed with a secret "pepper" (`AUTH_PEPPER`, an encrypted Pages secret kept outside the database), so even a copy of the database can't be cracked offline.
- **Sessions:** a random 256-bit token sits in a cookie marked `__Host-`, `HttpOnly`, `Secure` and `SameSite=Strict`, so page scripts can't read it, it only travels over HTTPS, and other sites can't send it. The database stores only a hash of the token. Sessions end after 7 days of inactivity or 30 days in total. Changing your password signs out every other device.
- **Brute-force protection:** 5 wrong passwords for an account, or 30 from one internet address, locks sign-in for 15 minutes. Unknown usernames take as long to reject as wrong passwords, and give the same message.
- **Each user only sees their own tasks.** Every query is filtered by the signed-in user.
- **Cross-site request forgery protection:** besides the `SameSite=Strict` cookie, changes are only accepted as JSON from the site's own origin.
- **Strict security headers** (`public/_headers`): a Content Security Policy that only allows the site's own files, HSTS, no framing, `nosniff`, and no-referrer. User text is only ever written to the page as plain text, never as HTML.
- **Server-side validation** of every field, and parameterised SQL everywhere.
- **HTTPS and DDoS protection** come from Cloudflare.

## Deploy with GitHub Actions

Every push to `main` deploys the site automatically. The first run also creates everything on Cloudflare.

1. **Create a Cloudflare API token.** Go to **My Profile → API Tokens → Create Token → Create Custom Token** and add these **Account** permissions:
   - D1: Edit
   - Cloudflare Pages: Edit
   - Account Settings: Read
2. **Add three repository secrets** in GitHub under **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_API_TOKEN`: the token
   - `LOGIN_USERNAME`: the username you'll sign in with (3–64 letters, numbers, `.`, `-` or `_`)
   - `LOGIN_PASSWORD`: your password, at least 10 characters
3. **Run the workflow:** go to **Actions → Deploy to Cloudflare → Run workflow**.

The workflow runs `scripts/setup-cloudflare.mjs`. That script creates the D1 database and tables, the Pages project, the `AUTH_PEPPER` secret and your account, then deploys. It's safe to re-run. After the first run, your password is left alone, so changes you make in the app stick.

**Forgot your password?** Update the `LOGIN_PASSWORD` secret (and `LOGIN_USERNAME` if you like), then run the workflow with **Reset password** ticked. This also signs out every device.

You can also run the script from your own computer:
`CLOUDFLARE_API_TOKEN=… LOGIN_USERNAME=… LOGIN_PASSWORD=… npm run setup`

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars            # local-only AUTH_PEPPER
npm run db:migrate:local
npm run user:local -- myname 'a long password'
npm run dev                               # http://localhost:8788
```

## Project layout

```
public/            static front end (index.html, app.css, app.js, _headers)
functions/api/     Pages Functions: auth/login, auth/logout, auth/password, me, tasks, tasks/:id, tasks/:id/updates
lib/               shared server code: passwords, sessions, lockout, validation, queries
migrations/        D1 schema
scripts/           Cloudflare setup and local user helper
```
