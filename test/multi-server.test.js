// Two app servers sharing one database: the protections that matter for money and for the DV rules must hold
// across servers, not only inside one process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationService } from '../src/services/applications.js';
import { caseService } from '../src/services/cases.js';
import { applicantInput, approvedCase, ctxFor, fakeBitnob, seedStaff, setupCases } from './helpers.js';

const ctx = { ip: '203.0.113.9' };
const settle = (p) => p.then(() => 'ok', (e) => e.message);

test('two servers starting the same passport at once create one entry', async () => {
  const env = await setupCases();
  const quiet = { notify: async () => {} };
  const second = applicationService({ repo: env.caseRepo, audit: env.audit, partners: env.partners, notifications: quiet });
  const applicant = applicantInput();
  const results = await Promise.all([
    settle(env.applications.start({ package: 'managed', applicant }, ctx)),
    settle(second.start({ package: 'managed', applicant }, ctx)),
    settle(second.start({ package: 'self', applicant }, ctx)),
  ]);
  assert.equal(results.filter((r) => r === 'ok').length, 1, results.join(' | '));
  assert.ok(results.every((r) => r === 'ok' || /passport number already exists/.test(r)));
  const live = (await env.caseRepo.list()).filter((c) => c.source === 'website');
  assert.equal(live.length, 1);
});

test('editing an entry to a passport another entry holds is refused; the old number is freed', async () => {
  const env = await setupCases();
  const a = applicantInput();
  const b = applicantInput();
  const first = await env.applications.start({ package: 'managed', applicant: a }, ctx);
  const other = await env.applications.start({ package: 'managed', applicant: b }, ctx);
  assert.match(await settle(env.applications.update(other.caseId, { package: 'managed', applicant: { ...b, passportNumber: a.passportNumber } }, ctx)),
    /passport number already exists/);
  // The first entry changes its passport number: the old one can now be used by someone else.
  await env.applications.update(first.caseId, { package: 'managed', applicant: { ...a, passportNumber: 'EP7777777' } }, ctx);
  assert.equal(await settle(env.applications.start({ package: 'managed', applicant: { ...applicantInput(), passportNumber: a.passportNumber } }, ctx)), 'ok');
});

test('an erased entry frees its passport', async () => {
  const env = await setupCases();
  const a = applicantInput();
  const { caseId } = await env.applications.start({ package: 'managed', applicant: a }, ctx);
  assert.equal(await env.caseRepo.erase(caseId), true);
  assert.equal(await settle(env.applications.start({ package: 'managed', applicant: a }, ctx)), 'ok');
});

test('two servers issuing a card for one case at once issue one card', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const c = await approvedCase(env.cases, meron, admin);
  const otherBitnob = fakeBitnob();
  const second = caseService({ repo: env.caseRepo, audit: env.audit, bitnob: otherBitnob, cardAmountUsd: 5, partners: env.partners, notifications: env.notifications });
  const results = await Promise.all([settle(env.cases.issueCard(c.id, ctxFor(admin))), settle(second.issueCard(c.id, ctxFor(admin)))]);
  assert.equal(results.filter((r) => r === 'ok').length, 1, results.join(' | '));
  assert.equal(env.bitnob.calls.length + otherBitnob.calls.length, 1);
});

test('while another server issues a card, this one cannot reopen or erase the case; a failed issue can be retried', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const c = await approvedCase(env.cases, meron, admin);
  // Another server has claimed the card just now.
  assert.equal(await env.caseRepo.claimCard(c.id), true);
  assert.match(await settle(env.cases.issueCard(c.id, ctxFor(admin))), /already being issued/);
  assert.match(await settle(env.cases.reopen(c.id, 'x', ctxFor(admin))), /being issued/);
  assert.match(await settle(env.retention.eraseOne(c.id, ctxFor(admin))), /being issued/);
  assert.equal(await env.caseRepo.erase(c.id), false);
  // That server crashed: after two minutes its claim expires and the card can be issued here.
  await env.db.execute({ sql: 'UPDATE cases SET card_claimed_at = ? WHERE id = ?', args: [new Date(Date.now() - 3 * 60 * 1000).toISOString(), c.id] });
  assert.equal(await settle(env.cases.issueCard(c.id, ctxFor(admin))), 'ok');
  assert.equal(await env.caseRepo.cardBeingIssued(c.id), false);
});

test('when Bitnob fails, the claim is released at once', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const c = await approvedCase(env.cases, meron, admin);
  const createCard = env.bitnob.createCard;
  env.bitnob.createCard = async () => { throw new Error('Bitnob down'); };
  assert.match(await settle(env.cases.issueCard(c.id, ctxFor(admin))), /Bitnob down/);
  assert.equal(await env.caseRepo.cardBeingIssued(c.id), false);
  env.bitnob.createCard = createCard;
  assert.equal(await settle(env.cases.issueCard(c.id, ctxFor(admin))), 'ok');
});
