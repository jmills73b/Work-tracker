import { describe, expect, it } from 'vitest';
import { validateTask, validateUpdate } from '../../src/domain/taskValidation.js';

describe('validateTask', () => {
  it('drops fields it does not know, so no client-supplied key can reach an UPDATE as a column name', () => {
    // changeStatements interpolates keys into SQL; this whitelist is what makes that safe.
    const { value } = validateTask({ title: 'T', user_id: 99, 'status = "done"; --': 1 });
    expect(Object.keys(value)).toEqual(['title']);
  });

  it('accepts progress of zero', () => {
    expect(validateTask({ title: 'T', progress: 0 }).value.progress).toBe(0);
  });

  it('refuses null progress rather than storing it as zero', () => {
    // Number(null) === 0; a null that slipped through would silently reset progress.
    expect(validateTask({ title: 'T', progress: null }).error).toMatch(/Progress/);
  });

  it('refuses fractional and out-of-range progress', () => {
    expect(validateTask({ title: 'T', progress: 50.5 }).error).toMatch(/Progress/);
    expect(validateTask({ title: 'T', progress: 101 }).error).toMatch(/Progress/);
    expect(validateTask({ title: 'T', progress: -1 }).error).toMatch(/Progress/);
  });

  it('treats an empty target date as clearing the date', () => {
    expect(validateTask({ title: 'T', target_date: '' }).value.target_date).toBeNull();
  });

  it('refuses a calendar date that does not exist', () => {
    expect(validateTask({ title: 'T', target_date: '2026-02-30' }).error).toBe('Target date must be YYYY-MM-DD');
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

describe('validateUpdate', () => {
  it('reads null progress as "leave progress alone"', () => {
    expect(validateUpdate({ note: 'n', progress: null }).value.progress).toBeNull();
  });

  it('reads zero progress as "set progress to zero", not as "leave it alone"', () => {
    expect(validateUpdate({ note: 'n', progress: 0 }).value.progress).toBe(0);
  });

  it('requires a note', () => {
    expect(validateUpdate({ note: '  ' }).error).toBe('Update is required');
  });
});
