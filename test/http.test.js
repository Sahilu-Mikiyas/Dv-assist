import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { applicantAuth, auth, partnerAuth } from '../src/http/auth.js';
import { loginLimiter } from '../src/http/rate-limit.js';
import { createApp } from '../src/http/server.js';
import { totpCode } from '../src/infra/totp.js';
import { PASSWORD, applicantInput, fakeJpeg, fakePassport, seedStaff, setupCases } from './helpers.js';

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
    cases: env.cases, staff: env.staff, applications: env.applications, partners: env.partners, notifications: env.notifications, retention: env.retention, payouts: env.payouts, economics: env.economics,
    authn: auth(secrets), applicantAuthn: applicantAuth(secrets), partnerAuthn: partnerAuth(secrets),
    limiter: loginLimiter({ perIp }), accountLimiter: loginLimiter({ perIp: 50 }), startLimiter: loginLimiter({ perIp: 3 }),
    resumeLimiter: loginLimiter({ perIp }), partnerLimiter: loginLimiter({ perIp }), partnerApplyLimiter: loginLimiter({ perIp: 20 }),
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
// Each authenticator code works once, so a member signed in on a server keeps that session for later tests.
const sessions = new Map();
async function signedIn(url, member) {
  const key = `${url}|${member.id}`;
  if (!sessions.has(key)) sessions.set(key, await signIn(url, member));
  return sessions.get(key);
}

