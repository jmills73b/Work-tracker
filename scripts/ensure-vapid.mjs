#!/usr/bin/env node
// Makes sure the Worker has its VAPID key pair (the secret VAPID_PRIVATE_JWK). Created
// once and never replaced: every device's subscription is tied to the public half, so a
// new key would silently break reminders everywhere. Runs after `wrangler deploy`.

import { execFileSync } from 'node:child_process';

const NAME = 'VAPID_PRIVATE_JWK';
const wrangler = (args, input) => execFileSync('npx', ['wrangler', ...args], {
  input,
  encoding: 'utf8',
  stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'],
  env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
});

const existing = JSON.parse(wrangler(['secret', 'list', '--format', 'json']));
if (existing.some((s) => s.name === NAME)) {
  console.log(`✔ ${NAME} already set; leaving it alone`);
} else {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  wrangler(['secret', 'put', NAME], JSON.stringify({ kty, crv, x, y, d }));
  console.log(`✔ Created ${NAME}`);
}
