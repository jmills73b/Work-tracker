import { buildDigest, collectDue, digestDue } from './domain/reminders.js';
import { deliver } from './http/push.js';
import * as repo from './infra/remindersRepo.js';
import { listTasks } from './infra/tasksRepo.js';

// Runs from the Cron Trigger every 15 minutes: for each user whose local digest time has
// just passed, send what is overdue, due today and (optionally) urgent tomorrow.
export async function runDigests(env, now = new Date(), { fetchImpl } = {}) {
  const results = [];
  for (const { userId, settings } of await repo.usersToRemind(env)) {
    const localDate = digestDue(settings, now);
    if (!localDate) continue;
    try {
      const digest = buildDigest(collectDue(await listTasks(env, userId), localDate, { includeTomorrow: settings.include_tomorrow }), localDate);
      const outcome = digest ? await deliver(env, userId, digest, { fetchImpl }) : { sent: 0, failed: 0, quiet: true };
      // Marked even on a quiet day, so the same morning isn't reconsidered every 15 minutes.
      await repo.markDigestSent(env, userId, localDate);
      results.push({ userId, ...outcome });
    } catch (e) {
      console.error('digest failed for user', userId, e);
    }
  }
  return results;
}
