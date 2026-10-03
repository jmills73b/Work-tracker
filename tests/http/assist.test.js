import { describe, expect, it, vi } from 'vitest';
import { ASSIST_MAX_PER_WINDOW, ASSIST_MODEL, SUBTASK_PROMPT, SYSTEM_PROMPT, UPDATE_PROMPT } from '../../src/domain/assist.js';
import { suggest, suggestSubtask, suggestUpdate } from '../../src/http/assist.js';
import { me } from '../../src/http/auth.js';
import { makeClient } from '../../src/infra/assistClient.js';
import { route } from '../../src/index.js';
import { fakeDb, jsonRequest } from '../helpers/fakeDb.js';

const USER = { id: 7, name: 'J', email: 'j@example.test', is_admin: 0 };
const KEY = 'sk-ant-test-not-a-real-key';
const TASK = { title: 'need to sort out the RDH thing asap', description: '' };

// The real SDK, talking to a fake API: checks what we send as well as what we do with replies.
function apiReturning(status, body) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  return { fetchImpl, client: makeClient({ ANTHROPIC_API_KEY: KEY }, { fetch: fetchImpl, maxRetries: 0 }) };
}

const message = (text, stop_reason = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: ASSIST_MODEL, stop_reason,
  content: [{ type: 'text', text }], usage: { input_tokens: 900, output_tokens: 60 },
});

const TEAMS = { all: [['FROM teams', [{ id: 1, name: 'Dev Ops' }, { id: 2, name: 'RDH' }]]] };
const env = (db = fakeDb(TEAMS)) => ({ DB: db, ANTHROPIC_API_KEY: KEY });

describe('POST /api/assist', () => {
  it('asks the cheap model for JSON, with the key in a header and the task in the message', async () => {
    const { fetchImpl, client } = apiReturning(200, message(JSON.stringify({ title: 'Fix the RDH issue', description: '', reason: 'Leads with the action.' })));
    const res = await suggest(jsonRequest('/api/assist', TASK), env(), USER, { client });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: 'Fix the RDH issue', description: '', reason: 'Leads with the action.', changed: { title: true, description: false } });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect(new Headers(init.headers).get('x-api-key')).toBe(KEY);
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.messages).toEqual([{ role: 'user', content: '<teams>Dev Ops, RDH</teams>\n<task><title>need to sort out the RDH thing asap</title><description></description></task>' }]);
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body).not.toHaveProperty('thinking');
  });

  it('counts the call against the hourly allowance', async () => {
    const db = fakeDb();
    const { client } = apiReturning(200, message(JSON.stringify({ ...TASK, reason: '' })));
    await suggest(jsonRequest('/api/assist', TASK), env(db), USER, { client });
    const write = db.calls.find((c) => c.sql?.startsWith('INSERT INTO assist_usage'));
    expect(write.params.slice(0, 1).concat(write.params[2])).toEqual([7, 1]);
  });

  it('refuses once the hourly allowance is used, without calling the API', async () => {
    const db = fakeDb({ ...TEAMS, first: [['FROM assist_usage', { window_start: new Date().toISOString(), count: ASSIST_MAX_PER_WINDOW }]] });
    const { fetchImpl, client } = apiReturning(200, message('{}'));
    const res = await suggest(jsonRequest('/api/assist', TASK), env(db), USER, { client });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/limit for this hour/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses an empty title before spending anything', async () => {
    const db = fakeDb();
    const res = await suggest(jsonRequest('/api/assist', { title: ' ' }), env(db), USER, { client: {} });
    expect(res.status).toBe(400);
    expect(db.calls).toEqual([]);
  });

  it('is reported as not set up when there is no API key', async () => {
    const res = await suggest(jsonRequest('/api/assist', TASK), { DB: fakeDb() }, USER);
    expect([res.status, (await res.json()).error]).toEqual([503, "The assistant isn't set up yet"]);
  });

  it.each([
    [401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 503, "The assistant's API key was rejected"],
    [429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 503, 'The assistant is busy. Try again in a minute.'],
    [529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 503, 'The assistant is busy. Try again in a minute.'],
    [400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, 502, "Couldn't get a suggestion this time. Try again."],
  ])('turns an API %i into a plain message', async (status, body, ours, error) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = apiReturning(status, body);
    const res = await suggest(jsonRequest('/api/assist', TASK), env(), USER, { client });
    expect([res.status, (await res.json()).error]).toEqual([ours, error]);
  });

  it('treats a cut-off or unreadable reply as no suggestion', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const reply of [message('{"title": "Fi', 'max_tokens'), message('not json')]) {
      const { client } = apiReturning(200, reply);
      const res = await suggest(jsonRequest('/api/assist', TASK), env(), USER, { client });
      expect(res.status).toBe(502);
    }
  });

  it('is behind the session gate and the same-origin JSON check', async () => {
    const db = fakeDb();
    const anon = await route(new Request('https://t.test/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), env(db));
    expect(anon.status).toBe(401);
    const cross = await route(new Request('https://t.test/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' }, body: '{}' }), env(db));
    expect(cross.status).toBe(403);
  });
});

