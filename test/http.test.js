import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { applicantAuth, auth } from '../src/http/auth.js';
import { loginLimiter } from '../src/http/rate-limit.js';
import { createApp } from '../src/http/server.js';
import { totpCode } from '../src/infra/totp.js';
import { PASSWORD, applicantInput, fakeJpeg, seedStaff, setupCases } from './helpers.js';

const WEBHOOK_SECRET = 'whsec_test';
const servers = [];
let base;
let members;

// Each server gets its own database and login limiter, so tests cannot affect one another.
async function startServer({ secureCookies = true, perIp = 5 } = {}) {
  const env = await setupCases();
  const seeded = await seedStaff(env);
  const secrets = { sessionSecret: 's'.repeat(32), secureCookies };
  const server = createApp({
    cases: env.cases, staff: env.staff, applications: env.applications,
    authn: auth(secrets), applicantAuthn: applicantAuth(secrets),
    limiter: loginLimiter({ perIp }), startLimiter: loginLimiter({ perIp: 3 }), resumeLimiter: loginLimiter({ perIp }),
    hsts: true, webhookSecret: WEBHOOK_SECRET,
  });
  await new Promise((resolve) => server.listen(0, resolve));
  servers.push(server);
  return { url: `http://localhost:${server.address().port}`, members: seeded, env };
}

const login = (url, body, headers = {}) => fetch(`${url}/api/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

// Signs a member in and returns a fetch wrapper carrying their session cookie.
async function signedIn(url, member) {
  const res = await login(url, { email: member.email, password: PASSWORD, code: totpCode(member.secret) });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return (method, path, body, type = 'application/json') => fetch(`${url}${path}`, {
    method, headers: { cookie, 'content-type': type }, body: type === 'application/json' && body ? JSON.stringify(body) : body,
  });
}

before(async () => {
  ({ url: base, members } = await startServer());
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

test('serves clean URLs for the landing page, applicant flow and staff app', async () => {
  for (const path of ['/', '/apply', '/photo', '/staff/', '/staff/login.html']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), /text\/html/);
  }
});

test('website applicants start, resume and send over HTTP with their own cookie', async () => {
  const { url, members: m } = await startServer();
  const json = { 'content-type': 'application/json' };
  const start = () => fetch(`${url}/api/apply/start`, {
    method: 'POST', headers: json, body: JSON.stringify({ package: 'self', applicant: applicantInput() }),
  });
  const res = await start();
  assert.equal(res.status, 201);
  const { resumeCode, application } = await res.json();
  assert.equal(application.package, 'self');
  const cookie = res.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^__Host-dv_applicant=/);

  // The applicant cookie opens only the applicant API, never the staff API.
  assert.equal((await fetch(`${url}/api/apply`)).status, 401);
  assert.equal((await fetch(`${url}/api/apply`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${url}/api/cases`, { headers: { cookie } })).status, 401);
  const staffCookieAsApplicant = cookie.replace('__Host-dv_applicant', '__Host-dv_session');
  assert.equal((await fetch(`${url}/api/me`, { headers: { cookie: staffCookieAsApplicant } })).status, 401);

  const photo = await fetch(`${url}/api/apply/photos/applicant`, {
    method: 'PUT', headers: { cookie, 'content-type': 'image/jpeg' }, body: fakeJpeg(),
  });
  assert.equal(photo.status, 200);
  assert.equal((await fetch(`${url}/api/apply/send`, { method: 'POST', headers: { cookie } })).status, 200);

  // A resume code signs the applicant back in; wrong codes are limited.
  const resumed = await fetch(`${url}/api/apply/resume`, { method: 'POST', headers: json, body: JSON.stringify({ code: resumeCode }) });
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).editable, false);
  const wrong = await fetch(`${url}/api/apply/resume`, { method: 'POST', headers: json, body: JSON.stringify({ code: 'AAAA-AAAA-AAAA' }) });
  assert.equal(wrong.status, 401);

  const staffApi = await signedIn(url, m.meron);
  const queue = await (await staffApi('GET', '/api/cases')).json();
  assert.equal(queue.cases[0].source, 'website');

  // Starting entries is limited per connection (3 in this test server).
  assert.equal((await start()).status, 201);
  assert.equal((await start()).status, 201);
  assert.equal((await start()).status, 429);
});

test('API requires a valid session', async () => {
  assert.equal((await fetch(`${base}/api/cases`)).status, 401);
  const forged = await fetch(`${base}/api/cases`, { headers: { cookie: `__Host-dv_session=admin-id.${Date.now() + 1e6}.ok.forged` } });
  assert.equal(forged.status, 401);
});

