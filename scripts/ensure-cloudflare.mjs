#!/usr/bin/env node
// First-run Cloudflare setup, safe to re-run: makes sure the D1 database and a
// workers.dev subdomain exist, writes the database id into wrangler.toml, and (in
// GitHub Actions) exports CLOUDFLARE_ACCOUNT_ID for the wrangler steps that follow.
// Migrations and the deploy itself are separate workflow steps.
//
//   CLOUDFLARE_API_TOKEN=... npm run cf:ensure

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB_NAME = 'work-tracker';
const WORKER_NAME = 'work-tracker';
const TOML = new URL('../wrangler.toml', import.meta.url);
const NEEDS_WORKERS_EDIT =
  'The Cloudflare API token cannot manage Workers. Edit the token (My Profile → API Tokens) and add Account → Workers Scripts → Edit.';

const fail = (msg) => {
  console.error(`✖ ${msg}`);
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

await api('GET', '/user/tokens/verify');

let account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) {
  const accounts = await api('GET', '/accounts?per_page=50');
  if (accounts.length !== 1) fail(`The token can see ${accounts.length} accounts; set CLOUDFLARE_ACCOUNT_ID to pick one.`);
  account = accounts[0].id;
}
const A = `/accounts/${account}`;

// The token needs Workers permission as well as D1. Say so plainly rather than letting
// `wrangler deploy` fail later with a bare authentication error.
try {
  await api('GET', `${A}/workers/scripts`);
} catch (e) {
  if (e.status === 401 || e.status === 403) {
    fail(NEEDS_WORKERS_EDIT);
  }
  throw e;
}

// D1
let db = (await api('GET', `${A}/d1/database?name=${DB_NAME}`)).find((d) => d.name === DB_NAME);
if (!db) {
  db = await api('POST', `${A}/d1/database`, { name: DB_NAME });
  console.log(`✔ Created D1 database ${DB_NAME}`);
} else {
  console.log(`✔ D1 database ${DB_NAME} exists`);
}
const toml = readFileSync(TOML, 'utf8');
writeFileSync(TOML, toml.replace(/^database_id = ".*?"/m, `database_id = "${db.uuid}"`));

// workers.dev subdomain (account-wide; only created if the account has never had one)
let subdomain;
try {
  subdomain = (await api('GET', `${A}/workers/subdomain`)).subdomain;
} catch (e) {
  if (e.status === 401 || e.status === 403) fail(NEEDS_WORKERS_EDIT);
  if (e.status !== 404) throw e;
}
if (!subdomain) {
  const base = String(process.env.WORKERS_SUBDOMAIN || process.env.GITHUB_REPOSITORY_OWNER || 'my-apps')
    .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'my-apps';
  for (const candidate of [base, `${base}-${Math.random().toString(16).slice(2, 6)}`]) {
    try {
      subdomain = (await api('PUT', `${A}/workers/subdomain`, { subdomain: candidate })).subdomain;
      console.log(`✔ Registered workers.dev subdomain ${subdomain}`);
      break;
    } catch (e) {
      if (candidate !== base) throw e;
    }
  }
} else {
  console.log(`✔ workers.dev subdomain ${subdomain}`);
}

const url = `https://${WORKER_NAME}.${subdomain}.workers.dev`;
if (process.env.GITHUB_ENV) {
  appendFileSync(process.env.GITHUB_ENV, `CLOUDFLARE_ACCOUNT_ID=${account}\nWORKER_URL=${url}\n`);
}
console.log(`✔ The app will be at ${url}`);
