import Anthropic from '@anthropic-ai/sdk';
import { shapeSuggestion, validateAssistInput } from '../domain/assist.js';
import { AssistUnavailable, makeClient, requestSuggestion } from '../infra/assistClient.js';
import { take } from '../infra/assistUsageRepo.js';
import { json } from './respond.js';

export const isEnabled = (env) => Boolean(env.ANTHROPIC_API_KEY);

// Body: { title, description }. Nothing is saved: the page shows the suggestion and the
// person decides.
export async function suggest(request, env, user, { client } = {}) {
  if (!isEnabled(env)) return json({ error: "The assistant isn't set up yet" }, 503);
  const { value, error } = validateAssistInput(await request.json());
  if (error) return json({ error }, 400);

  const usage = await take(env, user.id);
  if (!usage.allowed) {
    const minutes = Math.max(1, Math.ceil(usage.retryAfterMs / 60000));
    return json({ error: `That's the limit for this hour. Try again in ${minutes} min.` }, 429, { 'Retry-After': String(Math.ceil(usage.retryAfterMs / 1000)) });
  }

  try {
    const raw = await requestSuggestion(client ?? makeClient(env), value);
    const suggestion = shapeSuggestion(raw, value);
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
