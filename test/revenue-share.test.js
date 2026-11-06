import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ECONOMICS, directPctFor, validateDeal, validateEconomics } from '../src/domain/economics.js';
import { computeRevenueShare } from '../src/domain/revenue-share.js';

const ERMIYAS = 'p-ermiyas';
const TECH = 'p-tech';
let n = 0;
const kase = (overrides = {}) => ({ id: `c${++n}`, caseNumber: n, partnerId: null, source: 'website', package: 'managed', status: 'submitted', sentAt: '2026-11-01', submittedAt: '2026-11-03T10:00:00Z', ...overrides });
const paid = (amountEtb = 1500, extra = {}) => ({ amountEtb, method: 'telebirr', receivedAt: '2026-11-02T09:00:00Z', refundedAt: null, ...extra });

function account(cases, payments, { deal = { directPct: 55, throughUsPct: 23.5, ladder: null }, payouts = [] } = {}) {
  return computeRevenueShare({
    partnerId: ERMIYAS, deal, economics: DEFAULT_ECONOMICS, cases, payments: new Map(payments), techCenterIds: new Set([TECH]), payouts,
  });
}

test("reproduces the offer's Model A figures: 524 ETB net per direct applicant, 184 through us", () => {
  const direct = Array.from({ length: 3 }, () => kase({ partnerId: ERMIYAS }));
  const through = Array.from({ length: 8 }, () => kase({ partnerId: TECH }));
  const all = [...direct, ...through];
  const a = account(all, all.map((c) => [c.id, paid()]));
  assert.equal(a.streams.direct.applicants, 3);
  assert.equal(a.streams.direct.netProfit, 3 * 524);
  assert.equal(a.streams.throughUs.netProfit, 8 * 184);
  assert.deepEqual(a.streams.throughUs.costs, { payment: 7200, collection: 120, commission: 2400, marketing: 320, support: 160, development: 328 });
  assert.equal(a.streams.direct.share, Math.round(3 * 524 * 0.55)); // 865
  assert.equal(a.streams.throughUs.share, Math.round(8 * 184 * 0.235)); // 346
  assert.equal(a.totalShare, 865 + 346);
  assert.equal(a.balanceEtb, 1211);
  assert.deepEqual(a.channels, { techCentres: 8, website: 0, office: 0, otherPartners: 0 });
  assert.equal(a.months.length, 1);
  assert.equal(a.months[0].month, '2026-11');
});

test('counts only cleared and submitted applicants, and uses what each actually paid', () => {
  const cases = [
    kase({ partnerId: ERMIYAS }), // counts, paid 3,000 (VIP)
    kase({ partnerId: ERMIYAS, status: 'approved', submittedAt: null }), // paid, not yet submitted
    kase({ partnerId: ERMIYAS }), // submitted, not paid
    kase({ partnerId: ERMIYAS }), // refunded
    kase({ source: 'staff' }), // office, counts as through us, no tech-centre commission
  ];
  const a = account(cases, [
    [cases[0].id, paid(3000)], [cases[1].id, paid()], [cases[3].id, paid(1500, { refundedAt: '2026-11-04' })], [cases[4].id, paid()],
  ]);
  assert.equal(a.streams.direct.applicants, 1);
  assert.equal(a.streams.direct.revenue, 3000);
  assert.equal(a.streams.direct.netProfit, 3000 - 900 - 30 - 20 - 41);
  assert.equal(a.streams.throughUs.netProfit, 1500 - 900 - 15 - 40 - 20 - 41);
  assert.deepEqual(a.pipeline, { inProgress: 0, awaitingPayment: 1, awaitingSubmission: 1, refunded: 1 });
  assert.deepEqual(a.channels, { techCentres: 0, website: 0, office: 1, otherPartners: 0 });
});

test('never shares a loss, and refunds of paid-out applicants come off the balance', () => {
  const cases = [kase({ partnerId: ERMIYAS }), kase({ partnerId: ERMIYAS })];
  // A 500 ETB package loses money under Model A: no negative share.
  let a = account(cases, [[cases[0].id, paid(500)], [cases[1].id, paid(500)]]);
  assert.ok(a.streams.direct.netProfit < 0);
  assert.equal(a.streams.direct.share, 0);

  a = account(cases, [[cases[0].id, paid()], [cases[1].id, paid(1500, { refundedAt: '2026-11-05' })]], {
    payouts: [{ amountEtb: 576, status: 'paid' }, { amountEtb: 10, status: 'cancelled' }],
  });
  assert.equal(a.totalShare, Math.round(524 * 0.55));
  assert.equal(a.paidEtb, 576);
  assert.equal(a.balanceEtb, 288 - 576);
});

test('the ladder sets the direct share for all direct applicants', () => {
  const deal = validateDeal({ directPct: 55, throughUsPct: 23.5, ladder: [{ from: 1000, pct: 55 }, { from: 0, pct: 45 }, { from: 5000, pct: 60 }] });
  assert.deepEqual(deal.ladder.map((t) => t.from), [0, 1000, 5000]);
  assert.equal(directPctFor(deal, 999), 45);
  assert.equal(directPctFor(deal, 1000), 55);
  assert.equal(directPctFor(deal, 5000), 60);
  assert.throws(() => validateDeal({ directPct: 150, throughUsPct: 20 }), /Direct share/);
  assert.throws(() => validateDeal({ directPct: 55, throughUsPct: 20, ladder: [{ from: 10, pct: 50 }] }), /start from 0/);
  assert.throws(() => validateEconomics({ ...DEFAULT_ECONOMICS, collectionFeePct: 80 }), /collectionFeePct/);
});
