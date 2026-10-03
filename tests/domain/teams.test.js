import { describe, expect, it } from 'vitest';
import { planTaskChanges } from '../../src/domain/taskChanges.js';
import { validateTask } from '../../src/domain/taskValidation.js';
import { teamKey, validateTeamName } from '../../src/domain/teams.js';

describe('validateTeamName', () => {
  it('trims and squeezes spaces, and requires a name', () => {
    expect(validateTeamName('  Dev   Ops ').value).toBe('Dev Ops');
    expect(validateTeamName('  ').error).toBe('Team name is required');
  });
});

describe('teamKey', () => {
  it('matches the ways people type a team name in quick add', () => {
    expect(new Set(['Dev Ops', '#devops'.slice(1), 'dev_ops', 'Dev-Ops'].map(teamKey))).toEqual(new Set(['devops']));
  });
});

describe('team_id on a task', () => {
  it('accepts null as "no team", which is a real change from a team', () => {
    expect(validateTask({ team_id: null }, { partial: true }).value).toEqual({ team_id: null });
  });

  it('refuses ids that are not positive whole numbers, including 0 and "2"', () => {
    for (const v of [0, -1, 1.5, '2', true]) expect(validateTask({ team_id: v }, { partial: true }).error).toBe('Invalid team');
  });

  it('no longer accepts a free-text category', () => {
    expect(validateTask({ title: 'T', category: 'Leadership' }).value).toEqual({ title: 'T' });
  });

  it('logs a team change with names, and "none" for no team', () => {
    const names = { 1: 'Dev Ops', 3: 'GDS' };
    const plan = (from, to) => planTaskChanges({ status: 'todo', team_id: from }, { team_id: to }, 'now', { teamName: (id) => names[id] }).log;
    expect(plan(null, 1)).toEqual(['Team: none → Dev Ops']);
    expect(plan(1, 3)).toEqual(['Team: Dev Ops → GDS']);
    expect(plan(3, null)).toEqual(['Team: GDS → none']);
  });
});
