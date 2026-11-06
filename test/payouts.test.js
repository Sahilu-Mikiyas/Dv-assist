import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicantInput, ctxFor, fakeChannel, fakeJpeg, fakePassport, seedStaff, setupCases } from './helpers.js';

const ctx = { ip: '203.0.113.4' };

async function partnerWithSubmissions(env, admin, meron, count) {
  await env.partners.apply({ name: 'Tigist Haile', organisation: 'Haile Cafe', type: 'shop', phone: '0911000000', city: 'Adama', payoutPhone: '0911000041', agree: true }, ctx);
  const [p] = await env.partners.list(ctxFor(admin));
  const { code } = await env.partners.issueCode(p.id, ctxFor(admin));
  const partner = await env.partners.activeById(await env.partners.signIn(code));
  for (let i = 0; i < count; i++) await submitReferral(env, admin, meron, partner);
  return partner;
}

async function submitReferral(env, admin, meron, partner) {
  const { caseId } = await env.applications.start({ package: 'self', applicant: applicantInput(), ref: partner.refCode }, ctx);
  await env.applications.savePhoto(caseId, 'applicant', fakeJpeg(), ctx);
  await env.applications.saveDocument(caseId, 'passport', fakePassport(), ctx);
  await env.applications.send(caseId, ctx);
  await env.cases.check(caseId, ctxFor(meron));
  await env.cases.verify(caseId, ctxFor(admin));
  await env.applications.approve(caseId, { confirm: true }, ctx);
  await env.cases.issueCard(caseId, ctxFor(admin));
  await env.cases.submit(caseId, '2028ABCD1234EFGH', ctxFor(admin));
  return caseId;
}

test('a payout covers what is owed, is paid with a Telebirr reference, and each entry is paid once', async () => {
  const sms = fakeChannel('sms');
  const env = await setupCases({ sms });
  const { admin, meron } = await seedStaff(env);
  const partner = await partnerWithSubmissions(env, admin, meron, 2);

  await assert.rejects(env.payouts.overview(ctxFor(meron)), /Admins only/);
  let overview = await env.payouts.overview(ctxFor(admin));
  assert.deepEqual(overview.owed.map((o) => [o.organisation, o.entries, o.amountEtb, o.payTo]), [['Haile Cafe', 2, 400, '+251911000041']]);

  const payout = await env.payouts.create(partner.id, ctxFor(admin));
  assert.equal(payout.amountEtb, 400);
  assert.equal(payout.status, 'pending');
  await assert.rejects(env.payouts.create(partner.id, ctxFor(admin)), /already has a payout waiting/);

  let board = await env.partners.dashboard(partner);
  assert.deepEqual([board.paidEtb, board.owedEtb, board.earned], [0, 400, 400]);
  assert.ok(board.referrals.every((r) => r.payout === 'waiting'));

  await assert.rejects(env.payouts.markPaid(payout.id, { reference: '12' }, ctxFor(admin)), /transaction number/);
  const paid = await env.payouts.markPaid(payout.id, { reference: ' bkj4f2t9xq ' }, ctxFor(admin));
  assert.equal(paid.status, 'paid');
  assert.equal(paid.reference, 'BKJ4F2T9XQ');
  assert.equal(paid.settledBy, 'Admin');
  await assert.rejects(env.payouts.cancel(payout.id, ctxFor(admin)), /already paid/);

  // A new submission is owed on its own; the paid ones never come back.
  await submitReferral(env, admin, meron, partner);
  overview = await env.payouts.overview(ctxFor(admin));
  assert.equal(overview.owed[0].entries, 1);
  board = await env.partners.dashboard(partner);
  assert.deepEqual([board.paidEtb, board.owedEtb, board.earned], [400, 200, 600]);
  assert.deepEqual(board.referrals.map((r) => r.payout).sort(), ['due', 'paid', 'paid']);
  assert.equal(board.payouts[0].reference, 'BKJ4F2T9XQ');

  await env.notifications.deliverDue();
  const note = sms.sent.find((m) => m.text.includes('400 ETB'));
  assert.ok(note && note.to === '+251911000000' && note.text.includes('BKJ4F2T9XQ') && note.text.includes('ending 41'));
});

test('cancelling a pending payout releases its entries; no payouts without a commission rate', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const partner = await partnerWithSubmissions(env, admin, meron, 1);
  const payout = await env.payouts.create(partner.id, ctxFor(admin));
  await env.payouts.cancel(payout.id, ctxFor(admin));
  assert.equal((await env.payouts.overview(ctxFor(admin))).owed[0].entries, 1);
  const again = await env.payouts.create(partner.id, ctxFor(admin));
  assert.equal(again.entries, 1);
  await env.payouts.markPaid(again.id, { reference: 'ABC123XYZ' }, ctxFor(admin));
  await assert.rejects(env.payouts.create(partner.id, ctxFor(admin)), /Nothing is owed/);

  const unset = await setupCases({ commissionEtb: null });
  const staff = await seedStaff(unset);
  const p2 = await partnerWithSubmissions(unset, staff.admin, staff.meron, 1);
  await assert.rejects(unset.payouts.create(p2.id, ctxFor(staff.admin)), /Set the tech-centre commission/);
  const board = await unset.partners.dashboard(p2);
  assert.equal(board.earned, null);
  assert.equal(board.referrals[0].payout, 'due');
});
