# mills. Tasks

A clean, private tracker for your own tasks. Capture a task, give it a due date and steps, and keep a running log of what happens.

- **Three views.**
  - **Today** (the home screen): your plan for the day, what to chase, what's overdue, due today and due in the next 7 days, with each count in its heading. Steps show under their own dates.
  - **Tasks**: everything, filtered to Open, Waiting or Done, with a High-only toggle, a team filter and sorting. Done lists newest first, and search looks through every task.
  - **Review**: what you finished each week, your on-time rate, what's overdue or waiting, and a per-team breakdown.
- **Three states**: Open, Waiting (with a date to chase) and Done. A **High** flag marks what matters.
- **One-tap reschedule**: the clock on each row plans it for today, moves it to tomorrow or next week, marks it Waiting (chase in 2 days), or takes any date.
- **Daily plan**: tick what you'll work on today. From 5pm the button (and the 8pm reminder) plans tomorrow instead. Anything unfinished carries over.
- **Steps**: a checklist under each task, each with an optional due date. Shown as "2/5" on the row.
- **The task panel** saves as you go, with no Save button. It shows the title, notes, a one-line summary of the fields (tap it to edit), the steps, then the log. Duplicate and Delete sit in its ⋯ menu.
- **Log**: post notes as you go. Changes to state, due date, High, team and steps are logged automatically.
- **Reminders**: up to three a day on your phone (7:30am, 10am and 8pm by default). Each lists what's overdue, due today, to chase, and High tasks due tomorrow. The evening one lists everything due tomorrow and opens tomorrow's plan. It uses free web push; set it up from your name menu → Reminders.
- **Quick add**: type `Board deck fri !high #RDH` and it becomes a High task due Friday for RDH. A preview shows how it was read before saving.
- **Teams**: labels for tasks (Dev Ops, RDH, GDS, or none). Add one straight from a task's team picker or from name menu → Teams. A team filter narrows every view.
- **Repeats**: every week, 2 weeks, month, quarter or year, or N days after done. Marking one done brings the next one back with its steps.
- **Duplicate**: copies a task with its steps. Step dates follow the copy's due date.
- **✨ Tidy**:
  - On a task, one tap suggests clearer wording for the title, notes and open steps together, shown side by side with yours. Each changed step has its own tick, and nothing changes until you choose Replace.
  - On a log entry, it turns a rough note into a clear one before you post it.
  - It uses Claude Haiku: about 0.15p a suggestion, capped at 30 an hour.
- **Export**: everything you own as JSON or a spreadsheet (CSV), from the name menu.
- Light and dark mode. Laid out for iPhone and iPad as well as desktop, and can be added to the Home Screen.
- **Sign-in**:
  - **Face ID / Touch ID** with passkeys (name menu → Face ID & passkeys).
  - **Email and password** still work. The first account is the admin and can invite others; everyone's tasks are private.
- **Shortcuts**: `N` quick add, `/` search, `Esc` close, `Ctrl/⌘+Enter` post a log entry.

It runs as one Cloudflare Worker with a D1 database, all on the free tier. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how sign-in, the request gate and the tests work.

## Deploy

1. **Create a Cloudflare API token:** dash.cloudflare.com → **My Profile → API Tokens → Create Token → Create Custom Token**, with these **Account** permissions:
   - Workers Scripts: Edit
   - D1: Edit
   - Account Settings: Read
2. **Add it to GitHub** as a repository secret named `CLOUDFLARE_API_TOKEN` (**Settings → Secrets and variables → Actions**).
   - Optional, for the task assistant: add your Claude API key (console.anthropic.com → API keys) as a second secret named `ANTHROPIC_API_KEY`. Without it the ✨ button simply doesn't appear.
3. **Push to `main`, or re-run the workflow.** It runs the unit and end-to-end tests, creates the database if needed, applies migrations and deploys. The live address is shown in the run summary, e.g. `https://work-tracker.<you>.workers.dev`.
4. **Open the site and choose "Create an account" straight away.** The first account becomes the admin; nobody else can register without an invite code from you.

## Develop

```bash
npm install
npm run db:migrate:local
npm run dev          # http://localhost:8787
npm test             # unit tests
npm run test:e2e     # end-to-end tests (wipes the local database first)
```
