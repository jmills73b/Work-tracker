import Anthropic from '@anthropic-ai/sdk';
import { ASSIST_MAX_TOKENS, ASSIST_MODEL, OUTPUT_SCHEMA, SYSTEM_PROMPT, userMessage } from '../domain/assist.js';

export class AssistUnavailable extends Error {}

export function makeClient(env, options = {}) {
  // One quick retry, and a short timeout: someone is waiting on the sheet.
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000, ...options });
}

// Returns the model's JSON text. Throws the SDK's own errors for API failures and
// AssistUnavailable when the reply can't be used.
export async function requestSuggestion(client, task) {
  const response = await client.messages.create({
    model: ASSIST_MODEL,
    max_tokens: ASSIST_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage(task) }],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  });
  if (response.stop_reason !== 'end_turn') throw new AssistUnavailable(`stop_reason ${response.stop_reason}`);
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new AssistUnavailable('no text block');
  return block.text;
}
