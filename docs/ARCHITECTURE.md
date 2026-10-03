# Architecture

**mills. Tasks** is a Cloudflare Worker (`src/index.js`) that serves both the API and the static pages in `public/`, backed by one D1 database. No framework, no build step. Authentication follows the login spec used in the mills. investments app; where this app departs from it, the difference is listed under [Departures from the spec](#departures-from-the-spec).

## Layout

```
src/index.js          fetch() wrapper + route(): the request gate, in order
src/http/             handlers: auth.js, tasks.js, admin.js, assist.js, push.js, teams.js, templates.js, respond.js
src/infra/            crypto.js, auth.js (sessions), usersRepo.js, tasksRepo.js, loginAttempts.js, assistClient.js, assistUsageRepo.js, …
src/domain/           pure rules: passwordPolicy, registration, taskValidation, taskChanges, assist (prompt + checks), …
public/               index.html + app.js (the app), login.html + login.js, app.css, icons
migrations/           D1 schema
tests/                Vitest unit tests (pure; fake DB; no network; no clock)
tests-e2e/            Playwright specs against a local Worker and a fresh local D1
```

## Login

- **Schema** (`migrations/0003_worker_auth.sql`): `users`, `sessions`, `invite_codes` exactly as in the spec, plus `login_attempts` for lockout. `0001` and `0002` are the earlier Pages-era schema. They were applied to production, so they stay exactly as they were, and `0003` replaces their (empty) tables. **Applied migrations are never edited**; changes go in a new numbered file.
- **Passwords:** PBKDF2-SHA256, 100,000 iterations, 256-bit output stored as hex, with a per-user 16-byte salt from `randomHex(16)`. Comparison is `timingSafeEqual`.
- **Sessions:** a `randomHex(32)` token lives only in the cookie. The table stores `SHA-256(token)`. `SESSION_DAYS = 30`, and expiry is checked in JavaScript after the row is fetched. Cookie: `session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`.
- **Registration:** the first user (empty `users` table) becomes admin with no code. Everyone after needs an unused invite code, which admins create from the user menu ("Invite someone").
- **Tasks are private:** every task query is scoped to the signed-in user's id.

## Tasks and subtasks

- A task has a status, priority, target date, category and a timeline of notes and automatic change lines.
- **Subtasks** (`migrations/0004_subtasks.sql`) are a checklist under a task, kept in the order they were added. They replace percentage progress. `tasks.progress` and `task_updates.progress` stay in the schema, because applied migrations are never edited, but nothing reads or writes them.
- On a saved task, each subtask change saves immediately. While a task is being created they are drafts, sent with the create as `subtasks: [titles]`.
- Ticking a subtask on a **To do** task moves it to **In progress**. A blocked or done task is left alone (`statusAfterSubtaskChange`). Ticking and un-ticking add "Completed: …" / "Reopened: …" lines to the timeline. Renaming doesn't.
- Marking a task done does not tick its subtasks: they stay an honest record.
- **Reminders** (`migrations/0007_reminders.sql`) are web push notifications. A Cron Trigger (`*/15 * * * *` in `wrangler.toml`) runs `runDigests` (`src/reminders.js`). It finds each user whose local digest time (default 07:45, in their own time zone) passed less than three hours ago and who has no digest yet today. It then sends what is overdue, what is due today (tasks and open subtasks) and, optionally, Urgent and High tasks due tomorrow (`collectDue`, `buildDigest`). A day with nothing due sends nothing but is still marked as handled. Messages are encrypted to RFC 8291 (aes128gcm) and signed with VAPID (RFC 8292) in `src/infra/webpush.js`, using Web Crypto only. Tests decrypt them with the reference `http_ece` library. The server only sends to Apple, Google, Mozilla and Microsoft push hosts (`isPushEndpoint`). A device the push service reports gone (404/410) is forgotten. The key pair is the secret `VAPID_PRIVATE_JWK`, created once by `scripts/ensure-vapid.mjs` in the deploy workflow and never rotated, because every subscription is tied to it. On iPhone and iPad, web push needs the app on the Home Screen (iOS 16.4 or later); the Reminders screen says so. `public/sw.js` shows the notification and opens the app when it is tapped; it is public so the browser can update it after a session ends.
- **Teams** (`migrations/0008_teams.sql`) replace free-text categories. They are shared across the app and seeded with Dev Ops, RDH and GDS; admins add, rename and remove them under name menu → Teams. A task (or template) has one team or none (the default). The migration moved each existing category that named a team (case and spaces ignored) onto it; the old `category` columns stay, unused, so nothing was lost. Removing a team moves its tasks and templates to "No team" in one batch. The team filter (`state.team`: all / none / an id, remembered per device) narrows the list, the board and the summary tiles. New tasks start on the team being filtered to. Team changes are logged on the timeline by name.
- **Quick add** (the + button and the `N` key) turns one line into a task with `parseQuickAdd` in `app.js`, a pure function that takes "today" as an argument. It picks out the first date (today, tomorrow, weekdays, next <weekday> = the one in next Monday-start week, next week, in N days/weeks/months, eow, eom, 12 Oct, Oct 12, 12/10 read as day/month), the first `!priority` (`!!!`/`!urgent`, `!!`/`!high`, `!med`, `!low`) and the first `#Team` (matched to a team's name ignoring case, spaces, `_` and `-`, so `#devops` finds Dev Ops; a `#word` naming no team stays in the title). Recognised words leave the title; anything it can't read stays in it. A live preview shows the reading before saving, and "Add details…" carries it into the full form.
- **Templates** (`migrations/0006_templates.sql`) copy a task's title, description, priority, category and subtasks. Each subtask's date is kept as `offset_days` from the task's target date (`dayOffset`; null when either date is missing, 0 when the same day). Starting a new task from a template creates draft subtasks that follow the target date as it is set (`shiftDate` / `placeDrafts` in `app.js`). A date picked by hand stops following.
- A subtask can have its own **target date** (`migrations/0005_subtask_dates.sql`). It shows as a chip coloured like task dates: red when overdue, amber when due within a week. In a PATCH, `target_date: null` (or `''`) clears the date; a missing key leaves it alone.
- **Task assistant** (the ✨ button beside a task's title) suggests a clearer, more concise title and description. The page shows yours and the suggestion side by side, with a one-line reason; **Replace** puts the suggestion in the form (nothing is saved until Save) and **Keep original** changes nothing. Only changed fields are shown; a task that already reads clearly says so. `POST /api/assist` (`src/http/assist.js`) makes one call to Claude Haiku 4.5 (`claude-haiku-4-5`, the fast, cheap model; no extended thinking) through the official `@anthropic-ai/sdk`, with a structured-output JSON schema. The prompt is `SYSTEM_PROMPT` in `src/domain/assist.js`: lead with a verb, about 60 characters, keep acronyms and names exactly, drop filler and urgency words (priority holds urgency), keep every fact, keep uncertainty as uncertainty, never write a description that wasn't there, leave clear text alone, British English. The task text is escaped inside `<task>` tags and treated as data. `shapeSuggestion` falls back to the original for any empty, oversized or unreadable field, so a bad reply can only mean "no change". **Subtasks** have their own ✨ (on each open subtask row and beside "Add a subtask"): `POST /api/assist/subtask` sends that subtask with its task title and the other subtasks, under `SUBTASK_PROMPT`: lead with a verb, about 50 characters, use the task to make a vague step specific but only with words already in the task or subtask, one step stays one step, keep uncertainty, leave clear wording alone. The suggestion opens in place under the row with Keep / Use; Use renames the subtask (saved at once, like any rename) or fills the add box. Both prompts get the live team names in the message (`<teams>`), not a fixed list in the prompt. Suggesting missing steps was considered and deliberately left out. **Progress updates** have a ✨ Tidy beside Post update: `POST /api/assist/update` sends the rough note with the task title under `UPDATE_PROMPT` (one to three sentences or a short list, what changed first, keep every fact and any doubt, add no next steps, owners, dates, causes or feelings). Yours and the tidied version show side by side under the box; Replace puts it in the box and nothing posts until Post update. Each user gets 30 calls an hour (task and subtask calls together) (`assist_usage`, `migrations/0009_assist.sql`), counted before the call. The API key is the Worker secret `ANTHROPIC_API_KEY`, copied from the GitHub secret of the same name on every deploy; it never reaches the browser, and `GET /api/auth/me` only reports `assistant: true/false` so the page knows whether to show the button. Each suggestion costs roughly £0.001–0.002. Task text is sent to Anthropic only when ✨ is tapped.
- **Today** is the home view (the default on a new device; the last view used is remembered). `planWeek` in `app.js` (pure, takes "today") puts open tasks, and open subtasks of open tasks, into Overdue, Today and Next 7 days by their own target dates, ordered by date, then priority, then the task before its subtasks. A subtask row shows its parent task, ticks off in place and opens the task when tapped. The team, priority and search filters apply; status chips and sort don't.
- **Board cards list their subtasks** (up to six, then "+N more") and can be ticked there. `GET /api/tasks` returns each task with its `subtasks` attached, using two queries in total rather than one per task (`attachSubtasks`).

| Route | Purpose |
| --- | --- |
| `GET /api/push/config`, `PUT /api/push/settings`, `POST/DELETE /api/push/subscriptions`, `POST /api/push/test` | Reminders: public key, settings and device count; settings; add/remove this device; send a test |
| `POST /api/assist/update` | `{ task_title, note }` → `{ text, reason, changed }`; same limits and errors |
| `POST /api/assist/subtask` | `{ task_title, title, others }` → `{ title, reason, changed }`; same limits and errors |
| `POST /api/assist` | `{ title, description }` → `{ title, description, reason, changed: { title, description } }`; 429 over 30 an hour, 503 when not set up or Claude is busy, 502 for an unusable reply |
| `GET /api/teams`; admin: `POST /api/admin/teams`, `PATCH/DELETE /api/admin/teams/:id` | Team list for everyone; add, rename, remove (admins only) |
| `GET/POST /api/templates`, `DELETE /api/templates/:id` | List; save a task as a template (`{ task_id, name }`); delete |
| `GET/POST /api/tasks` | List (with `subtask_total`, `subtask_done`), create |
| `GET/PATCH/DELETE /api/tasks/:id` | Detail is `{ task, updates, subtasks }` |
| `POST /api/tasks/:id/updates`, `DELETE …/updates/:uid` | Notes, optionally with a status change |
| `POST /api/tasks/:id/subtasks` | Add a subtask (`{ title, target_date? }`) |
| `PATCH/DELETE /api/tasks/:id/subtasks/:sid` | `{ title?, done?, target_date? }`. `done` must be a real boolean |

### Endpoints

Auth errors are plain text, rendered verbatim by the login page.

| Route | Status | Body |
| --- | --- | --- |
| `POST /api/auth/register` | 400 | All fields are required |
| | 400 | Passwords do not match |
| | 400 | Password must be at least 8 characters |
| | 400 | Invite code is required not first user |
| | 400 | Invalid or already-used invite code |
| | 409 | An account with that email already exists |
| | 201 | `{id, name, email, is_admin}` + `Set-Cookie` |
| `POST /api/auth/login` | 400 | email and password are required |
| | 401 | Invalid email or password |
| | 429 | Too many failed attempts. Try again in N minutes. |
| | 200 | `{id, name, email, is_admin}` + `Set-Cookie` |
| `POST /api/auth/logout` | 204 | Empty, cleared cookie |
| `GET /api/auth/me` | 200 / 401 | The session user, or `Unauthorized` |
| `POST /api/auth/password` | 204 / 400 | Change password; signs out other sessions |
| `GET/POST /api/admin/invites` | 200 / 201 / 403 | List or create invite codes (admins only) |
| any malformed JSON body | 400 | That request body wasn't valid JSON. |

The task API (`/api/tasks…`) answers errors as JSON `{ error }`.

### Request gate (`route()` in `src/index.js`)

The order is the security property.

0. **CSRF:** a non-GET under `/api/` must have no `Origin` or this site's, and POST/PUT/PATCH must be `application/json`.
1. **Public auth routes:** `register` and `login`, before any session lookup.
2. **Resolve the session** once, with `getSessionUser`.
3. **Session-optional routes:** `logout` tolerates no session; `me` returns 401 without one.
4. **Everything else under `/api/`:** 401 without a session; `/api/admin/` also needs `is_admin` (403).
5. **Page gate, default-deny:** only paths in `PUBLIC_PATHS` (the login page, its script, CSS and icons) are served without a session; everything else is a 302 to `/login`. A new page is protected from the moment it exists. A signed-in visit to `/login` goes to `/`.

`fetch()` wraps `route()`: a `SyntaxError` becomes the 400 above, anything else a logged 500, and every response gets the security headers (CSP `script-src 'self'`, HSTS, `X-Frame-Options: DENY`, nosniff, no-referrer).

Workers static assets redirect `/login.html` to `/login`. URL assertions expect the extension-less form; don't "fix" them back.

## Departures from the spec

Each closes a gap the spec lists as open.

| Spec gap | Here |
| --- | --- |
| No rate limiting or lockout | 5 failures per address or 30 per IP in 15 min lock sign-in for 15 min (`loginAttempts.js`) |
| `SameSite=Lax` is the only CSRF defence | Plus an `Origin` check and JSON-only bodies |
| No password change | `POST /api/auth/password`, from the user menu |
| Expired sessions never swept | Each new session deletes that user's expired rows |
| Unknown email answers faster | It hashes against a dummy salt, so both paths cost one PBKDF2 |
| Duplicate-email check before invite check | Invite check first; a stranger without a code can't confirm an address |
| No transaction around insert + mark-code-used | One `batch` (atomic in D1), with the gate re-checked inside the `INSERT … SELECT … WHERE` |
| `PROTECTED_PAGES` allowlist | Default-deny with a short public list |
| Inline `<script type="module">` on the login page | `public/login.js`, because the CSP allows only same-origin scripts |
| `style="display:none"` toggling | The `hidden` attribute, for the same CSP reason |
| No unit tests for auth | `tests/http/auth.test.js`, `tests/infra/*.test.js`, `tests/http/gate.test.js` |

## What is still absent

| Absent | Status |
| --- | --- |
| Password reset by email | Gap: there is no email sending. An admin can't reset another user's password either. |
| Session rotation on privilege change | Not needed: there is no way to become admin after registering |
| Revoking an unused invite code | Gap: codes stay valid until used |
| Email verification | Deliberate: invite-only |
| Shared tasks between users | Deliberate: a personal tracker |

## Testing

Two layers, both gating every deploy (`.github/workflows/deploy.yml`): `npm test`, then `npm run test:e2e`, then migrations, then `wrangler deploy`. A failure at either layer stops the deploy before any migration is applied.

### Vitest (`npm test`)

All pure: no database, no network, no clock. Anything that depends on "now" takes it as an argument.

- **Test names are statements about behaviour**, e.g. "asks a stranger for an invite code before saying whether their email is taken".
- **Comments say why the test exists**, meaning which bug it prevents.
- **Null is tested separately from zero.** `progress: null` means "leave alone" in an update and is refused on a task; `progress: 0` means zero.
- **Assert the real list**, e.g. the sorted ids or the batch's statements, not a count.
- **`tests/helpers/fakeDb.js`** matches a substring of the SQL and returns the declared answer. `bind()` returns a new statement each call, and `first()` returns `null` when nothing matches.
- **Code in `public/`** is tested by slicing it out of the real file between two anchor strings (`tests/helpers/slice.js`) and evaluating it. The helper throws if an anchor moves, rather than yielding an empty test.

### Playwright (`npm run test:e2e`)

Runs against `wrangler dev --local` and a freshly wiped local D1. It never uses `--remote` and needs no credentials. **`workers: 1`**, because the specs share one database.

`tests-e2e/helpers.js` signs in, or registers if sign-in fails. It waits on a real outcome (the redirect to `/`, or the error message appearing), never a fixed timeout, because sign-in is deliberately slow.

Specs, kept few:
- `critical-path.spec.js`: sign in, create a task with draft subtasks, tick one, post an update, complete, sign out, gate, wrong password, sign back in.
- `assistant.spec.js`: no button without a key; at iPhone 12 mini size, yours and the suggestion side by side, Escape closes only the sheet, Keep changes nothing, Replace fills the form and saves; the "already clear" answer; a subtask's in-place suggestion sends its task and siblings, and Use renames it and survives reopening; Tidy on an update, side by side, Replace fills the box and only Post update posts. The two calls that need a key are stubbed in the browser; the Worker-side call is unit-tested with the real SDK against a fake API.
- `subtasks.spec.js`: typing the next subtask while the last is still saving keeps what was typed (the add used to clear the box when the save returned).
- `today.spec.js`: overdue / today / next 7 days with a subtask listed under its own date, ticking it off for real, opening a task. The other specs switch to List in `signIn`, because the app opens on Today.
- `missing-data.spec.js`: the empty-account state, and a failed save showing its message (the bug class where `notify()` called itself and froze the page).

### Verification outside the suite

- Render pages in headless Chromium before shipping, at iPhone 12 mini (375×812) and iPad sizes (810×1080, 1000×695, 1194×834). Measure that nothing scrolls sideways, that the date field stays in its column, and that touch-screen fields use 16px text so Safari doesn't zoom. Then look at the screenshots. That pass caught the login page's stuck-together buttons and a three-line phone header. It also caught a subtask placeholder that reused the `.empty` class and became a tall dashed box, and long titles cut off on iPhone. The measurements had passed both of those.
- Run new SQL against a real local D1 (`wrangler d1 execute --local`). For `0003`, the production path was replayed: `0001`+`0002` with rows in the old tables, then `0003`, then a duplicate-email insert to prove the `UNIQUE` constraint refuses it.
- Grep that documentation landed before committing.
