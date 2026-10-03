# mills. Tasks

A clean, private tracker for your own tasks. Capture a task, set its priority and target date, break it into subtasks, and keep a running log of updates.

- **Today**: the home screen. What's overdue, due today and due in the next 7 days, with subtasks listed under their own dates
- **List view** with priority stripes, status pills, and overdue / due-soon highlighting
- **Board view**: drag cards between To do, In progress, Blocked and Done
- **Summary tiles** (Active, In progress, Due this week, Overdue, Done in the last 30 days). Click a tile to filter by it
- **Subtasks**: a checklist under each task, each with an optional due date. Shown as "2/5" in the list, and listed on board cards where they can be ticked off
- **Reminders**: a morning digest on your phone of what's overdue and due today (plus Urgent and High tasks due tomorrow). Free web push, set up from your name menu → Reminders
- **Quick add**: type `Board deck fri !high #RDH` and it becomes a High task due Friday for RDH, with a preview before saving
- **Teams**: each task can belong to a team (Dev Ops, RDH, GDS, or none), with a team filter on the list and board; admins manage the team list
- **Templates**: save any task as a template, then start new tasks from it with the subtask dates laid out again
- **Task assistant**: tap ✨ beside a title for a clearer, more concise wording of the title and description, shown side by side with yours. Replace or keep the original. Each subtask has its own ✨ too, which rewords that one step using the task for context. **Tidy** turns a rough progress note into a clear update before you post it. Uses Claude Haiku (about 0.15p a suggestion, capped at 30 an hour)
- **Task drawer** for editing and posting updates. Status, priority, date and subtask changes are logged automatically
- Search, filters, sorting, light/dark mode. Laid out for iPhone and iPad as well as desktop, and can be added to the Home Screen
- Email and password sign-in. The first account is the admin and can invite others; everyone's tasks are private
- Shortcuts: `N` quick add, `/` search, `Esc` close, `Ctrl/⌘+Enter` save or post

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
