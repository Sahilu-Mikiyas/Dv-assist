import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ECONOMICS } from '../src/domain/economics.js';
import { applicantInput, approvedCase, ctxFor, fakeChannel, fakeJpeg, fakePassport, seedStaff, setupCases } from './helpers.js';

const ctx = { ip: '203.0.113.8' };
const settle = (p) => p.then(() => 'ok', (e) => e.message);

async function partner(env, admin, organisation, phone) {
  await env.partners.apply({ name: 'Owner', organisation, type: 'shop', phone, city: 'Adama', payoutPhone: phone, agree: true }, ctx);
  const p = (await env.partners.list(ctxFor(admin))).find((x) => x.organisation === organisation);
  const { code } = await env.partners.issueCode(p.id, ctxFor(admin));
  return env.partners.activeById(await env.partners.signIn(code));
}

async function paidSubmitted(env, admin, meron, ref, amountEtb = 1500) {
  const { caseId } = await env.applications.start({ package: 'managed', applicant: applicantInput(), ref }, ctx);
  await env.applications.savePhoto(caseId, 'applicant', fakeJpeg(), ctx);
  await env.applications.saveDocument(caseId, 'passport', fakePassport(), ctx);
  await env.applications.send(caseId, ctx);
  await env.cases.check(caseId, ctxFor(meron));
  await env.cases.verify(caseId, ctxFor(admin));
  await env.applications.approve(caseId, { confirm: true }, ctx);
  await env.cases.issueCard(caseId, ctxFor(admin));
  await env.cases.submit(caseId, '2028ABCD1234EFGH', ctxFor(admin));
  await env.cases.recordPayment(caseId, { amountEtb, method: 'cash' }, ctxFor(meron));
  return caseId;
}

test('payouts: two creates, two mark-paids or a paid and a cancel at once — only one wins, one message', async () => {
  const sms = fakeChannel('sms');
  const env = await setupCases({ sms });
  const { admin, meron } = await seedStaff(env);
  const rs = await partner(env, admin, 'Ermiyas', '0911000010');
  await env.partners.setDeal(rs.id, { kind: 'revenue_share', deal: { directPct: 55, throughUsPct: 23.5 } }, ctxFor(admin));
  await paidSubmitted(env, admin, meron, rs.refCode);
  const created = await Promise.all([settle(env.payouts.create(rs.id, ctxFor(admin))), settle(env.payouts.create(rs.id, ctxFor(admin)))]);
  assert.equal(created.filter((r) => r === 'ok').length, 1);
  assert.ok(created.includes('This partner already has a payout waiting to be paid'));
  const [payout] = (await env.payouts.overview(ctxFor(admin))).payouts;
  const settled = await Promise.all([
    settle(env.payouts.markPaid(payout.id, { reference: 'FIRST11111' }, ctxFor(admin))),
    settle(env.payouts.markPaid(payout.id, { reference: 'SECOND2222' }, ctxFor(admin))),
    settle(env.payouts.cancel(payout.id, ctxFor(admin))),
  ]);
  assert.equal(settled.filter((r) => r === 'ok').length, 1);
  await env.notifications.deliverDue();
  assert.ok(sms.sent.filter((m) => /we sent/.test(m.text)).length <= 1);
});

test('submit, reopen and erase cannot race a card being issued or each other', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const c = await approvedCase(env.cases, meron, admin);
  const issuing = env.cases.issueCard(c.id, ctxFor(admin));
  assert.match(await settle(env.cases.reopen(c.id, 'x', ctxFor(admin))), /being issued/);
  assert.match(await settle(env.retention.eraseOne(c.id, ctxFor(admin))), /being issued/);
  await issuing;
  const submits = await Promise.all([settle(env.cases.submit(c.id, '2028AAAA1111AAAA', ctxFor(admin))), settle(env.cases.submit(c.id, '2028BBBB2222BBBB', ctxFor(admin)))]);
  assert.deepEqual(submits.filter((r) => r === 'ok').length, 1);
});

test('staff cannot record an "online" approval; that is the applicant\'s own', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const c = await env.cases.create(applicantInput(), ctxFor(meron));
  await env.cases.savePhoto(c.id, 'applicant', fakeJpeg(), ctxFor(meron));
  await env.cases.saveDocument(c.id, 'passport', fakePassport(), ctxFor(meron));
  await env.cases.check(c.id, ctxFor(meron));
  await env.cases.verify(c.id, ctxFor(admin));
  await assert.rejects(env.cases.approve(c.id, 'online', ctxFor(admin)), /given by the applicant/);
});

test('revenue share: no switch back after payouts, no overlap between two revenue-share partners, cost changes are not retroactive', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const alpha = await partner(env, admin, 'Alpha', '0911000011');
  const beta = await partner(env, admin, 'Beta', '0911000012');
  for (const p of [alpha, beta]) await env.partners.setDeal(p.id, { kind: 'revenue_share', deal: { directPct: 60, throughUsPct: 23.5 } }, ctxFor(admin));
  await paidSubmitted(env, admin, meron, alpha.refCode);
  const a = await env.partners.revenueShare(await env.partners.activeById(alpha.id));
  const b = await env.partners.revenueShare(await env.partners.activeById(beta.id));
  assert.equal(a.streams.direct.share, Math.round(524 * 0.6));
  assert.equal(b.countedApplicants, 0); // Alpha's applicant is not "through us" for Beta

  const payout = await env.payouts.create(alpha.id, ctxFor(admin));
  await env.payouts.markPaid(payout.id, { reference: 'ALPHA12345' }, ctxFor(admin));
  await assert.rejects(env.partners.setDeal(alpha.id, { kind: 'tech_center' }, ctxFor(admin)), /pay the same applicants twice/);

  await env.economics.save({ ...DEFAULT_ECONOMICS, paymentCostEtb: 1400 }, ctxFor(admin));
  const after = await env.partners.revenueShare(await env.partners.activeById(alpha.id));
  assert.equal(after.totalShare, a.totalShare); // the applicant keeps the costs they were counted with
  assert.equal(after.balanceEtb, 0);
  assert.equal(after.economics.paymentCostEtb, 1400); // new applicants use the new figure
});

test('a paid but unsent website entry is not erased by the unsent rule; a used invitation counts once', async () => {
  const env = await setupCases({ retentionPolicy: { unsentDays: 1 } });
  const { admin, meron } = await seedStaff(env);
  const { caseId } = await env.applications.start({ package: 'vip', applicant: applicantInput() }, ctx);
  await env.cases.recordPayment(caseId, { amountEtb: 3000, method: 'cash' }, ctxFor(meron));
  env.advanceClock(3 * 24 * 60 * 60 * 1000);
  assert.equal((await env.retention.run()).unsent, 0);

  const p = await partner(env, admin, 'Haile', '0911000013');
  const { reference } = await env.partners.introduce(p, { name: 'Meseret', phone: '0922000111', people: 1, package: 'self', consent: true }, ctx);
  await env.applications.start({ package: 'self', applicant: applicantInput(), invite: reference }, ctx);
  await env.applications.start({ package: 'self', applicant: applicantInput(), invite: reference }, ctx);
  const hows = (await env.partners.statement(p)).rows.map((r) => r.how).sort();
  assert.deepEqual(hows, ['introduced', 'link']);
});
