import { describe, expect, it } from 'vitest';
import { buildDigest, collectDue, digestDue, isEvening, localNow, parseTimes, validateSettings } from '../../src/domain/reminders.js';

const london = (over = {}) => ({ enabled: true, digest_times: ['07:30', '10:00', '20:00'], time_zone: 'Europe/London', include_tomorrow: true, last_digest_slot: null, ...over });

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
  // London is UTC+1 in October: 07:30 local is 06:30Z.
  it('is due once a reminder time has passed, naming that slot', () => {
    expect(digestDue(london(), new Date('2026-10-03T06:30:00Z'))).toEqual({ date: '2026-10-03', time: '07:30', slot: '2026-10-03 07:30' });
  });

  it('is not due a minute before', () => {
    expect(digestDue(london(), new Date('2026-10-03T06:29:00Z'))).toBeNull();
  });

  it('sends each time once: after 07:30 is handled, the next is 10:00', () => {
    const sent = london({ last_digest_slot: '2026-10-03 07:30' });
    expect(digestDue(sent, new Date('2026-10-03T06:45:00Z'))).toBeNull();
    expect(digestDue(sent, new Date('2026-10-03T09:00:00Z'))).toMatchObject({ time: '10:00' });
  });

  it('sends only the latest when two have passed (07:30 missed, now 10:05)', () => {
    expect(digestDue(london(), new Date('2026-10-03T09:05:00Z'))).toMatchObject({ time: '10:00' });
    // And 07:30 isn't sent afterwards.
    expect(digestDue(london({ last_digest_slot: '2026-10-03 10:00' }), new Date('2026-10-03T09:10:00Z'))).toBeNull();
  });

  it('sends the evening one, and starts afresh the next day', () => {
    expect(digestDue(london({ last_digest_slot: '2026-10-03 10:00' }), new Date('2026-10-03T19:00:00Z'))).toMatchObject({ time: '20:00' });
    expect(digestDue(london({ last_digest_slot: '2026-10-03 20:00' }), new Date('2026-10-04T06:31:00Z'))).toMatchObject({ slot: '2026-10-04 07:30' });
  });

  it('skips a time missed by three hours or more', () => {
    const one = london({ digest_times: ['07:30'] });
    expect(digestDue(one, new Date('2026-10-03T09:29:00Z'))).toMatchObject({ time: '07:30' });
    expect(digestDue(one, new Date('2026-10-03T09:30:00Z'))).toBeNull();
  });

  it('sends nothing when reminders are switched off', () => {
    expect(digestDue(london({ enabled: false }), new Date('2026-10-03T06:50:00Z'))).toBeNull();
  });

  it('treats 17:00 onwards as the evening', () => {
    expect([isEvening('16:59'), isEvening('17:00'), isEvening('20:00')]).toEqual([false, true, true]);
  });
});

describe('parseTimes', () => {
  it('reads the stored list, sorted and capped at three, falling back to the defaults', () => {
    expect(parseTimes('20:00,07:30')).toEqual(['07:30', '20:00']);
    expect(parseTimes('08:00')).toEqual(['08:00']);
    expect(parseTimes('')).toEqual(['07:30', '10:00', '20:00']);
    expect(parseTimes('junk')).toEqual(['07:30', '10:00', '20:00']);
  });
});