test('blocks cross-origin writes and non-JSON bodies', async () => {
  assert.equal((await login(base, { email: 'x', password: 'y' }, { origin: 'https://evil.example' })).status, 403);
  const form = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=x',
  });
  assert.equal(form.status, 415);
});

test('locks out after repeated wrong passwords', async () => {
  const { url, members: m } = await startServer({ perIp: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await login(url, { email: m.admin.email, password: 'nope' })).status, 401);
  assert.equal((await login(url, { email: m.admin.email, password: PASSWORD, code: totpCode(m.admin.secret) })).status, 429);
});

test('staff without an authenticator can only set one up', async () => {
  const { url, env } = await startServer();
  const { hashPassword } = await import('../src/infra/crypto.js');
  await env.staffRepo.insert({ id: 'new-id', email: 'new@example.com', name: 'New', role: 'staff', passwordHash: await hashPassword(PASSWORD) });
  const res = await login(url, { email: 'new@example.com', password: PASSWORD });
  assert.equal((await res.json()).needsAuthenticator, true);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const call = (method, path, body) => fetch(`${url}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });

  assert.equal((await call('GET', '/api/cases')).status, 403);
  const { secret } = await (await call('POST', '/api/authenticator/begin')).json();
  const confirmed = await call('POST', '/api/authenticator/confirm', { secret, code: totpCode(secret) });
  assert.equal(confirmed.status, 200);
  const fullCookie = confirmed.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${url}/api/cases`, { headers: { cookie: fullCookie } })).status, 200);
});

test('full flow over HTTP with two staff members', async () => {
  const meron = await signedIn(base, members.meron);
  const admin = await signedIn(base, members.admin);

  const invalid = await meron('POST', '/api/cases', {});
  assert.equal(invalid.status, 422);

  const created = await (await meron('POST', '/api/cases', applicantInput())).json();
  assert.equal((await meron('PUT', `/api/cases/${created.id}/photos/applicant`, fakeJpeg(), 'image/png')).status, 415);
  assert.equal((await meron('PUT', `/api/cases/${created.id}/photos/applicant`, fakeJpeg(), 'image/jpeg')).status, 200);
  const download = await meron('GET', `/api/cases/${created.id}/photos/applicant?download=1`);
  assert.match(download.headers.get('content-disposition'), /EDA-0001-applicant\.jpg/);

  assert.equal((await meron('POST', `/api/cases/${created.id}/check`)).status, 200);
  assert.equal((await meron('POST', `/api/cases/${created.id}/verify`)).status, 422);
  assert.equal((await admin('POST', `/api/cases/${created.id}/verify`)).status, 200);
  assert.equal((await admin('POST', `/api/cases/${created.id}/approve`, { method: 'in_person' })).status, 200);
  assert.equal((await (await admin('POST', `/api/cases/${created.id}/card`)).json()).status, 'card_issued');
  assert.equal((await (await admin('GET', `/api/cases/${created.id}/card`)).json()).cardNumber, '4111111111111111');
  const submitted = await (await admin('POST', `/api/cases/${created.id}/submit`, { confirmationNumber: '2027ABCD1234EFGH' })).json();
  assert.equal(submitted.status, 'submitted');

  const { cases, counts } = await (await meron('GET', '/api/cases?q=eda-0001')).json();
  assert.equal(cases.length, 1);
  assert.deepEqual(counts, { submitted: 1 });
  const activity = await (await meron('GET', `/api/cases/${created.id}/activity`)).json();
  assert.equal(activity[0].action, 'case_submitted');
  assert.equal(activity[0].staffName, 'Admin');
  assert.equal((await meron('GET', '/api/cases/nope')).status, 404);
});

test('audit log and team management are admin-only', async () => {
  const meron = await signedIn(base, members.meron);
  const admin = await signedIn(base, members.admin);
  assert.equal((await meron('GET', '/api/audit')).status, 403);
  assert.equal((await meron('GET', '/api/staff')).status, 403);
  assert.equal((await meron('GET', '/api/staff/directory')).status, 200);
  const events = await (await admin('GET', '/api/audit?kind=login')).json();
  assert.ok(events.length > 0 && events.every((e) => e.action.startsWith('login')));
  const csv = await admin('GET', '/api/audit.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /^time,staff,action,case,detail,ip\n/);
});

test('accepts only correctly signed Bitnob webhooks', async () => {
  const body = JSON.stringify({ event: 'virtualcard.created.completed', data: { card_id: 'unknown' } });
  const sig = createHmac('sha512', WEBHOOK_SECRET).update(body).digest('hex');
  const post = (signature) => fetch(`${base}/api/webhooks/bitnob`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-bitnob-signature': signature }, body,
  });
  assert.equal((await post('bad')).status, 401);
  assert.equal((await post(sig)).status, 200);
});
