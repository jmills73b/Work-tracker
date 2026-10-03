import Anthropic from '@anthropic-ai/sdk';
import { shapeSubtaskSuggestion, shapeSuggestion, validateAssistInput, validateSubtaskInput } from '../domain/assist.js';
import { AssistUnavailable, makeClient, requestSubtaskSuggestion, requestSuggestion } from '../infra/assistClient.js';
import { take } from '../infra/assistUsageRepo.js';
import { listTeams } from '../infra/teamsRepo.js';
import { json } from './respond.js';

export const isEnabled = (env) => Boolean(env.ANTHROPIC_API_KEY);

// Body: { title, description }. Nothing is saved: the page shows the suggestion and the
// person decides.
export function suggest(request, env, user, options) {
  return run(request, env, user, options, validateAssistInput, requestSuggestion, shapeSuggestion);
}

// Body: { task_title, title, others }: one subtask, with its task and siblings as context.
export function suggestSubtask(request, env, user, options) {
  return run(request, env, user, options, validateSubtaskInput, requestSubtaskSuggestion, shapeSubtaskSuggestion);
}

// Check → count against the hourly allowance → one call → shape. Both kinds share the
// allowance and the error messages.
async function run(request, env, user, { client } = {}, validate, call, shape) {
  if (!isEnabled(env)) return json({ error: "The assistant isn't set up yet" }, 503);
  const { value, error } = validate(await request.json());
  if (error) return json({ error }, 400);

  const usage = await take(env, user.id);
  if (!usage.allowed) {
    const minutes = Math.max(1, Math.ceil(usage.retryAfterMs / 60000));
    return json({ error: `That's the limit for this hour. Try again in ${minutes} min.` }, 429, { 'Retry-After': String(Math.ceil(usage.retryAfterMs / 1000)) });
  }

  try {
    const teams = (await listTeams(env)).map((t) => t.name);
    const suggestion = shape(await call(client ?? makeClient(env), value, teams), value);
    if (!suggestion) throw new AssistUnavailable('unparseable reply');
    return json(suggestion);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      console.error('assistant: API key rejected', e.status);
      return json({ error: "The assistant's API key was rejected" }, 503);
    }
    if (e instanceof Anthropic.RateLimitError || (e instanceof Anthropic.APIError && e.status >= 500)) {
      return json({ error: 'The assistant is busy. Try again in a minute.' }, 503);
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return json({ error: "Couldn't reach the assistant. Try again." }, 503);
    }
    if (e instanceof Anthropic.APIError || e instanceof AssistUnavailable) {
      console.error('assistant:', e.status ?? '', e.message);
      return json({ error: "Couldn't get a suggestion this time. Try again." }, 502);
    }
    throw e;
  }
}
