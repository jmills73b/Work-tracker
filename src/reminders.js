import { buildDigest, collectDue, digestDue, isEvening } from './domain/reminders.js';
import { deliver } from './http/push.js';
import * as repo from './infra/remindersRepo.js';
import { listTasks } from './infra/tasksRepo.js';

// Runs from the Cron Trigger every 15 minutes: for each user one of whose reminder times
// has just passed, send what is overdue, due today and (optionally) urgent tomorrow; in
// the evening, everything due tomorrow too.
export async function runDigests(env, now = new Date(), { fetchImpl } = {}) {
  const results = [];
  for (const { userId, settings } of await repo.usersToRemind(env)) {
    const due = digestDue(settings, now);
    if (!due) continue;
    try {
      const evening = isEvening(due.time);
      const items = collectDue(await listTasks(env, userId), due.date, { includeTomorrow: settings.include_tomorrow, allTomorrow: evening });
      const digest = buildDigest(items, due.date, { evening });
      const outcome = digest ? await deliver(env, userId, digest, { fetchImpl }) : { sent: 0, failed: 0, quiet: true };
      // Marked even when quiet, so the same time isn't reconsidered every 15 minutes.
      await repo.markDigestSent(env, userId, due.slot);
      results.push({ userId, ...outcome });
    } catch (e) {
      console.error('digest failed for user', userId, e);
    }
  }
  return results;
}
