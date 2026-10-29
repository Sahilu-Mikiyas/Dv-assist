import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { auth } from '../src/http/auth.js';
import { loginLimiter } from '../src/http/rate-limit.js';
import { createApp } from '../src/http/server.js';
import { hashPassword } from '../src/infra/crypto.js';
import { applicantInput, fakeJpeg, setupCases } from './helpers.js';

const PASSWORD = 'pw-long-enough';
const servers = [];

// Each server gets its own database and login limiter, so tests cannot affect one another.
async function startServer({ secureCookies = true, perIp = 5 } = {}) {
  const { cases, audit } = await setupCases();
  const authn = auth({ adminPasswordHash: await hashPassword(PASSWORD), sessionSecret: 's'.repeat(32), secureCookies });
  const server = createApp({ cases, audit, authn, limiter: loginLimiter({ perIp }), hsts: true });
  await new Promise((resolve) => server.listen(0, resolve));
  servers.push(server);
  return `http://localhost:${server.address().port}`;
}

const login = (base, password, headers = {}) => fetch(`${base}/api/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ password }),
});

let base;
before(async () => {
  base = await startServer();
});
after(() => servers.forEach((s) => s.close()));

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

test('API requires a valid session', async () => {
  assert.equal((await fetch(`${base}/api/cases`)).status, 401);
  const forged = await fetch(`${base}/api/cases`, { headers: { cookie: `__Host-dv_session=${Date.now() + 1e6}.forged` } });
  assert.equal(forged.status, 401);
});

test('blocks cross-origin writes and non-JSON bodies', async () => {
  assert.equal((await login(base, PASSWORD, { origin: 'https://evil.example' })).status, 403);
  const form = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=x',
  });
  assert.equal(form.status, 415);
});

test('locks out after repeated wrong passwords', async () => {
  const lockedBase = await startServer({ perIp: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await login(lockedBase, 'nope')).status, 401);
  assert.equal((await login(lockedBase, PASSWORD)).status, 429);
});

test('full flow over HTTP', async () => {
  const res = await login(base, PASSWORD, { origin: base });
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /^__Host-dv_session=.*HttpOnly; SameSite=Strict; Secure/);
  const cookie = setCookie.split(';')[0];
  const call = (method, path, body, type = 'application/json') => fetch(`${base}${path}`, {
    method, headers: { cookie, 'content-type': type }, body: type === 'application/json' && body ? JSON.stringify(body) : body,
  });

  const invalid = await call('POST', '/api/cases', {});
  assert.equal(invalid.status, 422);
  assert.ok((await invalid.json()).details.length > 0);

  const created = await (await call('POST', '/api/cases', applicantInput())).json();
  assert.equal((await call('PUT', `/api/cases/${created.id}/photos/applicant`, fakeJpeg(), 'image/png')).status, 415);
  assert.equal((await call('PUT', `/api/cases/${created.id}/photos/applicant`, fakeJpeg(), 'image/jpeg')).status, 200);
  const photo = await call('GET', `/api/cases/${created.id}/photos/applicant`);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');

  assert.equal((await (await call('POST', `/api/cases/${created.id}/card`)).json()).status, 'card_issued');
  assert.equal((await (await call('GET', `/api/cases/${created.id}/card`)).json()).cardNumber, '4111111111111111');
  const submitted = await (await call('POST', `/api/cases/${created.id}/submit`, { confirmationNumber: '2027ABCD1234EFGH' })).json();
  assert.equal(submitted.status, 'submitted');

  const list = await (await call('GET', '/api/cases')).json();
  assert.equal(list.length, 1);
  assert.equal((await call('GET', '/api/cases/nope')).status, 404);
});
