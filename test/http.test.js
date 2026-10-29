import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { auth } from '../src/http/auth.js';
import { createApp } from '../src/http/server.js';
import { caseRepository, openDb } from '../src/infra/db.js';
import { caseService } from '../src/services/cases.js';
import { applicantInput, fakeJpeg } from './helpers.js';

let server;
let base;

before(async () => {
  const cases = caseService({
    repo: caseRepository(openDb(':memory:')),
    bitnob: { createCard: async () => ({ cardId: 'card_1' }), getCard: async () => ({ cardNumber: '4111' }) },
    cardAmountUsd: 5,
  });
  server = createApp({ cases, authn: auth({ adminPassword: 'pw', sessionSecret: 's', secureCookies: false }) });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

test('API requires login', async () => {
  assert.equal((await fetch(`${base}/api/cases`)).status, 401);
  assert.equal((await fetch(`${base}/api/login`, { method: 'POST', body: '{"password":"no"}' })).status, 401);
});

test('serves pages without login', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
});

test('full flow over HTTP', async () => {
  const login = await fetch(`${base}/api/login`, { method: 'POST', body: '{"password":"pw"}' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = (method, path, body, type = 'application/json') => fetch(`${base}${path}`, {
    method, headers: { cookie, 'content-type': type }, body: type === 'application/json' && body ? JSON.stringify(body) : body,
  });

  const invalid = await call('POST', '/api/cases', {});
  assert.equal(invalid.status, 422);
  assert.ok((await invalid.json()).details.length > 0);

  const created = await (await call('POST', '/api/cases', applicantInput())).json();
  assert.equal((await call('PUT', `/api/cases/${created.id}/photos/applicant`, fakeJpeg(), 'image/jpeg')).status, 200);
  const photo = await call('GET', `/api/cases/${created.id}/photos/applicant`);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');

  assert.equal((await (await call('POST', `/api/cases/${created.id}/card`)).json()).status, 'card_issued');
  assert.equal((await (await call('GET', `/api/cases/${created.id}/card`)).json()).cardNumber, '4111');
  const submitted = await (await call('POST', `/api/cases/${created.id}/submit`, { confirmationNumber: '2027ABCD1234EFGH' })).json();
  assert.equal(submitted.status, 'submitted');

  const list = await (await call('GET', '/api/cases')).json();
  assert.equal(list.length, 1);
  assert.equal((await call('GET', '/api/cases/nope')).status, 404);
});
