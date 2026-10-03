import Anthropic from '@anthropic-ai/sdk';
import {
  ASSIST_MAX_TOKENS, ASSIST_MODEL, OUTPUT_SCHEMA, SUBTASK_PROMPT, SUBTASK_SCHEMA, subtaskMessage, SYSTEM_PROMPT, UPDATE_PROMPT,
  UPDATE_SCHEMA, updateMessage, userMessage,
} from '../domain/assist.js';

export class AssistUnavailable extends Error {}

export function makeClient(env, options = {}) {
  // One quick retry, and a short timeout: someone is waiting on the sheet.
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000, ...options });
}

// Returns the model's JSON text. Throws the SDK's own errors for API failures and
// AssistUnavailable when the reply can't be used.
async function ask(client, system, content, schema) {
  const response = await client.messages.create({
    model: ASSIST_MODEL,
    max_tokens: ASSIST_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema } },
  });
  if (response.stop_reason !== 'end_turn') throw new AssistUnavailable(`stop_reason ${response.stop_reason}`);
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new AssistUnavailable('no text block');
  return block.text;
}

export const requestSuggestion = (client, task, teams) => ask(client, SYSTEM_PROMPT, userMessage(task, teams), OUTPUT_SCHEMA);

export const requestSubtaskSuggestion = (client, subtask, teams) => ask(client, SUBTASK_PROMPT, subtaskMessage(subtask, teams), SUBTASK_SCHEMA);

export const requestUpdateSuggestion = (client, update, teams) => ask(client, UPDATE_PROMPT, updateMessage(update, teams), UPDATE_SCHEMA);
