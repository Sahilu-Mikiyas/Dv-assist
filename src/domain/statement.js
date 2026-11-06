// A partner's statement: every person they referred, grouped every useful way, and what they have earned,
// been paid and are owed. Pure: built from records the caller loads. The same statement feeds the
// partner's dashboard, their statement page and the admins' report, so the numbers always agree.

import { PACKAGES } from './case.js';
import { referralStage } from './partner.js';

export const STAGES = ['invited', 'started', 'checking', 'filing', 'submitted'];
export const HOW = ['link', 'introduced', 'together'];

const fullName = (a) => [a.firstName, a.lastName].filter(Boolean).join(' ') || a.lastName || '—';
const peopleIn = (a) => 1 + (a.spouse ? 1 : 0) + (a.children?.length ?? 0);
const tally = (keys, rows, pick) => Object.fromEntries(keys.map((k) => [k, rows.filter((r) => pick(r) === k).length]));

// cases: the partner's cases. introductions: theirs, including started ones. payoutItems: Map case id →
// { payoutId, amountEtb, status }. payments: Map case id → applicant payment. payouts: their payouts.
export function buildStatement({ cases, introductions, payoutItems, payments, payouts, commissionEtb, codeOf }) {
  const caseRows = cases.map((c) => {
    const stage = referralStage(c);
    const item = payoutItems.get(c.id);
    const commission = stage !== 'submitted' ? null : {
      status: item ? { paid: 'paid', pending: 'waiting' }[item.status] : 'due',
      amountEtb: item ? item.amountEtb : commissionEtb,
      payoutId: item?.payoutId ?? null,
    };
    return {
      caseId: c.id,
      code: codeOf(c.caseNumber),
      name: fullName(c.applicant),
      people: peopleIn(c.applicant),
      package: c.package,
      how: c.filledTogether ? 'together' : c.introductionId ? 'introduced' : 'link',
      stage,
      applicantPaid: Boolean(payments.get(c.id) && !payments.get(c.id).refundedAt),
      startedAt: c.createdAt,
      submittedAt: c.submittedAt ?? null,
      commission,
      // Kept for the dashboard table.
      earning: commission?.amountEtb ?? null,
      payout: commission?.status ?? null,
      at: c.createdAt,
    };
  });
  const inviteRows = introductions.filter((i) => !i.caseId).map((i) => ({
    caseId: null, code: null, name: i.name, people: i.people, package: i.package, how: 'introduced', stage: 'invited',
    applicantPaid: false, startedAt: null, submittedAt: null, commission: null, earning: null, payout: null, at: i.createdAt,
  }));
  const rows = [...caseRows, ...inviteRows].sort((a, b) => b.at.localeCompare(a.at));

  const live = payouts.filter((p) => p.status !== 'cancelled');
  const paidEtb = live.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amountEtb, 0);
  const waitingEtb = live.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amountEtb, 0);
  const due = caseRows.filter((r) => r.commission?.status === 'due');
  const dueEtb = due.length && commissionEtb == null ? null : due.length * (commissionEtb ?? 0);
  const codesByPayout = new Map();
  for (const r of caseRows) {
    if (r.commission?.payoutId) codesByPayout.set(r.commission.payoutId, [...(codesByPayout.get(r.commission.payoutId) ?? []), r.code]);
  }

  return {
    rows,
    totals: {
      referrals: rows.length,
      people: rows.reduce((s, r) => s + r.people, 0),
      // Processing: started and not yet submitted. Processed: submitted.
      processing: rows.filter((r) => ['started', 'checking', 'filing'].includes(r.stage)).length,
      processed: rows.filter((r) => r.stage === 'submitted').length,
    },
    byStage: tally(STAGES, rows, (r) => r.stage),
    byPackage: tally(PACKAGES, rows, (r) => r.package),
    byHow: tally(HOW, rows, (r) => r.how),
    payments: {
      paid: caseRows.filter((r) => r.applicantPaid).length,
      notPaid: caseRows.filter((r) => !r.applicantPaid).length,
    },
    earnings: {
      commissionEtb,
      submittedEntries: caseRows.filter((r) => r.stage === 'submitted').length,
      paidEtb,
      waitingEtb,
      dueEntries: due.length,
      dueEtb,
      owedEtb: dueEtb == null ? null : waitingEtb + dueEtb,
      earnedEtb: dueEtb == null ? null : paidEtb + waitingEtb + dueEtb,
    },
    payouts: live.map((p) => ({
      amountEtb: p.amountEtb, entries: p.entries, rateEtb: p.rateEtb, status: p.status, reference: p.reference,
      createdAt: p.createdAt, settledAt: p.settledAt, at: p.settledAt ?? p.createdAt, codes: (codesByPayout.get(p.id) ?? []).sort(),
    })),
  };
}