async function signIn(url, member) {
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

test('the privacy page states the configured retention rules', async () => {
  const policy = await (await fetch(`${base}/api/public/policy`)).json();
  assert.deepEqual(policy.retention, { afterSubmissionDays: null, unsentDays: null });
});

test('serves clean URLs for the landing page, applicant flow and staff app', async () => {
  for (const path of ['/', '/apply', '/photo', '/privacy', '/terms', '/refunds', '/partners', '/partner/login.html', '/staff/', '/staff/login.html', '/staff/data.html', '/staff/messages.html']) {
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
  assert.equal((await fetch(`${url}/api/apply/send`, { method: 'POST', headers: { cookie } })).status, 422);
  const scan = await fetch(`${url}/api/apply/documents/passport`, {
    method: 'PUT', headers: { cookie, 'content-type': 'image/jpeg' }, body: fakePassport(),
  });
  assert.equal(scan.status, 200);
  assert.equal((await scan.json()).documents.find((d) => d.kind === 'passport').uploaded, true);
  assert.equal((await fetch(`${url}/api/apply/documents/passport`, { headers: { cookie } })).status, 200);
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

test('partners sign in with a code, introduce people, and their short links redirect to /apply', async () => {
  const { url, members: m, env } = await startServer();
  const json = { 'content-type': 'application/json' };
  const applied = await fetch(`${url}/api/partners/apply`, { method: 'POST', headers: json, body: JSON.stringify({
    name: 'Tigist', organisation: 'Haile Internet Cafe', type: 'shop', phone: '0911234567', city: 'Adama', payoutPhone: '0911234567', agree: true,
  }) });
  assert.equal(applied.status, 201);

  const admin = await signedIn(url, m.admin);
  const meron = await signedIn(url, m.meron);
  assert.equal((await meron('GET', '/api/partners')).status, 403);
  const [partner] = await (await admin('GET', '/api/partners')).json();
  const { code } = await (await admin('POST', `/api/partners/${partner.id}/code`)).json();

  assert.equal((await fetch(`${url}/api/partner`)).status, 401);
  const wrong = await fetch(`${url}/api/partner/login`, { method: 'POST', headers: json, body: JSON.stringify({ code: 'AAAA-AAAA-AAAA' }) });
  assert.equal(wrong.status, 401);
  const login = await fetch(`${url}/api/partner/login`, { method: 'POST', headers: json, body: JSON.stringify({ code }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^__Host-dv_partner=/);
  // The partner cookie opens the partner API only.
  assert.equal((await fetch(`${url}/api/cases`, { headers: { cookie } })).status, 401);
  const board = await (await fetch(`${url}/api/partner`, { headers: { cookie } })).json();
  assert.equal(board.organisation, 'Haile Internet Cafe');

  const intro = await fetch(`${url}/api/partner/introductions`, { method: 'POST', headers: { cookie, ...json }, body: JSON.stringify({
    name: 'Meseret Bekele', phone: '0922000111', people: 2, package: 'self', consent: true,
  }) });
  assert.equal(intro.status, 201);
  const { reference } = await intro.json();

  const short = await fetch(`${url}/i/${reference.toLowerCase()}`, { redirect: 'manual' });
  assert.equal(short.status, 302);
  assert.equal(short.headers.get('location'), `/apply?invite=${reference}`);
  assert.equal((await fetch(`${url}/r/${board.refCode}`, { redirect: 'manual' })).headers.get('location'), `/apply?ref=${board.refCode}`);
  const greeting = await (await fetch(`${url}/api/apply/referrer?invite=${reference}`)).json();
  assert.equal(greeting.firstName, 'Meseret');

  // Filling together on the partner's phone: the entry is linked and its session is short.
  const start = await fetch(`${url}/api/apply/start`, { method: 'POST', headers: { cookie, ...json }, body: JSON.stringify({
    package: 'self', applicant: applicantInput(), ref: board.refCode, together: true,
  }) });
  assert.equal(start.status, 201);
  assert.equal((await start.json()).together, true);
  assert.match(start.headers.get('set-cookie'), /Max-Age=7200;/);

  const follow = await (await admin('GET', '/api/introductions')).json();
  assert.equal(follow[0].name, 'Meseret Bekele');

  // With no SMS or email service, messages wait on the staff Messages page; partners cannot see it.
  await env.notifications.deliverDue();
  assert.equal((await fetch(`${url}/api/messages`, { headers: { cookie } })).status, 401);
  assert.equal((await meron('GET', '/api/messages')).status, 403); // admins only: may hold resume codes
  const messages = await (await admin('GET', '/api/messages')).json();
  assert.equal(messages.sms, null);
  assert.deepEqual(messages.toSend.map((m) => m.template).sort(), ['partner_approved', 'resume_code']);
  const [first] = messages.toSend;
  assert.equal((await admin('POST', `/api/messages/${first.id}/sent`)).status, 200);
  assert.equal((await (await admin('GET', '/api/messages')).json()).toSend.length, 1);

  // Statements: a partner reads only their own; the all-partners report is for admins.
  const statement = await (await fetch(`${url}/api/partner/statement`, { headers: { cookie } })).json();
  assert.equal(statement.totals.referrals, 2);
  const statementCsv = await fetch(`${url}/api/partner/statement.csv`, { headers: { cookie } });
  assert.match(await statementCsv.text(), /^case,name,people/);
  assert.equal((await fetch(`${url}/api/partners/report`, { headers: { cookie } })).status, 401);
  assert.equal((await meron('GET', '/api/partners/report')).status, 403);
  assert.equal((await (await admin('GET', '/api/partners/report')).json()).totals.referrals, 2);
  assert.equal((await fetch(`${url}/vendor/qrcode.mjs`)).headers.get('content-type'), 'text/javascript; charset=utf-8');

  // Revenue share: costs and terms are admin-only; a tech centre has no revenue-share account.
  assert.equal((await fetch(`${url}/api/partner/revenue-share`, { headers: { cookie } })).status, 404);
  assert.equal((await meron('GET', '/api/economics')).status, 403);
  const costs = await (await admin('GET', '/api/economics')).json();
  assert.equal(costs.values.paymentCostEtb, 900);
  assert.equal((await meron('PUT', '/api/economics', costs.values)).status, 403);
  assert.equal((await admin('PUT', '/api/economics', { ...costs.values, supportEtb: 25 })).status, 200);
  assert.equal((await meron('POST', `/api/partners/${partner.id}/terms`, { kind: 'revenue_share', deal: { directPct: 55, throughUsPct: 23.5 } })).status, 403);
  assert.equal((await admin('POST', `/api/partners/${partner.id}/terms`, { kind: 'revenue_share', deal: { directPct: 55, throughUsPct: 23.5 } })).status, 200);
  const share = await (await fetch(`${url}/api/partner/revenue-share`, { headers: { cookie } })).json();
  assert.equal(share.deal.directPct, 55);
  assert.match(await (await fetch(`${url}/api/partner/revenue-share.csv`, { headers: { cookie } })).text(), /^month,stream,applicants/);
  assert.equal((await (await admin('GET', `/api/partners/${partner.id}/revenue-share`)).json()).deal.throughUsPct, 23.5);

  // Payouts are admin-only.
  assert.equal((await meron('GET', '/api/payouts')).status, 403);
  const csv = await admin('GET', '/api/payouts.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /^created,partner,entries/);

  // Data retention is admin-only.
  assert.equal((await meron('GET', '/api/retention')).status, 403);
  assert.equal((await meron('POST', '/api/retention/run')).status, 403);
  const retention = await (await admin('GET', '/api/retention')).json();
  assert.deepEqual(retention.policy, { afterSubmissionDays: null, unsentDays: null });
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
  assert.equal((await meron('POST', `/api/cases/${created.id}/check`)).status, 422); // no passport scan yet
  assert.equal((await meron('PUT', `/api/cases/${created.id}/documents/passport`, fakeJpeg(), 'image/jpeg')).status, 422); // too small to read
  assert.equal((await meron('PUT', `/api/cases/${created.id}/documents/passport`, fakePassport(), 'image/jpeg')).status, 200);
  const scanDownload = await meron('GET', `/api/cases/${created.id}/documents/passport?download=1`);
  assert.match(scanDownload.headers.get('content-disposition'), /EDA-0001-passport\.jpg/);

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

test('security: sessions end on logout and password change; a stale setup cookie cannot take over an authenticator', async () => {
  const { url, members: m } = await startServer();
  const json = { 'content-type': 'application/json' };
  const admin = await signedIn(url, m.admin);

  // Logout ends that session everywhere (the old cookie stops working).
  const fresh = await signIn(url, { ...m.meron, secret: m.meron.secret });
  assert.equal((await fresh('GET', '/api/me')).status, 200);
  assert.equal((await fresh('POST', '/api/logout')).status, 200);
  assert.equal((await fresh('GET', '/api/me')).status, 401);

  // A new member signs in with the temporary password (setup cookie), then sets up their authenticator.
  const created = await (await admin('POST', '/api/staff', { email: 'new@example.com', name: 'New', role: 'staff', password: 'temporary-password-1' })).json();
  const setup = await fetch(`${url}/api/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: 'new@example.com', password: 'temporary-password-1' }) });
  const setupCookie = setup.headers.get('set-cookie').split(';')[0];
  const begun = await (await fetch(`${url}/api/authenticator/begin`, { method: 'POST', headers: { cookie: setupCookie } })).json();
  const done = await fetch(`${url}/api/authenticator/confirm`, { method: 'POST', headers: { cookie: setupCookie, ...json }, body: JSON.stringify({ secret: begun.secret, code: totpCode(begun.secret) }) });
  assert.equal(done.status, 200);
  // The old setup cookie is dead now: it cannot start a new authenticator.
  assert.equal((await fetch(`${url}/api/authenticator/begin`, { method: 'POST', headers: { cookie: setupCookie } })).status, 401);
  // And the full cookie cannot replace it either.
  const full = done.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${url}/api/authenticator/begin`, { method: 'POST', headers: { cookie: full } })).status, 403);

  // A password change by an admin signs the member out.
  assert.equal((await admin('PATCH', `/api/staff/${created.id}`, { password: 'another-password-22' })).status, 200);
  assert.equal((await fetch(`${url}/api/me`, { headers: { cookie: full } })).status, 401);
});

test('security: bad bodies get clean errors; big bodies get 413; partner code resets end partner sessions', async () => {
  const { url, members: m } = await startServer();
  const json = { 'content-type': 'application/json' };
  for (const path of ['/api/apply/resume', '/api/partner/login', '/api/login']) {
    assert.equal((await fetch(`${url}${path}`, { method: 'POST', headers: json, body: 'null' })).status, 400, path);
  }
  assert.equal((await fetch(`${url}/api/apply/resume`, { method: 'POST', headers: json, body: JSON.stringify({ code: { $gt: '' } }) })).status, 400);
  const big = await fetch(`${url}/api/apply/start`, { method: 'POST', headers: json, body: JSON.stringify({ x: 'a'.repeat(200 * 1024) }) });
  assert.equal(big.status, 413);

  const admin = await signedIn(url, m.admin);
  await fetch(`${url}/api/partners/apply`, { method: 'POST', headers: json, body: JSON.stringify({
    name: 'T', organisation: 'Cafe', type: 'shop', phone: '0911234567', city: 'Adama', payoutPhone: '0911234567', agree: true,
  }) });
  const [partner] = await (await admin('GET', '/api/partners')).json();
  const { code } = await (await admin('POST', `/api/partners/${partner.id}/code`)).json();
  const login = await fetch(`${url}/api/partner/login`, { method: 'POST', headers: json, body: JSON.stringify({ code }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${url}/api/partner`, { headers: { cookie } })).status, 200);
  await admin('POST', `/api/partners/${partner.id}/code`); // new code: old devices are signed out
  assert.equal((await fetch(`${url}/api/partner`, { headers: { cookie } })).status, 401);

  // Staff cannot assign a case to someone who is not on the team.
  const staffApi = await signedIn(url, m.meron);
  const c = await (await staffApi('POST', '/api/cases', applicantInput())).json();
  assert.equal((await staffApi('POST', `/api/cases/${c.id}/assign`, { staffId: '<script>' })).status, 422);
});
