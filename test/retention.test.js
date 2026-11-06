import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicantInput, approvedCase, ctxFor, fakeJpeg, fakePassport, seedStaff, setupCases } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const ctx = { ip: '203.0.113.9' };

async function submittedCase(env, admin, meron) {
  const c = await approvedCase(env.cases, meron, admin);
  await env.cases.issueCard(c.id, ctxFor(admin));
  await env.cases.submit(c.id, '2028ABCD1234EFGH', ctxFor(admin));
  return c;
}

test('with no policy set, nothing is erased however old', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  await submittedCase(env, admin, meron);
  env.advanceClock(5000 * DAY);
  assert.deepEqual(await env.retention.run(), { submitted: 0, unsent: 0, introductions: 0 });
  const overview = await env.retention.overview(ctxFor(admin));
  assert.equal(overview.kept, 1);
  // The page still shows what a suggested policy would erase.
  assert.equal(overview.preview.submitted, 1);
});

test('erases submitted entries after the set days, and unsent website entries and unused invitations', async () => {
  const env = await setupCases({ retentionPolicy: { afterSubmissionDays: 548, unsentDays: 60 } });
  const { admin, meron } = await seedStaff(env);
  const submitted = await submittedCase(env, admin, meron);
  const inProgress = await approvedCase(env.cases, meron, admin, { firstName: 'Still' });
  const { caseId: unsent, resumeCode } = await env.applications.start({ package: 'self', applicant: applicantInput({ firstName: 'Gone' }) }, ctx);
  await env.applications.savePhoto(unsent, 'applicant', fakeJpeg(), ctx);
  await env.applications.saveDocument(unsent, 'passport', fakePassport(), ctx);
  await env.partners.apply({ name: 'T', organisation: 'Cafe', type: 'shop', phone: '0911000000', city: 'Adama', payoutPhone: '0911000000', agree: true }, ctx);
  const [p] = await env.partners.list(ctxFor(admin));
  const { code } = await env.partners.issueCode(p.id, ctxFor(admin));
  const partner = await env.partners.activeById(await env.partners.signIn(code));
  await env.partners.introduce(partner, { name: 'Meseret', phone: '0922000111', people: 1, package: 'self', consent: true }, ctx);

  env.advanceClock(30 * DAY);
  assert.deepEqual(await env.retention.run(), { submitted: 0, unsent: 0, introductions: 0 });

  env.advanceClock(31 * DAY);
  assert.deepEqual(await env.retention.run(), { submitted: 0, unsent: 1, introductions: 1 });
  assert.equal(await env.applications.resume(resumeCode), null);
  const erasedDraft = await env.cases.get(unsent);
  assert.ok(erasedDraft.erasedAt);
  assert.equal(erasedDraft.applicant.lastName, '(erased)');
  assert.ok(erasedDraft.photos.every((ph) => !ph.uploaded));
  assert.equal((await env.db.execute('SELECT COUNT(*) AS n FROM photos WHERE case_id = ?', [unsent])).rows[0].n, 0);
  assert.equal((await env.partners.introductions(ctxFor(admin))).length, 0);

  env.advanceClock(500 * DAY);
  assert.deepEqual(await env.retention.run(), { submitted: 1, unsent: 0, introductions: 0 });
  const erased = await env.cases.get(submitted.id);
  assert.equal(erased.confirmationNumber, null);
  assert.equal(erased.status, 'submitted');
  assert.equal(erased.code, 'EDA-0001');
  // Nothing personal left in the row, and in-progress cases are untouched.
  const { rows } = await env.db.execute('SELECT applicant FROM cases WHERE id = ?', [submitted.id]);
  assert.ok(!Buffer.from(rows[0].applicant).toString('latin1').includes('Kebede'));
  assert.equal((await env.cases.get(inProgress.id)).applicant.firstName, 'Still');
  // Erased cases stay in the queue as numbers but cannot be worked on.
  assert.ok((await env.cases.list()).cases.some((c) => c.code === 'EDA-0001'));
  await assert.rejects(env.cases.reopen(erasedDraft.id, 'x', ctxFor(admin)), /erased/);
  const activity = await env.cases.activity(submitted.id);
  assert.ok(activity.some((a) => a.action === 'case_erased'));
});

test('an admin can erase one case on request, except while a card is out', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const c = await approvedCase(env.cases, meron, admin);
  await assert.rejects(env.retention.eraseOne(c.id, ctxFor(meron)), /Admins only/);
  await env.cases.issueCard(c.id, ctxFor(admin));
  await assert.rejects(env.retention.eraseOne(c.id, ctxFor(admin)), /card is issued/);
  await env.cases.submit(c.id, '2028ABCD1234EFGH', ctxFor(admin));
  assert.deepEqual(await env.retention.eraseOne(c.id, ctxFor(admin)), { code: 'EDA-0001' });
  await assert.rejects(env.retention.eraseOne(c.id, ctxFor(admin)), /already erased/);
});
