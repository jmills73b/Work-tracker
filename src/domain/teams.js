export const TEAM_NAME_MAX = 40;

export function validateTeamName(name) {
  const v = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!v) return { error: 'Team name is required' };
  if (v.length > TEAM_NAME_MAX) return { error: `Team name must be at most ${TEAM_NAME_MAX} characters` };
  return { value: v };
}

// How a typed "#DevOps", "#dev_ops" or "#Dev-Ops" finds the team "Dev Ops".
export const teamKey = (name) => String(name).toLowerCase().replace(/[\s_-]+/g, '');