describe('collectDue', () => {
  const TODAY = '2026-10-03';
  const tasks = [
    { title: 'Contract', status: 'blocked', priority: 'high', target_date: '2026-10-01', planned_on: '2026-10-03', subtasks: [
      { title: 'Redline', done: 1, target_date: '2026-09-30' },
      { title: 'CFO sign', done: 0, target_date: '2026-10-03' },
    ] },
    { title: 'Board deck', status: 'todo', priority: 'high', target_date: '2026-10-04', subtasks: [] },
    { title: 'Offsite', status: 'todo', priority: 'medium', target_date: '2026-10-04', subtasks: [] },
    { title: 'Old report', status: 'done', priority: 'high', target_date: '2026-09-01', subtasks: [] },
    { title: 'Undated', status: 'todo', priority: 'high', target_date: null, subtasks: [] },
    { title: 'Supplier reply', status: 'blocked', priority: 'medium', target_date: null, planned_on: '2026-10-05', subtasks: [] },
  ];

  it('collects overdue and due-today items from tasks and open subtasks, skipping done ones', () => {
    const due = collectDue(tasks, TODAY);
    expect(due.overdue.map((i) => [i.title, i.daysLate])).toEqual([['Contract', 2]]);
    expect(due.dueToday.map((i) => i.title)).toEqual(['CFO sign (Contract)']);
  });

  it('lists Waiting tasks whose chase date has come, and not ones still to come', () => {
    expect(collectDue(tasks, TODAY).chase.map((i) => i.title)).toEqual(['Contract']);
  });

  it('follows a task\'s when: planned today counts as today; moved later keeps quiet, deadline or not', () => {
    const due = collectDue([
      { title: 'Planned', status: 'todo', priority: 'medium', target_date: null, planned_on: '2026-10-02', subtasks: [] },
      { title: 'Snoozed', status: 'todo', priority: 'medium', target_date: '2026-10-01', planned_on: '2026-10-08', subtasks: [] },
      { title: 'Late but planned', status: 'todo', priority: 'medium', target_date: '2026-10-01', planned_on: '2026-10-03', subtasks: [] },
      { title: 'Old chase', status: 'blocked', priority: 'medium', target_date: null, waiting_until: '2026-10-02', subtasks: [] },
    ], TODAY);
    expect(due.dueToday.map((i) => i.title)).toEqual(['Planned']);
    expect(due.overdue.map((i) => i.title)).toEqual(['Late but planned']);
    expect(due.chase.map((i) => i.title)).toEqual(['Old chase']); // from before 0014
  });

  it('warns about tomorrow only for High tasks', () => {
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
      chase: [{ title: 'Supplier reply' }],
    }, '2026-10-03');
    expect(d).toEqual({
      title: '1 overdue · 1 due today · 1 High task due tomorrow · 1 to chase',
      body: '• Contract, 2d overdue\n• CFO sign (Contract), today\n• Chase: Supplier reply\n• Board deck, tomorrow',
      tag: 'digest-2026-10-03',
      url: '/',
    });
  });

  it('in the evening, opens the plan for tomorrow when tapped', () => {
    const d = buildDigest({ overdue: [], dueToday: [], tomorrow: [{ title: 'A' }, { title: 'B' }] }, '2026-10-03', { evening: true });
    expect(d.title).toBe('2 due tomorrow');
    expect(d.url).toBe('/?plan=tomorrow');
  });

  it('sends a digest for chasing alone', () => {
    expect(buildDigest({ overdue: [], dueToday: [], tomorrow: [], chase: [{ title: 'X' }] }, '2026-10-03').title).toBe('1 to chase');
  });

  it('shows at most four lines and counts the rest', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ title: `T${i}` }));
    const lines = buildDigest({ overdue: [], dueToday: many, tomorrow: [] }, '2026-10-03').body.split('\n');
    expect(lines).toEqual(['• T0, today', '• T1, today', '• T2, today', '• T3, today', '+2 more']);
  });
});

describe('validateSettings', () => {
  it('keeps settings the request did not mention', () => {
    expect(validateSettings({ digest_times: ['20:00', '08:30', '08:30'] }).value).toMatchObject({ digest_times: ['08:30', '20:00'], enabled: true, include_tomorrow: true });
  });

  it('reads enabled: false as a real change, and refuses 0/1', () => {
    expect(validateSettings({ enabled: false }).value.enabled).toBe(false);
    expect(validateSettings({ enabled: 0 }).error).toBe('enabled must be true or false');
  });

  it('refuses an impossible time and an unknown time zone', () => {
    for (const bad of [['24:00'], [], ['07:00', '08:00', '09:00', '10:00'], '07:30']) {
      expect(validateSettings({ digest_times: bad }).error).toBe('Choose between 1 and 3 reminder times (HH:MM)');
    }
    expect(validateSettings({ time_zone: 'Mars/Olympus' }).error).toBe('Unknown time zone');
  });
});

describe('the evening digest', () => {
  const TODAY = '2026-10-03';
  const tasks = [
    { title: 'Still today', status: 'todo', priority: 'low', target_date: '2026-10-03' },
    { title: 'Low tomorrow', status: 'todo', priority: 'low', target_date: '2026-10-04', subtasks: [{ title: 'Step', done: 0, target_date: '2026-10-04' }] },
  ];

  it('lists everything due tomorrow, subtasks and low priority included', () => {
    const due = collectDue(tasks, TODAY, { allTomorrow: true });
    expect(due.tomorrow.map((i) => i.title)).toEqual(['Low tomorrow', 'Step (Low tomorrow)']);
    expect(collectDue(tasks, TODAY).tomorrow).toEqual([]);
  });

  it('says "still due today" and counts tomorrow plainly', () => {
    const d = buildDigest(collectDue(tasks, TODAY, { allTomorrow: true }), TODAY, { evening: true });
    expect(d.title).toBe('1 still due today · 2 due tomorrow');
  });
});
