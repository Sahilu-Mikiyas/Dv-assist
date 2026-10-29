import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { auth } from '../src/http/auth.js';
import { loginLimiter } from '../src/http/rate-limit.js';
import { createApp } from '../src/http/server.js';
import { hashPassword } from '../src/infra/crypto.js';
import { setupCases } from './helpers.js';

let server;
let base;

before(async () => {
  const { cases, audit } = await setupCases();
  const authn = auth({ adminPasswordHash: await hashPassword('pw-long-enough'), sessionSecret: 's'.repeat(32), secureCookies: false });
  server = createApp({ cases, audit, authn, limiter: loginLimiter({ perIp: 3 }), hsts: true });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

const json = { 'content-type': 'application/json' };
const login = (password, headers = {}) =>
  fetch(`${base}/api/login`, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify({ password }) });

test('sets security headers on every response', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'.*frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('strict-transport-security'), /max-age=/);
  assert.ok(res.headers.get('x-request-id'));
});

test('serves pages without login but not files outside public/', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
});

test('API requires login', async () => {
  assert.equal((await fetch(`${base}/api/cases`)).status, 401);
});

test('blocks cross-origin writes and non-JSON bodies', async () => {
  assert.equal((await login('pw-long-enough', { origin: 'https://evil.example' })).status, 403);
  const form = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=x',
  });
  assert.equal(form.status, 415);
});

test('locks out after repeated wrong passwords', async () => {
  const ip = { 'x-forwarded-for': '198.51.100.1' }; // ignored: trustProxy is off, so all tests share one IP
  for (let i = 0; i < 3; i++) assert.equal((await login('nope', ip)).status, 401);
  assert.equal((await login('pw-long-enough')).status, 429);
});
