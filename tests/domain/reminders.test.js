import { describe, expect, it } from 'vitest';
import { buildDigest, collectDue, digestDue, localNow, validateSettings } from '../../src/domain/reminders.js';

const london = (over = {}) => ({ enabled: true, digest_time: '07:45', time_zone: 'Europe/London', include_tomorrow: true, last_digest_date: null, ...over });

describe('localNow', () => {
  it('reads London summer time as UTC+1', () => {
    expect(localNow(new Date('2026-10-03T06:50:00Z'), 'Europe/London')).toEqual({ date: '2026-10-03', minutes: 7 * 60 + 50 });
  });

  it('reads London winter time as UTC after the clocks go back', () => {
    expect(localNow(new Date('2026-11-03T07:50:00Z'), 'Europe/London').minutes).toBe(7 * 60 + 50);
  });

  it('gives the local date, which can differ from the UTC date', () => {
    expect(localNow(new Date('2026-10-03T23:30:00Z'), 'Asia/Tokyo').date).toBe('2026-10-04');
  });
});

describe('digestDue', () => {
  it('is due once the local digest time has passed', () => {
    expect(digestDue(london(), new Date('2026-10-03T06:45:00Z'))).toBe('2026-10-03');
  });

  it('is not due a minute before the digest time', () => {
    expect(digestDue(london(), new Date('2026-10-03T06:44:00Z'))).toBeNull();
  });

  it('goes out at most once per local day', () => {
    expect(digestDue(london({ last_digest_date: '2026-10-03' }), new Date('2026-10-03T07:00:00Z'))).toBeNull();
  });

  it('skips a digest missed by three hours or more rather than sending it in the afternoon', () => {
    expect(digestDue(london(), new Date('2026-10-03T09:44:00Z'))).toBe('2026-10-03');
    expect(digestDue(london(), new Date('2026-10-03T09:45:00Z'))).toBeNull();
  });

  it('sends nothing when reminders are switched off', () => {
    expect(digestDue(london({ enabled: false }), new Date('2026-10-03T06:50:00Z'))).toBeNull();
  });
});

describe('collectDue', () => {
  const TODAY = '2026-10-03';
  const tasks = [
    { title: 'Contract', status: 'blocked', priority: 'urgent', target_date: '2026-10-01', subtasks: [
      { title: 'Redline', done: 1, target_date: '2026-09-30' },
      { title: 'CFO sign', done: 0, target_date: '2026-10-03' },
    ] },
    { title: 'Board deck', status: 'in_progress', priority: 'high', target_date: '2026-10-04', subtasks: [] },
    { title: 'Offsite', status: 'todo', priority: 'low', target_date: '2026-10-04', subtasks: [] },
    { title: 'Old report', status: 'done', priority: 'high', target_date: '2026-09-01', subtasks: [] },
    { title: 'Undated', status: 'todo', priority: 'urgent', target_date: null, subtasks: [] },
  ];

  it('collects overdue and due-today items from tasks and open subtasks, skipping done ones', () => {
    const due = collectDue(tasks, TODAY);
    expect(due.overdue.map((i) => [i.title, i.daysLate])).toEqual([['Contract', 2]]);
    expect(due.dueToday.map((i) => i.title)).toEqual(['CFO sign (Contract)']);
  });

  it('warns about tomorrow only for Urgent and High tasks', () => {
    expect(collectDue(tasks, TODAY).tomorrow.map((i) => i.title)).toEqual(['Board deck']);
  });

  it('leaves tomorrow out when that setting is off', () => {
    expect(collectDue(tasks, TODAY, { includeTomorrow: false }).tomorrow).toEqual([]);
  });
});

describe('buildDigest', () => {
  it('sends nothing on a day with nothing due', () => {
    expect(buildDigest({ overdue: [], dueToday: [], tomorrow: [] }, '2026-10-03')).toBeNull();
  });

  it('leads with the counts and lists the items, worst first', () => {
    const d = buildDigest({
      overdue: [{ title: 'Contract', daysLate: 2 }],
      dueToday: [{ title: 'CFO sign (Contract)' }],
      tomorrow: [{ title: 'Board deck' }],
    }, '2026-10-03');
    expect(d).toEqual({
      title: '1 overdue · 1 due today · 1 priority task due tomorrow',
      body: '• Contract, 2d overdue\n• CFO sign (Contract), today\n• Board deck, tomorrow',
      tag: 'digest-2026-10-03',
      url: '/',
    });
  });

  it('shows at most four lines and counts the rest', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ title: `T${i}` }));
    const lines = buildDigest({ overdue: [], dueToday: many, tomorrow: [] }, '2026-10-03').body.split('\n');
    expect(lines).toEqual(['• T0, today', '• T1, today', '• T2, today', '• T3, today', '+2 more']);
  });
});

describe('validateSettings', () => {
  it('keeps settings the request did not mention', () => {
    expect(validateSettings({ digest_time: '08:30' }).value).toMatchObject({ digest_time: '08:30', enabled: true, include_tomorrow: true });
  });

  it('reads enabled: false as a real change, and refuses 0/1', () => {
    expect(validateSettings({ enabled: false }).value.enabled).toBe(false);
    expect(validateSettings({ enabled: 0 }).error).toBe('enabled must be true or false');
  });

  it('refuses an impossible time and an unknown time zone', () => {
    expect(validateSettings({ digest_time: '24:00' }).error).toBe('Digest time must be HH:MM');
    expect(validateSettings({ time_zone: 'Mars/Olympus' }).error).toBe('Unknown time zone');
  });
});
