import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../src/domain/case.js';
import { applicantInput, approvedCase, ctxFor, fakeJpeg, seedStaff, setupCases } from './helpers.js';

test('runs a case through Abol, Tona and Baraka to submitted', async () => {
  const env = await setupCases();
  const { cases, bitnob, db } = env;
  const { admin, meron } = await seedStaff(env);

  const c = await cases.create(applicantInput(), ctxFor(meron));
  assert.equal(c.status, 'draft');
  assert.equal(c.code, 'EDA-0001');
  assert.equal(c.assignedTo, meron.id);

  await assert.rejects(cases.check(c.id, ctxFor(meron)), /Photo missing for applicant/);
  await cases.savePhoto(c.id, 'applicant', fakeJpeg(), ctxFor(meron));

  const checked = await cases.check(c.id, ctxFor(meron));
  assert.equal(checked.status, 'checked');
  assert.equal(checked.checks.abol.name, 'Meron');
  await assert.rejects(cases.update(c.id, applicantInput(), ctxFor(meron)), /Reopen it first/);

  await assert.rejects(cases.verify(c.id, ctxFor(meron)), /different person/);
  await cases.verify(c.id, ctxFor(admin));
  await assert.rejects(cases.issueCard(c.id, ctxFor(admin)), /expected approved/);
  await assert.rejects(cases.approve(c.id, 'telepathy', ctxFor(admin)), /how the applicant approved/);
  const approved = await cases.approve(c.id, 'phone', ctxFor(admin));
  assert.equal(approved.checks.baraka.method, 'phone');

  const issued = await cases.issueCard(c.id, ctxFor(admin));
  assert.equal(issued.status, 'card_issued');
  assert.deepEqual(bitnob.calls, [{ amountUsd: 5, reference: `dv-${c.id}` }]);
  assert.equal((await cases.getCard(c.id, ctxFor(admin))).cardNumber, '4111111111111111');

  const done = await cases.submit(c.id, ' 2027abcd1234efgh ', ctxFor(admin));
  assert.equal(done.status, 'submitted');
  assert.equal(done.confirmationNumber, '2027ABCD1234EFGH');
  await assert.rejects(cases.getCard(c.id, ctxFor(admin)), ValidationError);

  const { rows } = await db.execute('SELECT action, staff_id FROM audit_events ORDER BY id');
  assert.deepEqual(rows.map((r) => r.action), [
    'case_created', 'photo_saved:applicant', 'check_abol', 'check_tona', 'check_baraka',
    'card_issued', 'card_revealed', 'case_submitted',
  ]);
  assert.equal(rows[0].staff_id, meron.id);
  assert.equal(rows[6].staff_id, admin.id);
});

test('reopening clears the checks and allows edits again', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const c = await approvedCase(env.cases, meron, admin);
  const reopened = await env.cases.reopen(c.id, 'wrong birth date', ctxFor(admin));
  assert.equal(reopened.status, 'draft');
  assert.deepEqual(reopened.checks, {});
  await env.cases.update(c.id, applicantInput({ birthDate: '1996-01-01' }), ctxFor(admin));
  await env.cases.issueCard(c.id, ctxFor(admin)).catch(() => {});
  assert.equal(env.bitnob.calls.length, 0);
});

test('stores applicant data and photos encrypted', async () => {
  const env = await setupCases();
  const { meron } = await seedStaff(env);
  const c = await env.cases.create(applicantInput(), ctxFor(meron));
  await env.cases.savePhoto(c.id, 'applicant', fakeJpeg(), ctxFor(meron));
  const raw = (await env.db.execute('SELECT applicant FROM cases')).rows[0].applicant;
  assert.ok(!Buffer.from(raw).toString('latin1').includes('Kebede'));
  const photo = (await env.db.execute('SELECT data FROM photos')).rows[0].data;
  assert.notDeepEqual(Buffer.from(photo).subarray(0, 2), Buffer.from([0xff, 0xd8]));
  assert.deepEqual(await env.cases.getPhoto(c.id, 'applicant'), fakeJpeg());
});

test('lists cases with counts, search and filters', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  await env.cases.create(applicantInput({ firstName: 'Hanna', lastName: 'Girma' }), ctxFor(meron));
  await approvedCase(env.cases, meron, admin, { firstName: 'Dawit', lastName: 'Alemu' });
  const all = await env.cases.list();
  assert.equal(all.cases.length, 2);
  assert.deepEqual(all.counts, { draft: 1, approved: 1 });
  assert.deepEqual((await env.cases.list({ q: 'dawit' })).cases.map((c) => c.code), ['EDA-0002']);
  assert.deepEqual((await env.cases.list({ q: 'eda-0001' })).cases.map((c) => c.name), ['Hanna Girma']);
  assert.equal((await env.cases.list({ status: 'approved' })).cases[0].people, 1);
  await env.cases.assign(all.cases[0].id, admin.id, ctxFor(admin));
  assert.equal((await env.cases.list({ assignedTo: admin.id })).cases.length, 1);
});

test('does not issue two cards for concurrent or repeated requests', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const c = await approvedCase(env.cases, meron, admin);
  const results = await Promise.allSettled([env.cases.issueCard(c.id, ctxFor(admin)), env.cases.issueCard(c.id, ctxFor(admin))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await assert.rejects(env.cases.issueCard(c.id, ctxFor(admin)), /expected approved/);
  assert.equal(env.bitnob.calls.length, 1);
});

test('records Bitnob webhook events against the card\'s case, without card numbers', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const c = await approvedCase(env.cases, meron, admin);
  await env.cases.issueCard(c.id, ctxFor(admin));
  await env.cases.handleBitnobEvent({
    event: 'virtualcard.transaction.declined',
    data: { card_id: 'card_123', amount: 1, reason: 'insufficient funds', card_number: '4111111111111111' },
  }, { ip: '1.2.3.4' });
  const [latest] = await env.cases.activity(c.id);
  assert.equal(latest.action, 'bitnob:virtualcard.transaction.declined');
  assert.equal(latest.detail, 'amount=1 reason=insufficient funds');
  assert.equal(latest.caseCode, 'EDA-0001');
});
