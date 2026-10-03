#!/usr/bin/env node
// Create or reset a user in the LOCAL dev database:  npm run user:local -- <username> <password>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkNewPassword, hashPassword } from '../lib/password.js';

const [username = '', password = ''] = process.argv.slice(2);
const pepper = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^AUTH_PEPPER=(.+)$/m)?.[1]?.trim();
if (!pepper) throw new Error('Set AUTH_PEPPER in .dev.vars first (see .dev.vars.example)');
if (!/^[a-z0-9._-]{3,64}$/i.test(username)) throw new Error('Username: 3-64 letters, numbers, dot, dash or underscore');
const problem = checkNewPassword(password);
if (problem) throw new Error(problem);

const hash = await hashPassword(password, pepper);
const now = new Date().toISOString();
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
const sql = `INSERT INTO users (id, username, password_hash, created_at, password_changed_at)
  VALUES (${q(crypto.randomUUID())}, ${q(username.toLowerCase())}, ${q(hash)}, ${q(now)}, ${q(now)})
  ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash, password_changed_at = excluded.password_changed_at;`;
execFileSync('npx', ['wrangler', 'd1', 'execute', 'work-tracker', '--local', '--command', sql], { stdio: 'inherit' });
console.log(`✔ Local user "${username.toLowerCase()}" ready`);
