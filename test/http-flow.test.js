import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { auth } from '../src/http/auth.js';
import { loginLimiter } from '../src/http/rate-limit.js';
import { createApp } from '../src/http/server.js';
import { hashPassword } from '../src/infra/crypto.js';
import { applicantInput, fakeJpeg, setupCases } from './helpers.js';

let server;
let base;

before(async () => {
  const { cases, audit } = await setupCases();
  const authn = auth({ adminPasswordHash: await hashPassword('pw-long-enough'), sessionSecret: 's'.repeat(32), secureCookies: true });
  server = createApp({ cases, audit, authn, limiter: loginLimiter() });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

test('full flow over HTTP', async () => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{"password":"pw-long-enough"}',
  });
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

test('rejects a tampered session cookie', async () => {
  const res = await fetch(`${base}/api/cases`, { headers: { cookie: `__Host-dv_session=${Date.now() + 1e6}.forged` } });
  assert.equal(res.status, 401);
});
