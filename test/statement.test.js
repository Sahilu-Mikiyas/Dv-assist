import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicantInput, approvedCase, ctxFor, fakeJpeg, person, seedStaff, setupCases } from './helpers.js';

const ctx = { ip: '203.0.113.3' };

async function newPartner(env, admin, organisation, phone) {
  await env.partners.apply({ name: 'Owner', organisation, type: 'shop', phone, city: 'Adama', payoutPhone: phone, agree: true }, ctx);
  const p = (await env.partners.list(ctxFor(admin))).find((x) => x.organisation === organisation);
  const { code } = await env.partners.issueCode(p.id, ctxFor(admin));
  return env.partners.activeById(await env.partners.signIn(code));
}

async function through(env, admin, meron, caseId, until) {
  await env.applications.savePhoto(caseId, 'applicant', fakeJpeg(), ctx);
  for (const key of (await env.cases.get(caseId)).photos.map((p) => p.key)) await env.applications.savePhoto(caseId, key, fakeJpeg(), ctx);
  await env.applications.send(caseId, ctx);
  if (until === 'checking') return;
  await env.cases.check(caseId, ctxFor(meron));
  await env.cases.verify(caseId, ctxFor(admin));
  await env.applications.approve(caseId, { confirm: true }, ctx);
  if (until === 'filing') return;
  await env.cases.issueCard(caseId, ctxFor(admin));
  await env.cases.submit(caseId, '2028ABCD1234EFGH', ctxFor(admin));
}

test('staff record what an applicant paid; one payment per case; only admins remove one', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const c = await env.cases.create(applicantInput(), ctxFor(meron));
  await assert.rejects(env.cases.recordPayment(c.id, { amountEtb: 1500, method: 'telebirr' }, ctxFor(meron)), /transaction number/);
  await assert.rejects(env.cases.recordPayment(c.id, { amountEtb: -5, method: 'gold' }, ctxFor(meron)), /Amount.*how they paid/s);
  const paid = await env.cases.recordPayment(c.id, { amountEtb: 1500, method: 'telebirr', reference: 'bkj4f2t9' }, ctxFor(meron));
  assert.deepEqual([paid.payment.amountEtb, paid.payment.reference, paid.payment.recordedBy], [1500, 'BKJ4F2T9', 'Meron']);
  await assert.rejects(env.cases.recordPayment(c.id, { amountEtb: 100, method: 'cash' }, ctxFor(meron)), /already recorded/);
  await assert.rejects(env.cases.removePayment(c.id, ctxFor(meron)), /Only an admin/);
  assert.equal((await env.cases.removePayment(c.id, ctxFor(admin))).payment, null);
  assert.equal((await env.cases.recordPayment(c.id, { amountEtb: 1500, method: 'cash' }, ctxFor(meron))).payment.method, 'cash');
});

test("a partner's statement counts every referral, payment and birr, and shows no other partner's people", async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const haile = await newPartner(env, admin, 'Haile Cafe', '0911000001');
  const other = await newPartner(env, admin, 'Other Shop', '0911000002');

  const start = (p, extra = {}, applicant = {}) => env.applications.start({ package: 'managed', applicant: applicantInput(applicant), ref: p.refCode, ...extra }, ctx);
  // Two submitted (one paid out), one being filed, one being checked, one only started, one invitation.
  const a = await start(haile, { package: 'vip' }, { maritalStatus: 'married_spouse_not_us_citizen_or_lpr', spouse: person({ firstName: 'Selam', gender: 'female' }), children: [person({ firstName: 'Liya' })] });
  const b = await start(haile);
  const c = await start(haile, { package: 'self' });
  const d = await start(haile, { together: true }, {});
  const e = await env.applications.start({ package: 'assisted', applicant: applicantInput(), ref: haile.refCode, together: true }, { ...ctx, partnerId: haile.id });
  await env.partners.introduce(haile, { name: 'Meseret B', phone: '0922000111', people: 2, package: 'self', consent: true }, ctx);
  await start(other); // never visible to Haile

  await through(env, admin, meron, a.caseId, 'submitted');
  await env.cases.recordPayment(a.caseId, { amountEtb: 3000, method: 'telebirr', reference: 'TX12345' }, ctxFor(meron));
  const payout = await env.payouts.create(haile.id, ctxFor(admin));
  await env.payouts.markPaid(payout.id, { reference: 'PAY123456' }, ctxFor(admin));
  await through(env, admin, meron, b.caseId, 'submitted');
  await env.cases.recordPayment(b.caseId, { amountEtb: 1500, method: 'cash' }, ctxFor(meron));
  await through(env, admin, meron, c.caseId, 'filing');
  await through(env, admin, meron, d.caseId, 'checking');
  assert.ok(e.together);

  const st = await env.partners.statement(haile);
  assert.deepEqual(st.totals, { referrals: 6, people: 3 + 1 + 1 + 1 + 1 + 2, processing: 3, processed: 2 });
  assert.deepEqual(st.byStage, { invited: 1, started: 1, checking: 1, filing: 1, submitted: 2 });
  assert.deepEqual(st.byPackage, { self: 2, managed: 2, assisted: 1, vip: 1 });
  assert.deepEqual(st.byHow, { link: 4, introduced: 1, together: 1 });
  assert.deepEqual(st.payments, { paid: 2, notPaid: 3 });
  assert.deepEqual(st.earnings, {
    commissionEtb: 200, submittedEntries: 2, paidEtb: 200, waitingEtb: 0, dueEntries: 1, dueEtb: 200, owedEtb: 200, earnedEtb: 400,
  });
  assert.deepEqual(st.payouts.map((p) => [p.amountEtb, p.reference, p.codes]), [[200, 'PAY123456', ['EDA-0001']]]);
  assert.equal(st.rows.find((r) => r.code === 'EDA-0002').commission.status, 'due');
  assert.ok(!JSON.stringify(st).includes('Other Shop') && st.rows.every((r) => !('caseId' in r)));

  // The admin report adds every partner up.
  await assert.rejects(env.partners.report(ctxFor(meron)), /Admins only/);
  const report = await env.partners.report(ctxFor(admin));
  assert.equal(report.partners.length, 2);
  assert.deepEqual([report.totals.referrals, report.totals.processed, report.totals.applicantsPaid], [7, 2, 2]);
  assert.deepEqual([report.totals.paidEtb, report.totals.dueEtb, report.totals.earnedEtb], [200, 200, 400]);
});
