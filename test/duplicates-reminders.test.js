import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reminderService } from '../src/services/reminders.js';
import { applicantInput, ctxFor, fakeChannel, fakeJpeg, fakePassport, seedStaff, setupCases } from './helpers.js';

const ctx = { ip: '203.0.113.6' };
const DAY = 24 * 60 * 60 * 1000;

test('one entry per passport: a second website entry is refused, and Abol is blocked for staff duplicates', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const person = applicantInput({ passportNumber: 'EP7777777' });
  const first = await env.applications.start({ package: 'self', applicant: person }, ctx);
  await assert.rejects(env.applications.start({ package: 'self', applicant: { ...person, passportNumber: 'ep 777 7777' } }, ctx), /already exists/);

  // Staff can still type one in (e.g. at the office), but it is flagged and cannot pass the first check.
  const staffCase = await env.cases.create({ ...person }, ctxFor(meron));
  assert.deepEqual(staffCase.duplicates.map((d) => d.match), ['passport']);
  await env.cases.savePhoto(staffCase.id, 'applicant', fakeJpeg(), ctxFor(meron));
  await env.cases.saveDocument(staffCase.id, 'passport', fakePassport(), ctxFor(meron));
  await assert.rejects(env.cases.check(staffCase.id, ctxFor(meron)), /Same passport as EDA-0001/);

  // Erasing the other entry clears it.
  await env.retention.eraseOne(first.caseId, ctxFor(admin));
  assert.deepEqual((await env.cases.get(staffCase.id)).duplicates, []);
  assert.equal((await env.cases.check(staffCase.id, ctxFor(meron))).status, 'checked');

  // Same name and birth date with another passport: a warning only.
  const twin = await env.cases.create(applicantInput({ passportNumber: 'EP8888888' }), ctxFor(meron));
  assert.deepEqual(twin.duplicates.map((d) => d.match), ['name and birth date']);
});

test('fingerprints are filled in for cases saved before they existed', async () => {
  const env = await setupCases();
  const { meron } = await seedStaff(env);
  const c = await env.cases.create(applicantInput({ passportNumber: 'EP5555555' }), ctxFor(meron));
  await env.db.execute({ sql: 'UPDATE cases SET passport_fp = NULL, person_fp = NULL WHERE id = ?', args: [c.id] });
  const later = await env.cases.create(applicantInput({ passportNumber: 'EP5555555' }), ctxFor(meron));
  assert.deepEqual(later.duplicates, []); // not found while the old case has no fingerprint
  assert.equal(await env.caseRepo.backfillFingerprints(), 1);
  assert.deepEqual((await env.cases.get(later.id)).duplicates.map((d) => d.match), ['passport']);
});

test('reminders go out once: approval waiting 3 days, unfinished entries after 2 days; reopening tells the applicant', async () => {
  const sms = fakeChannel('sms');
  const env = await setupCases({ sms });
  const { admin, meron } = await seedStaff(env);
  const waiting = await env.applications.start({ package: 'self', applicant: applicantInput({ phone: '0911000001' }) }, ctx);
  await env.applications.start({ package: 'self', applicant: applicantInput({ phone: '0911000002' }) }, ctx);
  await env.applications.savePhoto(waiting.caseId, 'applicant', fakeJpeg(), ctx);
  await env.applications.saveDocument(waiting.caseId, 'passport', fakePassport(), ctx);
  await env.applications.send(waiting.caseId, ctx);
  await env.cases.check(waiting.caseId, ctxFor(meron));
  await env.cases.verify(waiting.caseId, ctxFor(admin));

  const repo = env.caseRepo;
  let clock = Date.now();
  const reminders = reminderService({ caseRepo: repo, notifications: env.notifications, now: () => clock });
  assert.equal(await reminders.run(), 0);
  clock += 4 * DAY;
  assert.equal(await reminders.run(), 2);
  assert.equal(await reminders.run(), 0); // once only
  await env.notifications.deliverDue();
  const texts = sms.sent.map((m) => `${m.to} ${m.text}`);
  assert.ok(texts.some((t) => t.startsWith('+251911000001') && t.includes('still waiting for your approval')));
  assert.ok(texts.some((t) => t.startsWith('+251911000002') && t.includes('not finished yet')));

  await env.cases.reopen(waiting.caseId, 'Wrong birth city', ctxFor(admin));
  await env.notifications.deliverDue();
  assert.ok(sms.sent.at(-1).text.includes('found something to correct'));
  assert.ok(!sms.sent.at(-1).text.includes('Wrong birth city')); // the internal reason stays internal
});

test('applicants see whether their payment arrived', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const { caseId } = await env.applications.start({ package: 'managed', applicant: applicantInput() }, ctx);
  await env.applications.savePhoto(caseId, 'applicant', fakeJpeg(), ctx);
  await env.applications.saveDocument(caseId, 'passport', fakePassport(), ctx);
  await env.applications.send(caseId, ctx);
  assert.deepEqual((await env.applications.get(caseId)).payment, { status: 'none' });
  await env.cases.recordPayment(caseId, { amountEtb: 1500, method: 'cash' }, ctxFor(meron));
  assert.deepEqual((await env.applications.get(caseId)).payment, { status: 'paid', amountEtb: 1500 });
  await env.cases.refundPayment(caseId, 'Changed mind', ctxFor(admin));
  assert.equal((await env.applications.get(caseId)).payment.status, 'refunded');
});

test('five simultaneous starts with one passport create only one entry', async () => {
  const env = await setupCases();
  const person = applicantInput({ passportNumber: 'EP9999999' });
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => env.applications.start({ package: 'self', applicant: person }, ctx)));
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected', 'rejected', 'rejected', 'rejected']);
  assert.equal(Number((await env.db.execute('SELECT COUNT(*) AS n FROM cases')).rows[0].n), 1);
});
