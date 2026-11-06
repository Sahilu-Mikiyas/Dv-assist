import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newResumeCode } from '../src/services/applications.js';
import { applicantInput, ctxFor, fakeJpeg, fakePassport, person, seedStaff, setupCases } from './helpers.js';

const ctx = { ip: '203.0.113.9' };

test('resume codes are 12 unambiguous characters in groups of four', () => {
  const code = newResumeCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.notEqual(newResumeCode(), code);
});

test('a website entry goes from applicant to staff checks to online approval', async () => {
  const env = await setupCases();
  const { applications, cases, db } = env;
  const { admin, meron } = await seedStaff(env);

  await assert.rejects(applications.start({ package: 'gold', applicant: applicantInput() }, ctx), /package is invalid/);
  const input = { package: 'managed', applicant: applicantInput({ children: [person({ birthDate: '2015-06-01',  firstName: 'Liya' })] }) };
  const { caseId, resumeCode, application } = await applications.start(input, ctx);
  assert.equal(application.code, 'EDA-0001');
  assert.equal(application.editable, true);
  assert.deepEqual(application.photos.map((p) => p.key), ['applicant', 'child0']);

  // Only the hash of the code is stored, and the code finds the case in any spacing or case.
  const { rows } = await db.execute('SELECT access_hash FROM cases');
  assert.ok(!rows[0].access_hash.includes(resumeCode.replaceAll('-', '')));
  assert.equal(await applications.resume(resumeCode.toLowerCase().replaceAll('-', ' ')), caseId);
  assert.equal(await applications.resume('AAAA-AAAA-AAAA'), null);

  // Not in the staff queue, and not checkable, until it is sent.
  assert.equal((await cases.list()).cases.length, 0);
  await applications.savePhoto(caseId, 'applicant', fakeJpeg(), ctx);
  await applications.saveDocument(caseId, 'passport', fakePassport(), ctx);
  await assert.rejects(applications.send(caseId, ctx), /Photo missing for child0/);
  await applications.savePhoto(caseId, 'child0', fakeJpeg(), ctx);
  await assert.rejects(cases.check(caseId, ctxFor(meron)), /not found/); // staff cannot see it until it is sent

  const sent = await applications.send(caseId, ctx);
  assert.equal(sent.editable, false);
  await assert.rejects(applications.update(caseId, input, ctx), /can no longer be changed/);
  await assert.rejects(applications.savePhoto(caseId, 'applicant', fakeJpeg(), ctx), /can no longer be changed/);
  const [row] = (await cases.list()).cases;
  assert.equal(row.source, 'website');
  assert.equal(row.package, 'managed');

  await assert.rejects(applications.approve(caseId, { confirm: true }, ctx), /not waiting for your approval/);
  await cases.check(caseId, ctxFor(meron));
  await cases.verify(caseId, ctxFor(admin));
  await assert.rejects(applications.approve(caseId, {}, ctx), /Confirm/);
  const approved = await applications.approve(caseId, { confirm: true }, ctx);
  assert.equal(approved.status, 'approved');
  assert.deepEqual(approved.checks, { abol: true, tona: true, baraka: true });
  assert.equal((await cases.get(caseId)).checks.baraka.method, 'online');

  // The applicant view never carries staff names or card data.
  const json = JSON.stringify(await applications.get(caseId));
  assert.ok(!json.includes('Meron') && !json.includes('cardId'));
});

test('applicants cannot open staff-created cases', async () => {
  const env = await setupCases();
  const { meron } = await seedStaff(env);
  const c = await env.cases.create(applicantInput(), ctxFor(meron));
  await assert.rejects(env.applications.get(c.id), /not found/);
});

test('removing a child moves the other children\'s photos with them, never to someone else', async () => {
  const env = await setupCases();
  const kids = [person({ firstName: 'Red', birthDate: '2015-01-01' }), person({ firstName: 'Blue', birthDate: '2017-01-01' })];
  const input = { package: 'self', applicant: applicantInput({ children: kids }) };
  const { caseId, application } = await env.applications.start(input, ctx);
  const red = fakeJpeg(600, 600, 300);
  const blue = fakeJpeg(600, 600, 400);
  await env.applications.savePhoto(caseId, 'child0', red, ctx);
  await env.applications.savePhoto(caseId, 'child1', blue, ctx);

  // Remove Red: Blue becomes child0 and keeps Blue's photo.
  const after = await env.applications.update(caseId, { ...input, applicant: { ...input.applicant, children: [kids[1]] }, expectedUpdatedAt: application.updatedAt }, ctx);
  assert.deepEqual(after.photos.map((p) => [p.key, p.uploaded]), [['applicant', false], ['child0', true]]);
  assert.equal((await env.applications.getPhoto(caseId, 'child0')).length, blue.length);

  // A save from an older copy of the form (another tab) is refused instead of undoing this change.
  await assert.rejects(env.applications.update(caseId, { ...input, expectedUpdatedAt: application.updatedAt }, ctx), /changed in another tab/);
});
