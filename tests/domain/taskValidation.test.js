import { describe, expect, it } from 'vitest';
import {
  MAX_SUBTASKS, validateSubtaskCreate, validateSubtaskPatch, validateTask, validateUpdate,
} from '../../src/domain/taskValidation.js';

describe('validateTask', () => {
  it('drops fields it does not know, so no client-supplied key can reach an UPDATE as a column name', () => {
    // changeStatements interpolates keys into SQL; this whitelist is what makes that safe.
    const { value } = validateTask({ title: 'T', user_id: 99, 'status = "done"; --': 1 });
    expect(Object.keys(value)).toEqual(['title']);
  });

  it('ignores a percentage progress field now that progress is tracked by subtasks', () => {
    expect(validateTask({ title: 'T', progress: 50 }).value).toEqual({ title: 'T' });
  });

  it('treats an empty target date as clearing the date', () => {
    expect(validateTask({ title: 'T', target_date: '' }).value.target_date).toBeNull();
  });

  it('refuses a calendar date that does not exist', () => {
    expect(validateTask({ title: 'T', target_date: '2026-02-30' }).error).toBe('Deadline must be YYYY-MM-DD');
  });

  it('accepts only the three states and the High flag', () => {
    expect(validateTask({ status: 'blocked', priority: 'high' }, { partial: true }).value).toEqual({ status: 'blocked', priority: 'high' });
    expect(validateTask({ status: 'in_progress' }, { partial: true }).error).toBe('Invalid status');
    expect(validateTask({ priority: 'urgent' }, { partial: true }).error).toBe('Invalid priority');
  });

  it('takes "chased" only as a real boolean', () => {
    expect(validateTask({ chased: true }, { partial: true }).value).toEqual({ chased: true });
    expect(validateTask({ chased: 'yes' }, { partial: true }).error).toBe('chased must be true or false');
  });

  it('takes a chase date and a plan date as dates or null', () => {
    expect(validateTask({ waiting_until: '2026-10-05', planned_on: null }, { partial: true }).value).toEqual({ waiting_until: '2026-10-05', planned_on: null });
    expect(validateTask({ planned_on: '' }, { partial: true }).value).toEqual({ planned_on: null });
    expect(validateTask({ waiting_until: '5 Oct' }, { partial: true }).error).toMatch(/YYYY-MM-DD/);
  });

  it('requires a title on create but not on a partial update', () => {
    expect(validateTask({}).error).toBe('Title is required');
    expect(validateTask({ status: 'done' }, { partial: true }).value).toEqual({ status: 'done' });
  });

  it('trims the title and refuses one that is only whitespace', () => {
    expect(validateTask({ title: '  Plan  ' }).value.title).toBe('Plan');
    expect(validateTask({ title: '   ' }).error).toBe('Title is required');
  });
});

describe('validateTask subtasks', () => {
  it('accepts plain titles or { title, target_date } on create, trimmed', () => {
    expect(validateTask({ title: 'T', subtasks: [' Draft ', { title: 'Review', target_date: '2026-10-20' }] }).value.subtasks)
      .toEqual([{ title: 'Draft', target_date: null }, { title: 'Review', target_date: '2026-10-20' }]);
  });

  it('refuses an impossible date on a subtask in a new task', () => {
    expect(validateTask({ title: 'T', subtasks: [{ title: 'x', target_date: '2026-13-01' }] }).error)
      .toBe('Step date must be YYYY-MM-DD');
  });

  it('refuses a blank subtask title rather than creating an empty row', () => {
    expect(validateTask({ title: 'T', subtasks: ['ok', '  '] }).error).toBe('Subtask is required');
  });

  it('refuses a subtasks value that is not a list', () => {
    expect(validateTask({ title: 'T', subtasks: 'Draft' }).error).toMatch(/Subtasks must be a list/);
  });

  it('caps how many subtasks one request can create', () => {
    expect(validateTask({ title: 'T', subtasks: Array.from({ length: MAX_SUBTASKS + 1 }, (_, i) => `s${i}`) }).error)
      .toMatch(/at most/);
  });

  it('does not accept subtasks on a partial update, where they would be silently ignored', () => {
    expect(validateTask({ subtasks: ['x'] }, { partial: true }).value).toEqual({});
  });
});

describe('validateSubtaskPatch', () => {
  it('reads done: false as a real change, not as "nothing sent"', () => {
    expect(validateSubtaskPatch({ done: false }).value).toEqual({ done: false });
  });

  it('refuses 0/1 and strings for done, so "false" can never mean true', () => {
    expect(validateSubtaskPatch({ done: 0 }).error).toBe('done must be true or false');
    expect(validateSubtaskPatch({ done: 'false' }).error).toBe('done must be true or false');
  });

  it('refuses a body that changes nothing', () => {
    expect(validateSubtaskPatch({}).error).toBe('Nothing to change');
  });

  it('reads target_date: null as "clear the date", which is a change', () => {
    expect(validateSubtaskPatch({ target_date: null }).value).toEqual({ target_date: null });
  });

  it('treats an empty date from the picker the same as null', () => {
    expect(validateSubtaskPatch({ target_date: '' }).value).toEqual({ target_date: null });
  });

  it('leaves the date out of the change when the key is missing', () => {
    // Renaming must not wipe a date the request never mentioned.
    expect(validateSubtaskPatch({ title: 'Renamed' }).value).toEqual({ title: 'Renamed' });
  });

  it('refuses a date that does not exist', () => {
    expect(validateSubtaskPatch({ target_date: '2026-02-30' }).error).toBe('Step date must be YYYY-MM-DD');
  });

  it('refuses renaming a subtask to blank', () => {
    expect(validateSubtaskPatch({ title: '   ' }).error).toBe('Subtask is required');
  });
});

describe('validateSubtaskCreate', () => {
  it('requires a title', () => {
    expect(validateSubtaskCreate({ title: null }).error).toBe('Subtask is required');
  });

  it('gives a subtask with no date an explicit null, not undefined', () => {
    expect(validateSubtaskCreate({ title: 'x' }).value).toEqual({ title: 'x', target_date: null });
  });
});

describe('validateUpdate', () => {
  it('reads a null status as "leave the status alone"', () => {
    expect(validateUpdate({ note: 'n', status: null }).value.status).toBeNull();
  });

  it('drops a percentage sent with an update', () => {
    expect(validateUpdate({ note: 'n', progress: 40 }).value).toEqual({ note: 'n', status: null });
  });

  it('requires a note', () => {
    expect(validateUpdate({ note: '  ' }).error).toBe('Update is required');
  });
});
