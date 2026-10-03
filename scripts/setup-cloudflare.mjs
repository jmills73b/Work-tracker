#!/usr/bin/env node
// One-command Cloudflare setup: D1 database + tables, Pages project, your login account,
// then deploys the site. Safe to re-run: it reuses anything that already exists and only
// touches the password on first run or when RESET_PASSWORD=true.
//
//   CLOUDFLARE_API_TOKEN=... LOGIN_USERNAME=... LOGIN_PASSWORD=... npm run setup
//
// Optional env: CLOUDFLARE_ACCOUNT_ID (auto-detected if the token sees one account),
// RESET_PASSWORD=true, PAGES_PROJECT (default "work-tracker").

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkNewPassword, hashPassword } from '../lib/password.js';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const USERNAME = String(process.env.LOGIN_USERNAME || '').trim().toLowerCase();
const PASSWORD = String(process.env.LOGIN_PASSWORD || '');
const RESET = process.env.RESET_PASSWORD === 'true';
const PROJECT = process.env.PAGES_PROJECT || 'work-tracker';
const DB_NAME = 'work-tracker';
const TOML = new URL('../wrangler.toml', import.meta.url);

const step = (msg) => console.log(`\n▸ ${msg}`);
const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};

if (!TOKEN) fail('CLOUDFLARE_API_TOKEN is not set.');

async function api(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const err = new Error(`${method} ${path.replace(/\/accounts\/[^/]+/, '/accounts/…')} → HTTP ${res.status} ${JSON.stringify(data.errors || data)}`);
    err.status = res.status;
    throw err;
  }
  return data.result;
}

let ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;

function wrangler(args, { input } = {}) {
  execFileSync('npx', ['--yes', 'wrangler', ...args], {
    input,
    stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
  });
}

// ---------- Account ----------
step('Checking API token');
await api('GET', '/user/tokens/verify');
if (!ACCOUNT) {
  const accounts = await api('GET', '/accounts?per_page=50');
  if (accounts.length !== 1) fail(`Token can see ${accounts.length} accounts; set CLOUDFLARE_ACCOUNT_ID to choose one.`);
  ACCOUNT = accounts[0].id;
}
const A = `/accounts/${ACCOUNT}`;

// ---------- D1 ----------
step('D1 database');
let db = (await api('GET', `${A}/d1/database?name=${DB_NAME}`)).find((d) => d.name === DB_NAME);
if (!db) {
  db = await api('POST', `${A}/d1/database`, { name: DB_NAME });
  console.log('  created');
} else {
  console.log('  exists');
}
const toml = readFileSync(TOML, 'utf8');
writeFileSync(TOML, toml.replace(/^database_id = ".*?"/m, `database_id = "${db.uuid}"`));
wrangler(['d1', 'migrations', 'apply', DB_NAME, '--remote']);

const query = async (sql, params = []) => (await api('POST', `${A}/d1/database/${db.uuid}/query`, { sql, params }))[0].results;

// ---------- Pages project ----------
step('Pages project');
let project;
try {
  project = await api('GET', `${A}/pages/projects/${PROJECT}`);
  console.log(`  exists: ${project.subdomain}`);
} catch (e) {
  if (e.status !== 404) throw e;
  project = await api('POST', `${A}/pages/projects`, { name: PROJECT, production_branch: 'main' });
  console.log(`  created: ${project.subdomain}`);
}

// ---------- Login account ----------
step('Login account');
const users = await query('SELECT id, username FROM users');
const needsPassword = users.length === 0 || RESET;
if (!needsPassword) {
  console.log('  account exists; password left unchanged (run with reset to change it)');
} else {
  if (!/^[a-z0-9._-]{3,64}$/.test(USERNAME)) fail('LOGIN_USERNAME must be 3-64 letters, numbers, dot, dash or underscore.');
  const problem = checkNewPassword(PASSWORD);
  if (problem) fail(`LOGIN_PASSWORD: ${problem}.`);

  // A fresh pepper each time the password is (re)set; this is a single-user app, so
  // rotating it only affects the account being set here.
  const pepper = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  wrangler(['pages', 'secret', 'put', 'AUTH_PEPPER', '--project-name', PROJECT], { input: `${pepper}\n` });
  const hash = await hashPassword(PASSWORD, pepper);
  const now = new Date().toISOString();

  const target = users.find((u) => u.username === USERNAME) || (users.length === 1 ? users[0] : null);
  if (target) {
    await query('UPDATE users SET username = ?, password_hash = ?, password_changed_at = ? WHERE id = ?', [USERNAME, hash, now, target.id]);
    await query('DELETE FROM sessions WHERE user_id = ?', [target.id]);
    console.log('  password reset; all sessions signed out');
  } else {
    await query(
      'INSERT INTO users (id, username, password_hash, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)',
      [crypto.randomUUID(), USERNAME, hash, now, now],
    );
    console.log('  account created');
  }
}

// ---------- Deploy ----------
step('Deploying');
wrangler(['pages', 'deploy', '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true']);
console.log(`\n✔ Live at https://${project.subdomain}`);
