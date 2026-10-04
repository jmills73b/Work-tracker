# Architecture

**mills. Tasks** is a Cloudflare Worker (`src/index.js`) that serves both the API and the static pages in `public/`, backed by one D1 database. No framework, no build step. Authentication follows the login spec used in the mills. investments app; where this app departs from it, the difference is listed under [Departures from the spec](#departures-from-the-spec).

## Layout

```
src/index.js          fetch() wrapper + route(): the request gate, in order
src/http/             handlers: auth.js, tasks.js, admin.js, assist.js, push.js, teams.js, export.js, respond.js
src/infra/            crypto.js, auth.js (sessions), usersRepo.js, tasksRepo.js, loginAttempts.js, assistClient.js, assistUsageRepo.js, …
src/domain/           pure rules: passwordPolicy, registration, taskValidation, taskChanges, assist (prompt + checks), …
public/               index.html, login.html + login.js, app.css, sw.js, passkeys.js, icons
public/shared/rules.js  the rules both sides share: states, the High flag, date checks and date arithmetic
public/app/           the page, as browser-native ES modules (no build step), loaded from main.js
migrations/           D1 schema
tests/                Vitest unit tests (pure; fake DB; no network; no clock)
tests-e2e/            Playwright specs against a local Worker and a fresh local D1
```

## Login

- **Schema** (`migrations/0003_worker_auth.sql`): `users`, `sessions`, `invite_codes` exactly as in the spec, plus `login_attempts` for lockout. `0001` and `0002` are the earlier Pages-era schema. They were applied to production, so they stay exactly as they were, and `0003` replaces their (empty) tables. **Applied migrations are never edited**; changes go in a new numbered file.
- **Passwords:** PBKDF2-SHA256, 100,000 iterations, 256-bit output stored as hex, with a per-user 16-byte salt from `randomHex(16)`. Comparison is `timingSafeEqual`.
- **Sessions:** a `randomHex(32)` token lives only in the cookie. The table stores `SHA-256(token)`. `SESSION_DAYS = 30`, and expiry is checked in JavaScript after the row is fetched. Cookie: `session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`.
- **Registration:** the first user (empty `users` table) becomes admin with no code. Everyone after needs an unused invite code, which admins create from the user menu ("Invite someone").
- **Passkeys (Face ID / Touch ID)** (`migrations/0011_passkeys.sql`, `src/http/passkeys.js`, `public/passkeys.js`): an addition to the spec, not a replacement; password sign-in is unchanged. Verification is `@simplewebauthn/server`; this code binds it to sessions, lockout and storage. The relying party is the site itself (RP ID = hostname, the only accepted origin = the site's origin, neither taken from the request body). Sign-in is usernameless (discoverable credentials, user verification required): `POST /api/auth/passkey/options` then `POST /api/auth/passkey/login`, both public and before the session lookup, both behind the CSRF check and the IP lockout; an unknown or failing passkey counts as a failed attempt; success creates the same session cookie as a password. Adding one (`POST /api/auth/passkeys/options` with the current password, under the same email lockout as changing it, then `POST /api/auth/passkeys`) needs the password so a borrowed session can't plant a lasting way in. Challenges are single-use (`DELETE … RETURNING`) and expire after 5 minutes; a registration challenge is bound to the user who asked. Stored: credential id, COSE public key, signature counter (the library rejects a counter that goes backwards), transports, a device name. The user handle is `mills-tasks-user-<id>`, not the email. Name menu → Face ID & passkeys lists, adds and removes them.
- **Tasks are private:** every task query is scoped to the signed-in user's id.

## The page (`public/app/`)

Plain ES modules the browser loads directly; `index.html` loads `main.js` with `type="module"`.

| Module | Holds |
| --- | --- |
| `main.js` | Wiring: binds the toolbar and keys, loads `/auth/me`, `/tasks` and `/teams`, opens the plan for `?plan=tomorrow` |
| `state.js` | The page's state, per-device preferences, and `app`: late-bound hooks so modules call each other without import cycles |
| `model.js` | Pure: what each view shows (`planWeek`, `planCandidates`, `filterTasks`, `duplicateDraft`, `computeInsights`). "Today" is an argument |
| `views.js` | Today, Tasks and Review; rows; the one-tap reschedule sheet |
| `panel.js` | The task panel: autosave, fields summary, steps, log, ⋯ menu |
| `assist.js`, `plan.js`, `quickadd.js`, `settings.js` | ✨ Tidy; the daily plan; quick add; the name menu and its dialogs |
| `parse.js`, `dates.js`, `api.js`, `dom.js` | Quick-add parser; date labels; fetch wrapper; DOM helpers |

`public/shared/rules.js` is imported by both the page and the Worker (`../../public/shared/rules.js`; wrangler bundles it), so the states, the High flag and date rules have one definition.

## Tasks and steps

- **States** (`migrations/0013_simplify.sql`): Open, Waiting and Done. The stored codes keep the original CHECK constraints: `todo` is Open, `blocked` is Waiting, `done` is Done. The migration folded `in_progress` into `todo`. Labels come from `STATUS` in `rules.js`, and the log still reads an old `in_progress` line as Open.
- **High flag**: `priority` is `high` or `medium` (Normal). The migration folded `urgent` into `high` and `low` into `medium`.
- **Waiting** has an optional chase date, `waiting_until`. Choosing Waiting (in the panel or from a row) defaults it to two days out. Leaving Waiting clears it, and the log records "Chase on …". When the date comes, the task leads Today under **To chase** and appears in reminders.
- **Daily plan**: `planned_on` is the day a task is planned for. The plan screen (`plan.js`) lists what's worth considering for a day (`planCandidates`: planned, due by then, to chase by then, or High and due within a week, planned first), each with a tick that saves at once. While the screen is open, the list keeps its order, so a tick never moves a row from under your finger. A planned task leads Today under **Today's plan** until it's done; an unfinished one carries over. From 17:00 the button plans tomorrow, and the evening reminder opens `/?plan=tomorrow`.
- **Steps** (`subtasks` in the schema, `migrations/0004_subtasks.sql`) are a checklist under a task, kept in the order they were added. They replace percentage progress; `tasks.progress` and `task_updates.progress` stay in the schema, unused.
  - On a saved task, each step change saves immediately. While a task is being created, steps are drafts sent with the create as `subtasks: [titles]`.
  - Ticking a step logs "Completed: …" and leaves the task's state alone. Marking a task done doesn't tick its steps either: they stay an honest record.
  - A step can have its own due date (`migrations/0005_subtask_dates.sql`), shown as a chip coloured like task dates. In a PATCH, `target_date: null` (or `''`) clears it; a missing key leaves it alone.
- **Autosave**: the panel has no Save button for a saved task.
  - Each field PATCHes on change.
  - The title and notes save 800 ms after typing stops, and at once on blur or close.
  - An empty title is put back.
  - Only a new task has a Create button, and only a new task asks before discarding.
- **Log** (`task_updates`): notes you post, plus automatic lines for changes to state, due date, High, team, repeat and steps. Posting a note never changes the task (`POST /api/tasks/:id/updates` ignores `status`).
- **Today** is the home view (the last view used is remembered per device). `planWeek` (pure) puts each open task in one group: Today's plan if `planned_on` ≤ today; else To chase if Waiting with `waiting_until` ≤ today; else Overdue, Due today or Next 7 days by due date. "Next 7 days" means 1 to 7 days ahead, and it is the only definition of "this week" in the app. Open steps are listed under their own dates, so a step due today shows even when its task is due next month. Each heading carries its count; the old summary tiles are gone. Each row has a ⏱ button for one-tap reschedule: add to or remove from today's plan, due tomorrow, due next week (the coming Monday), Waiting with a chase in 2 days (or "No longer waiting"), or pick a date.
- **Tasks** view: the Open / Waiting / Done chips, a High-only toggle and sort (due date or recently updated). Done lists newest first. A search looks through every task whatever the chip, done ones last. The team filter applies to every view.
- **Review** (`computeInsights`, pure, within the team filter) shows:
  - Done in the last 30 days.
  - On-time rate over tasks done in the last 90 days that had a due date.
  - Overdue now, and waiting now.
  - Done per Monday-start week for 12 weeks: a chart with a table view.
  - Per team: open, overdue, done (90 days) and on time.
  Nothing to measure shows "–", never 0%.
- **Duplicate** (⋯ menu) opens a new task pre-filled with the title, notes, High, team, repeat and steps (unticked). Each step's date is kept as an offset from the due date (`duplicateDraft`, `placeDrafts`), so the steps follow whatever due date the copy gets. Templates are retired; `templates` and `template_subtasks` stay in the schema, unused, so nothing saved was lost.
- **Teams** (`migrations/0008_teams.sql`) are shared labels, seeded with Dev Ops, RDH and GDS. Any signed-in user can add, rename and remove them, from name menu → Teams or "New team…" in a task's team picker (`/api/teams`). Each team's count is the signed-in user's own tasks. Removing a team moves its tasks to "No team" in one batch, and that affects everyone's tasks. That is acceptable for a personal tracker with few accounts; revisit if it becomes shared. The old free-text `category` columns stay in the schema, unused.
- **Quick add** (the + button and `N`) turns one line into a task with `parseQuickAdd` (`parse.js`, pure, takes "today"). It picks out:
  - The first date: today, tomorrow, weekdays, next <weekday>, next week, in N days/weeks/months, eow, eom, 12 Oct, 12/10 read as day/month.
  - The first `!high`. `!urgent`, `!!` and `!!!` also mean High; `!low`, `!med` and `!normal` mean Normal.
  - The first `#Team`, matched ignoring case, spaces, `_` and `-`. A `#word` naming no team stays in the title.
  A live preview shows how the line was read, and "Add details…" carries it into the full form.
- **Repeats** (`migrations/0010_recurrence.sql`, `src/domain/recurrence.js`): `recurrence` is null, `weekly:N` (1–4), `monthly:N` (1, 2, 3, 6, 12) or `after:N` (1–365 days after done). Marking one done creates the next occurrence in the same batch: the same task with its steps unticked and moved by as many days as the task moved.
  - Weekly and monthly count from the original due date and skip dates already past. `after:N` counts from the day it was done, in the person's time zone.
  - `next_task_id` on the done task means done → reopened → done makes only one.
- **Export** (`GET /api/export?format=json|csv`, `src/http/export.js`): everything the signed-in user owns, as a download.
  - **JSON**: teams, plus tasks with their steps and full log.
  - **CSV**: one row per task, in plain words. Every field is quoted, and a leading `= + - @` gets a `'` so a spreadsheet never runs it as a formula.
- **✨ Tidy**:
  - **On a task** (the button beside the title): `POST /api/assist` sends the title, notes and open steps together. `SYSTEM_PROMPT` in `src/domain/assist.js` sets the rules:
    - Lead with a verb; titles about 60 characters, steps about 50.
    - Keep acronyms and names exactly.
    - Drop filler and urgency words; the High flag holds urgency.
    - Keep every fact, and keep uncertainty as uncertainty.
    - Never write notes that weren't there.
    - Make a vague step specific only with words already in the task.
    - Exactly one step out for each step in, never added, merged or reordered.
    - Leave clear text alone. British English.
  - `shapeSuggestion` falls back to the original for any empty, oversized or unreadable field, and keeps every step if the count differs. A bad reply can only mean "no change".
  - The sheet shows yours and the suggestion side by side, with a tick per changed step. **Replace** fills the title and notes (which then autosave) and renames the ticked steps.
  - **On a log entry**: `POST /api/assist/update` tidies the rough note (`UPDATE_PROMPT`). The tidied version shows beside yours under the box, and nothing posts until Post.
  - Per-step ✨ buttons are gone, folded into the task-level Tidy. Suggesting missing steps was considered and deliberately left out.
  - The calls go to Claude Haiku 4.5 (`claude-haiku-4-5`) through `@anthropic-ai/sdk`, with a JSON-schema structured output. The task text is escaped inside `<task>` tags and treated as data, and the live team names go in the message.
  - Each user gets 30 calls an hour (`assist_usage`).
  - The key is the Worker secret `ANTHROPIC_API_KEY`, copied from the GitHub secret of the same name on every deploy. It never reaches the browser; `GET /api/auth/me` only reports `assistant: true/false`.
- **Reminders** are web push notifications (`migrations/0007_reminders.sql`, `0012_reminder_times.sql`). A Cron Trigger (`*/15 * * * *`) runs `runDigests` (`src/reminders.js`).
  - **Times**: up to three a day (`digest_times`, default 07:30, 10:00 and 20:00). Each run sends the latest time that passed less than three hours ago, once (`last_digest_slot`).
  - **Daytime digests**: what's overdue, due today (tasks and open steps), to chase, and High tasks due tomorrow (`collectDue`, `buildDigest`).
  - **From 17:00** a digest is an evening one: what's still due today plus everything due tomorrow. Tapping it opens `/?plan=tomorrow`.
  - A digest with nothing in it isn't sent. Every digest has the same tag, so it replaces the last one on the device.
  - The only setting is the times. The master switch and the "High tomorrow" switch are gone; 0013 set them on for everyone. Reminders are on or off per device.
  - **Delivery**: messages are encrypted to RFC 8291 (aes128gcm) and signed with VAPID (RFC 8292) in `src/infra/webpush.js`, using Web Crypto only. The server only sends to Apple, Google, Mozilla and Microsoft push hosts, and forgets a device the push service reports gone.
  - **Keys**: the key pair is the secret `VAPID_PRIVATE_JWK`, created once by `scripts/ensure-vapid.mjs`.
  - **iPhone and iPad**: web push needs the app on the Home Screen. `public/sw.js` shows the notification and opens the link when it is tapped.

| Route | Purpose |
| --- | --- |
| `GET/POST /api/tasks` | List (each with `subtask_total`, `subtask_done`, `subtasks`), create |
| `GET/PATCH/DELETE /api/tasks/:id` | Detail is `{ task, updates, subtasks }`; a PATCH that finishes a repeating task also returns `next_task` |
| `POST /api/tasks/:id/updates`, `DELETE …/updates/:uid` | Log a note; delete one |
| `POST /api/tasks/:id/subtasks` | Add a step (`{ title, target_date? }`) |
| `PATCH/DELETE /api/tasks/:id/subtasks/:sid` | `{ title?, done?, target_date? }`. `done` must be a real boolean |
| `GET/POST /api/teams`, `PATCH/DELETE /api/teams/:id` | Team labels: list, add, rename, remove (any signed-in user) |
| `GET /api/export?format=json\|csv` | Download everything you own |
| `POST /api/assist` | `{ title, description, steps[] }` → `{ title, description, steps, reason, changed: { title, description, steps[] } }`. Errors: 429 over 30 an hour; 503 when not set up or Claude is busy; 502 for an unusable reply |
| `POST /api/assist/update` | `{ task_title, note }` → `{ text, reason, changed }`; same limits and errors |
| `GET /api/push/config`, `PUT /api/push/settings`, `POST/DELETE /api/push/subscriptions`, `POST /api/push/test` | Reminders: public key, times and device count; times; add/remove this device; send a test |

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
- **Code in `public/`** is tested by importing the real modules (`public/app/model.js`, `parse.js`, `dates.js`, `api.js`, `public/shared/rules.js`). The view logic lives in pure functions there so it can be.

### Playwright (`npm run test:e2e`)

Runs against `wrangler dev --local` and a freshly wiped local D1. It never uses `--remote` and needs no credentials. **`workers: 1`**, because the specs share one database.

`tests-e2e/helpers.js` signs in, or registers if sign-in fails. It waits on a real outcome (the redirect to `/`, or the error message appearing), never a fixed timeout, because sign-in is deliberately slow.

Specs, kept few. `signIn` switches to the Tasks view, because the app opens on Today; pass `{ view: 'today' }` to stay.

| Spec | Proves |
| --- | --- |
| `critical-path.spec.js` | Create a High task with draft steps; tick a step (logged, state unchanged); give it a date; edit fields and the title with no Save button; post to the log; complete; sign out; the page gate; a wrong password; sign back in |
| `assistant.spec.js` | No button without a key. At iPhone 12 mini size: yours and the suggestion side by side; Escape closes only the sheet; Keep changes nothing; Replace fills and saves. The "already clear" answer. Tidy on steps: only open steps are sent, each change has a tick, only ticked ones are renamed, and they survive reopening; no ✨ on step rows. Tidy on a log entry. The calls that need a key are stubbed in the browser; the Worker side is unit-tested with the real SDK against a fake API |
| `plan.spec.js` | One-tap reschedule on Today (due tomorrow, add to today's plan, Waiting with a chase date, pick a date). To chase. `/?plan=tomorrow` opens the plan, cleans the URL, and a tick saves `planned_on` |
| `task-actions.spec.js` | Duplicate with steps; Waiting defaults a chase date and is logged; Delete from the ⋯ menu; export as CSV (a real download) and JSON |
| `teams.spec.js` | Add from the menu (duplicate refused); add inline from a task's picker; the filter narrows Tasks and Review and is remembered |
| `review.spec.js` | Done lists newest first; Review's tiles, chart, table and per-team breakdown |
| `today.spec.js` | Overdue / today / next 7 days with a step under its own date; ticking it off for real; opening a task |
| `recurring.spec.js` | A weekly task done comes back a week on, its step unticked, only once across reopen and re-finish; "days after done" counts from today |
| `subtasks.spec.js` | Typing the next step while the last is still saving keeps what was typed |
| `reminders.spec.js` | The times round trip (no switches left); the "not set up" state |
| `quick-add.spec.js` | Preview and saved task agree |
| `passkeys.spec.js` | A real WebAuthn ceremony against Chromium's virtual authenticator |
| `missing-data.spec.js` | The empty-account state; a failed save showing its message |

### Verification outside the suite

- Render pages in headless Chromium before shipping, at iPhone 12 mini (375×812) and iPad sizes (810×1080, 1000×695, 1194×834). Measure that nothing scrolls sideways, that the date field stays in its column, and that touch-screen fields use 16px text so Safari doesn't zoom. Then look at the screenshots. That pass caught the login page's stuck-together buttons and a three-line phone header. It also caught a subtask placeholder that reused the `.empty` class and became a tall dashed box, and long titles cut off on iPhone. The measurements had passed both of those.
- Run new SQL against a real local D1 (`wrangler d1 execute --local`). For `0003`, the production path was replayed: `0001`+`0002` with rows in the old tables, then `0003`, then a duplicate-email insert to prove the `UNIQUE` constraint refuses it.
- Grep that documentation landed before committing.
