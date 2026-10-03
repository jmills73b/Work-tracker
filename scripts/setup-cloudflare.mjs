#!/usr/bin/env node
// One-command Cloudflare setup: D1 database + tables, Pages project, Zero Trust Access
// login locked to one email, then deploys the site. Safe to re-run: it reuses anything
// that already exists.
//
//   CLOUDFLARE_API_TOKEN=... npm run setup -- you@example.com
//
// Optional env: CLOUDFLARE_ACCOUNT_ID (auto-detected if the token sees one account),
// ACCESS_TEAM_NAME (only needed if Zero Trust has never been set up on the account),
// PAGES_PROJECT (default "work-tracker").

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const EMAIL = String(process.argv[2] || process.env.ALLOWED_EMAIL || '').trim().toLowerCase();
const PROJECT = process.env.PAGES_PROJECT || 'work-tracker';
const DB_NAME = 'work-tracker';
const APP_NAME = 'Work Tracker';
const POLICY_NAME = 'Work Tracker owner';
const TOML = new URL('../wrangler.toml', import.meta.url);

const step = (msg) => console.log(`\n▸ ${msg}`);
const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};

if (!TOKEN) fail('CLOUDFLARE_API_TOKEN is not set.');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(EMAIL)) fail('Pass the email allowed to sign in: npm run setup -- you@example.com');

async function api(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const err = new Error(`${method} ${path} → HTTP ${res.status} ${JSON.stringify(data.errors || data)}`);
    err.status = res.status;
    throw err;
  }
  return data.result;
}

function wrangler(args, env = {}) {
  execFileSync('npx', ['--yes', 'wrangler', ...args], {
    stdio: 'inherit',
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: ACCOUNT, ...env },
  });
}

function setToml(pattern, replacement) {
  const before = readFileSync(TOML, 'utf8');
  const after = before.replace(pattern, replacement);
  if (after === before && !before.includes(replacement)) fail(`Could not update wrangler.toml (${pattern})`);
  writeFileSync(TOML, after);
}

// ---------- Account ----------
step('Checking API token');
await api('GET', '/user/tokens/verify');
let ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!ACCOUNT) {
  const accounts = await api('GET', '/accounts?per_page=50');
  if (accounts.length !== 1) {
    fail(`Token can see ${accounts.length} accounts; set CLOUDFLARE_ACCOUNT_ID to one of: ${accounts.map((a) => `${a.id} (${a.name})`).join(', ')}`);
  }
  ACCOUNT = accounts[0].id;
}
const A = `/accounts/${ACCOUNT}`;
console.log(`  account ${ACCOUNT}`);

// ---------- D1 ----------
step('D1 database');
let db = (await api('GET', `${A}/d1/database?name=${DB_NAME}`)).find((d) => d.name === DB_NAME);
if (!db) {
  db = await api('POST', `${A}/d1/database`, { name: DB_NAME });
  console.log(`  created ${db.uuid}`);
} else {
  console.log(`  exists ${db.uuid}`);
}
setToml(/^database_id = ".*?"/m, `database_id = "${db.uuid}"`);
wrangler(['d1', 'migrations', 'apply', DB_NAME, '--remote']);

// ---------- Pages project ----------
step('Pages project');
let project;
try {
  project = await api('GET', `${A}/pages/projects/${PROJECT}`);
  console.log(`  exists ${project.subdomain}`);
} catch (e) {
  if (e.status !== 404) throw e;
  project = await api('POST', `${A}/pages/projects`, { name: PROJECT, production_branch: 'main' });
  console.log(`  created ${project.subdomain}`);
}
const host = project.subdomain; // e.g. work-tracker-abc.pages.dev

// ---------- Zero Trust organisation ----------
step('Zero Trust team');
let org;
try {
  org = await api('GET', `${A}/access/organizations`);
} catch (e) {
  if (e.status !== 404) throw e;
}
if (!org || !org.auth_domain) {
  const team = process.env.ACCESS_TEAM_NAME;
  if (!team) fail('Zero Trust is not set up on this account yet. Re-run with ACCESS_TEAM_NAME=<pick-a-name>, or set it up once at one.dash.cloudflare.com.');
  org = await api('POST', `${A}/access/organizations`, { name: team, auth_domain: `${team}.cloudflareaccess.com` });
  console.log('  created');
}
const teamDomain = org.auth_domain;
console.log(`  ${teamDomain}`);

step('One-time PIN login');
const idps = await api('GET', `${A}/access/identity_providers`);
if (!idps.some((p) => p.type === 'onetimepin')) {
  await api('POST', `${A}/access/identity_providers`, { name: 'One-time PIN', type: 'onetimepin', config: {} });
  console.log('  enabled');
} else {
  console.log('  already enabled');
}

// ---------- Access policy + application ----------
step(`Access policy (allow ${EMAIL})`);
const policyBody = { name: POLICY_NAME, decision: 'allow', include: [{ email: { email: EMAIL } }] };
let policy = (await api('GET', `${A}/access/policies?per_page=100`)).find((p) => p.name === POLICY_NAME);
policy = policy
  ? await api('PUT', `${A}/access/policies/${policy.id}`, policyBody)
  : await api('POST', `${A}/access/policies`, policyBody);

step(`Access application for ${host}`);
const appBase = {
  name: APP_NAME,
  type: 'self_hosted',
  domain: host,
  session_duration: '24h',
  app_launcher_visible: false,
  policies: [{ id: policy.id, precedence: 1 }],
};
const withDestinations = { ...appBase, destinations: [{ type: 'public', uri: host }, { type: 'public', uri: `*.${host}` }] };
const withDomains = { ...appBase, self_hosted_domains: [host, `*.${host}`] };
const existingApp = (await api('GET', `${A}/access/apps?per_page=100`)).find((a) => a.name === APP_NAME);
const saveApp = (body) =>
  existingApp ? api('PUT', `${A}/access/apps/${existingApp.id}`, body) : api('POST', `${A}/access/apps`, body);
let app;
try {
  app = await saveApp(withDestinations);
} catch (e) {
  if (e.status !== 400) throw e;
  app = await saveApp(withDomains); // older API shape
}
console.log(`  aud ${app.aud}`);

// ---------- Config + deploy ----------
step('Writing wrangler.toml');
setToml(/^ACCESS_TEAM_DOMAIN = ".*?"/m, `ACCESS_TEAM_DOMAIN = "${teamDomain}"`);
setToml(/^ACCESS_AUD = ".*?"/m, `ACCESS_AUD = "${app.aud}"`);
setToml(/^ALLOWED_EMAILS = ".*?"/m, `ALLOWED_EMAILS = "${EMAIL}"`);

step('Deploying');
wrangler(['pages', 'deploy', '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true']);

console.log(`\n✔ Live at https://${host}  (sign in with ${EMAIL})`);
