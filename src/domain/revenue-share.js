// A revenue-share partner's account: what counts, net profit per stream, their share, payouts and balance.
// Pure: built from records the caller loads, so the partner's dashboard, the admins' view and payouts agree.
//
// Rules (from the partnership terms):
// - An applicant counts once their payment has cleared (recorded, not refunded) AND their entry is submitted.
// - Direct: entries made through the partner's own referral account. Through us: every other counted entry.
// - Net profit per applicant = what they paid − payment cost − collection fee − tech-centre commission (if a
//   tech centre referred them) − marketing (through us only) − support − development allocation.
// - Share per stream = percentage × that stream's net profit, never below zero.
// - Refunds simply stop an applicant counting; anything already paid out comes off the next payout.

import { directPctFor } from './economics.js';

const COST_KEYS = ['payment', 'collection', 'commission', 'marketing', 'support', 'development'];
const round = (n) => Math.round(n);

function emptyStream() {
  return { applicants: 0, revenue: 0, costs: Object.fromEntries(COST_KEYS.map((k) => [k, 0])), netProfit: 0 };
}

function addApplicant(stream, revenue, costs) {
  stream.applicants += 1;
  stream.revenue += revenue;
  for (const k of COST_KEYS) stream.costs[k] += costs[k];
  stream.netProfit += revenue - COST_KEYS.reduce((s, k) => s + costs[k], 0);
}

function finish(stream, pct) {
  const costs = Object.fromEntries(COST_KEYS.map((k) => [k, round(stream.costs[k])]));
  const netProfit = round(stream.netProfit);
  return { ...stream, costs, revenue: round(stream.revenue), netProfit, pct, share: round(Math.max(0, netProfit) * pct / 100) };
}

// cases: every case (accounting fields). payments: Map case id → payment. techCenterIds: Set of tech-centre
// partner ids. payouts: this partner's payouts. monthOf: ISO date → "YYYY-MM".
export function computeRevenueShare({ partnerId, deal, economics, cases, payments, techCenterIds, payouts }) {
  const e = economics;
  const direct = emptyStream();
  const throughUs = emptyStream();
  const months = new Map();
  const pipeline = { inProgress: 0, awaitingPayment: 0, awaitingSubmission: 0, refunded: 0 };
  const channels = { techCentres: 0, website: 0, office: 0, otherPartners: 0 };

  const counted = [];
  for (const c of cases) {
    const payment = payments.get(c.id);
    const cleared = payment && !payment.refundedAt;
    const submitted = c.status === 'submitted';
    const isDirect = c.partnerId === partnerId;
    if (payment?.refundedAt) pipeline.refunded += 1;
    if (!(cleared && submitted)) {
      if (submitted && !payment) pipeline.awaitingPayment += 1;
      else if (cleared && !submitted) pipeline.awaitingSubmission += 1;
      else if (!submitted && !payment?.refundedAt && (c.source !== 'website' || c.sentAt)) pipeline.inProgress += 1;
      continue;
    }
    const revenue = payment.amountEtb;
    const viaTechCentre = Boolean(c.partnerId && techCenterIds.has(c.partnerId));
    const costs = {
      payment: e.paymentCostEtb,
      collection: revenue * e.collectionFeePct / 100,
      commission: viaTechCentre ? e.techCenterCommissionEtb : 0,
      marketing: isDirect ? 0 : e.marketingEtb,
      support: e.supportEtb,
      development: e.developmentEtb,
    };
    addApplicant(isDirect ? direct : throughUs, revenue, costs);
    if (!isDirect) {
      if (viaTechCentre) channels.techCentres += 1;
      else if (c.partnerId) channels.otherPartners += 1;
      else if (c.source === 'website') channels.website += 1;
      else channels.office += 1;
    }
    // The month an applicant counts: when both payment and submission were done.
    const month = [payment.receivedAt, c.submittedAt].filter(Boolean).sort().at(-1).slice(0, 7);
    if (!months.has(month)) months.set(month, { direct: emptyStream(), throughUs: emptyStream() });
    addApplicant(months.get(month)[isDirect ? 'direct' : 'throughUs'], revenue, costs);
    counted.push(c.id);
  }

  const directPct = directPctFor(deal, direct.applicants);
  const streams = { direct: finish(direct, directPct), throughUs: finish(throughUs, deal.throughUsPct) };
  const totalShare = streams.direct.share + streams.throughUs.share;

  const live = payouts.filter((p) => p.status !== 'cancelled');
  const paidEtb = live.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amountEtb, 0);
  const waitingEtb = live.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amountEtb, 0);

  return {
    deal,
    economics: e,
    streams,
    totalShare,
    paidEtb,
    waitingEtb,
    // Negative after refunds of applicants already paid out: it comes off later payouts.
    balanceEtb: totalShare - paidEtb - waitingEtb,
    countedApplicants: counted.length,
    // Monthly statement lines. Each month uses the season's direct percentage, so the lines add up to the
    // season total unless a stream is negative in some month (shares are never below zero).
    months: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => {
      const d = finish(m.direct, directPct);
      const t = finish(m.throughUs, deal.throughUsPct);
      return { month, direct: d, throughUs: t, share: d.share + t.share };
    }),
    pipeline,
    channels,
    payouts: live.map((p) => ({
      amountEtb: p.amountEtb, entries: p.entries, status: p.status, reference: p.reference, createdAt: p.createdAt, settledAt: p.settledAt,
    })),
  };
}