describe('POST /api/assist/subtask', () => {
  const SUB = { task_title: 'Fix RDH day-one access for new starters', title: 'ticket??', others: ['Ask Sarah about the AD group'] };

  it('sends the subtask prompt with its task and siblings, and returns the reworded step', async () => {
    const { fetchImpl, client } = apiReturning(200, message(JSON.stringify({ title: 'Raise a ticket for the RDH access issue', reason: 'Says what it is for.' })));
    const res = await suggestSubtask(jsonRequest('/api/assist/subtask', SUB), env(), USER, { client });
    expect(await res.json()).toEqual({ title: 'Raise a ticket for the RDH access issue', reason: 'Says what it is for.', changed: true });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.system).toBe(SUBTASK_PROMPT);
    expect(body.messages[0].content).toBe('<teams>Dev Ops, RDH</teams>\n<task>Fix RDH day-one access for new starters</task>\n<others><other>Ask Sarah about the AD group</other></others>\n<subtask>ticket??</subtask>');
    expect(body.output_config.format.schema.required).toEqual(['title', 'reason']);
  });

  it('shares the hourly allowance with the task assistant', async () => {
    const db = fakeDb({ ...TEAMS, first: [['FROM assist_usage', { window_start: new Date().toISOString(), count: ASSIST_MAX_PER_WINDOW }]] });
    const { fetchImpl, client } = apiReturning(200, message('{}'));
    const res = await suggestSubtask(jsonRequest('/api/assist/subtask', SUB), env(db), USER, { client });
    expect(res.status).toBe(429);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is routed behind the session gate', async () => {
    const res = await route(new Request('https://t.test/api/assist/subtask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), env());
    expect(res.status).toBe(401);
  });
});

describe('POST /api/assist/update', () => {
  it('sends the update prompt with the task title and the note, and returns the tidied text', async () => {
    const { fetchImpl, client } = apiReturning(200, message(JSON.stringify({ text: 'Spoke to Sarah; ticket raised.', reason: 'Tidied.' })));
    const res = await suggestUpdate(jsonRequest('/api/assist/update', { task_title: 'Fix RDH', note: 'spoke 2 sarah, raised ticket' }), env(), USER, { client });
    expect(await res.json()).toEqual({ text: 'Spoke to Sarah; ticket raised.', reason: 'Tidied.', changed: true });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect([body.model, body.system]).toEqual(['claude-haiku-4-5', UPDATE_PROMPT]);
    expect(body.messages[0].content).toBe('<teams>Dev Ops, RDH</teams>\n<task>Fix RDH</task>\n<note>spoke 2 sarah, raised ticket</note>');
  });

  it('is routed behind the session gate', async () => {
    const res = await route(new Request('https://t.test/api/assist/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), env());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('tells the page whether to offer the assistant, never the key itself', async () => {
    const on = await (await me(USER, { ANTHROPIC_API_KEY: KEY })).json();
    const off = await (await me(USER, {})).json();
    expect([on.assistant, off.assistant]).toEqual([true, false]);
    expect(JSON.stringify(on)).not.toContain(KEY);
  });
});
