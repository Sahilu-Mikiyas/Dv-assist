import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ECONOMICS } from '../src/domain/economics.js';
import { applicantInput, ctxFor, fakeJpeg, fakePassport, seedStaff, setupCases } from './helpers.js';

const ctx = { ip: '203.0.113.2' };

async function newPartner(env, admin, organisation, phone) {
  await env.partners.apply({ name: 'Owner', organisation, type: 'other', phone, city: 'Addis Ababa', payoutPhone: phone, agree: true }, ctx);
  const p = (await env.partners.list(ctxFor(admin))).find((x) => x.organisation === organisation);
  const { code } = await env.partners.issueCode(p.id, ctxFor(admin));
  return env.partners.activeById(await env.partners.signIn(code));
}

async function submittedPaid(env, admin, meron, { ref, amountEtb = 1500, pay = true } = {}) {
  const { caseId } = await env.applications.start({ package: 'managed', applicant: applicantInput(), ref }, ctx);
  await env.applications.savePhoto(caseId, 'applicant', fakeJpeg(), ctx);
  await env.applications.saveDocument(caseId, 'passport', fakePassport(), ctx);
  await env.applications.send(caseId, ctx);
  await env.cases.check(caseId, ctxFor(meron));
  await env.cases.verify(caseId, ctxFor(admin));
  await env.applications.approve(caseId, { confirm: true }, ctx);
  await env.cases.issueCard(caseId, ctxFor(admin));
  await env.cases.submit(caseId, '2028ABCD1234EFGH', ctxFor(admin));
  if (pay) await env.cases.recordPayment(caseId, { amountEtb, method: 'telebirr', reference: `TX${caseId.slice(0, 8)}` }, ctxFor(meron));
  return caseId;
}

test('a revenue-share partner earns their share of every stream, is paid the balance, and refunds come off later', async () => {
  const env = await setupCases({ commissionEtb: null });
  const { admin, meron } = await seedStaff(env);
  const ermiyas = await newPartner(env, admin, 'Ermiyas Abera', '0911000010');
  const tech = await newPartner(env, admin, 'Haile Cafe', '0911000020');

  await assert.rejects(env.partners.setDeal(ermiyas.id, { kind: 'revenue_share', deal: { directPct: 55, throughUsPct: 23.5 } }, ctxFor(meron)), /Admins only/);
  await env.partners.setDeal(ermiyas.id, { kind: 'revenue_share', deal: { directPct: 55, throughUsPct: 23.5 } }, ctxFor(admin));
  const rs = await env.partners.activeById(ermiyas.id);
  assert.equal(rs.kind, 'revenue_share');

  const d1 = await submittedPaid(env, admin, meron, { ref: rs.refCode });
  await submittedPaid(env, admin, meron, { ref: rs.refCode });
  await submittedPaid(env, admin, meron, { ref: tech.refCode });
  await submittedPaid(env, admin, meron, { ref: rs.refCode, pay: false }); // not counted until paid

  let account = await env.partners.revenueShare(rs);
  assert.equal(account.streams.direct.applicants, 2);
  assert.equal(account.streams.throughUs.applicants, 1);
  assert.equal(account.streams.direct.netProfit, 2 * 524);
  assert.equal(account.streams.throughUs.netProfit, 184); // tech-centre commission counted as a cost
  assert.equal(account.pipeline.awaitingPayment, 1);
  const expected = Math.round(1048 * 0.55) + Math.round(184 * 0.235);
  assert.equal(account.balanceEtb, expected);

  // The report shows the revenue share, not a per-entry commission.
  const report = await env.partners.report(ctxFor(admin));
  assert.equal(report.partners.find((r) => r.kind === 'revenue_share').earnings.earnedEtb, expected);

  // Payout of the balance, then paid.
  let overview = await env.payouts.overview(ctxFor(admin));
  assert.equal(overview.owed.find((o) => o.partnerId === rs.id).amountEtb, expected);
  const payout = await env.payouts.create(rs.id, ctxFor(admin));
  assert.equal(payout.amountEtb, expected);
  await env.payouts.markPaid(payout.id, { reference: 'ERM12345' }, ctxFor(admin));
  await assert.rejects(env.payouts.create(rs.id, ctxFor(admin)), /Nothing is owed/);

  // A refund after payout: the applicant stops counting and the difference comes off future earnings.
  await assert.rejects(env.cases.refundPayment(d1, 'changed mind', ctxFor(meron)), /Only an admin/);
  await assert.rejects(env.cases.refundPayment(d1, '', ctxFor(admin)), /Say why/);
  await env.cases.refundPayment(d1, 'Applicant withdrew', ctxFor(admin));
  account = await env.partners.revenueShare(rs);
  assert.equal(account.streams.direct.applicants, 1);
  assert.equal(account.pipeline.refunded, 1);
  assert.ok(account.balanceEtb < 0);
  await assert.rejects(env.payouts.create(rs.id, ctxFor(admin)), /refunds leave/);

  // More direct applicants earn it back.
  await submittedPaid(env, admin, meron, { ref: rs.refCode });
  await submittedPaid(env, admin, meron, { ref: rs.refCode });
  account = await env.partners.revenueShare(rs);
  assert.equal(account.balanceEtb, Math.round(3 * 524 * 0.55) + Math.round(184 * 0.235) - expected);
  overview = await env.payouts.overview(ctxFor(admin));
  assert.equal(overview.owed.find((o) => o.partnerId === rs.id).amountEtb, account.balanceEtb);
});

test('admins set the cost figures; the tech-centre commission follows them once saved', async () => {
  const env = await setupCases({ commissionEtb: null });
  const { admin, meron } = await seedStaff(env);
  let current = await env.economics.current();
  assert.equal(current.saved, false);
  assert.deepEqual(current.values, DEFAULT_ECONOMICS);
  assert.equal(await env.economics.techCenterCommission(), null);

  await assert.rejects(env.economics.save({ ...DEFAULT_ECONOMICS }, ctxFor(meron)), /Admins only/);
  current = await env.economics.save({ ...DEFAULT_ECONOMICS, paymentCostEtb: 240, techCenterCommissionEtb: 250 }, ctxFor(admin));
  assert.equal(current.saved, true);
  assert.equal(current.updatedBy, 'Admin');
  assert.equal(await env.economics.techCenterCommission(), 250);
  assert.equal((await env.payouts.overview(ctxFor(admin))).commissionEtb, 250);
});
