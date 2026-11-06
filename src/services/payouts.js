// Partner payouts. Every submitted entry a partner referred earns the commission once. An admin creates a
// payout for what a partner is owed (the amount and entries are fixed then), pays it by Telebirr outside the
// app, and records the Telebirr transaction number. A pending payout can be cancelled, releasing its entries.

import { randomUUID } from 'node:crypto';
import { STATUS, ValidationError } from '../domain/case.js';
import { NotFoundError, caseCode } from './cases.js';
import { ForbiddenError } from './staff.js';

const QUIET = { notify: async () => {} };
// Telebirr transaction numbers are letters and digits, e.g. "BKJ4F2T9XQ".
const REFERENCE = /^[A-Z0-9]{6,30}$/;

// `commission()`: tech-centre rate per submitted entry. `revenueShare(partner)`: a revenue-share partner's
// account (see partners service), whose balance is what they are owed.
export function payoutService({
  partnerRepo, caseRepo, audit, notifications = QUIET, commissionEtb = null, commission = async () => commissionEtb,
  revenueShare = async () => null,
}) {
  const requireAdmin = (ctx) => {
    if (ctx?.staff?.role !== 'admin') throw new ForbiddenError('Admins only');
  };
  const record = (action, ctx, detail) => audit.record({ action, ip: ctx.ip, staffId: ctx.staff?.id, detail });

  // Submitted referrals not yet in a payout.
  async function unpaidCases(partnerId) {
    const items = await partnerRepo.payoutItems(partnerId);
    return (await caseRepo.listByPartner(partnerId)).filter((c) => c.status === STATUS.SUBMITTED && !items.has(c.id));
  }

  // A revenue-share payout is the balance owed now: the share earned so far, less what was paid or is being paid.
  async function createRevenueSharePayout(partner, ctx) {
    const account = await revenueShare(partner);
    if (!account) throw new ValidationError(['Set this partner\'s revenue-share terms first']);
    if (account.balanceEtb <= 0) {
      throw new ValidationError([account.balanceEtb < 0
        ? `Nothing to pay: refunds leave ${-account.balanceEtb} ETB to come off future earnings`
        : 'Nothing is owed to this partner']);
    }
    const id = randomUUID();
    await partnerRepo.insertPayout({
      id, partnerId: partner.id, rateEtb: 0, caseIds: [], payTo: partner.payoutPhone, createdBy: ctx.staff.name,
      amountEtb: account.balanceEtb, entries: account.countedApplicants,
    });
    await record('payout_created', ctx, `${partner.refCode} revenue share ${account.balanceEtb} ETB`);
    return partnerRepo.payout(id);
  }

  async function mustGetPayout(id) {
    const payout = await partnerRepo.payout(id);
    if (!payout) throw new NotFoundError('Payout not found');
    if (payout.status !== 'pending') throw new ValidationError([`This payout is already ${payout.status}`]);
    return payout;
  }

  return {
    // Admin overview: what each partner is owed now, and every payout.
    async overview(ctx) {
      requireAdmin(ctx);
      const partners = await partnerRepo.list();
      const names = new Map(partners.map((p) => [p.id, p.organisation]));
      const commissionEtb = await commission();
      const owed = [];
      for (const p of partners) {
        if (p.kind === 'revenue_share') {
          const account = await revenueShare(p);
          if (account && account.balanceEtb !== 0) {
            owed.push({
              partnerId: p.id, organisation: p.organisation, status: p.status, payTo: p.payoutPhone, kind: 'revenue_share',
              entries: account.countedApplicants, amountEtb: account.balanceEtb, cases: [],
            });
          }
          continue;
        }
        const unpaid = await unpaidCases(p.id);
        if (unpaid.length) {
          owed.push({
            partnerId: p.id, organisation: p.organisation, status: p.status, payTo: p.payoutPhone, kind: 'tech_center', entries: unpaid.length,
            amountEtb: commissionEtb == null ? null : unpaid.length * commissionEtb,
            cases: unpaid.map((c) => caseCode(c.caseNumber)),
          });
        }
      }
      const payouts = (await partnerRepo.payouts()).map((p) => ({ ...p, organisation: names.get(p.partnerId) ?? '—' }));
      return { commissionEtb, owed, payouts };
    },

    async create(partnerId, ctx) {
      requireAdmin(ctx);
      const partner = await partnerRepo.get(partnerId);
      if (!partner) throw new NotFoundError('Partner not found');
      if ((await partnerRepo.payouts(partnerId)).some((p) => p.status === 'pending')) {
        throw new ValidationError(['This partner already has a payout waiting to be paid']);
      }
      if (partner.kind === 'revenue_share') return createRevenueSharePayout(partner, ctx);
      const commissionEtb = await commission();
      if (commissionEtb == null) throw new ValidationError(['Set the tech-centre commission (Costs page) before paying partners']);
      const unpaid = await unpaidCases(partnerId);
      if (!unpaid.length) throw new ValidationError(['Nothing is owed to this partner']);
      const id = randomUUID();
      await partnerRepo.insertPayout({
        id, partnerId, rateEtb: commissionEtb, caseIds: unpaid.map((c) => c.id), payTo: partner.payoutPhone, createdBy: ctx.staff.name,
      });
      await record('payout_created', ctx, `${partner.refCode} ${unpaid.length} × ${commissionEtb} ETB`);
      return partnerRepo.payout(id);
    },

    async markPaid(id, { reference } = {}, ctx) {
      requireAdmin(ctx);
      const payout = await mustGetPayout(id);
      const ref = String(reference ?? '').trim().toUpperCase().replace(/\s+/g, '');
      if (!REFERENCE.test(ref)) throw new ValidationError(['Enter the Telebirr transaction number (letters and digits)']);
      await partnerRepo.settlePayout(id, { status: 'paid', reference: ref, settledBy: ctx.staff.name });
      await record('payout_paid', ctx, `${payout.amountEtb} ETB ${ref}`);
      const partner = await partnerRepo.get(payout.partnerId);
      await notifications.notify('payout_paid', {
        partnerId: partner.id, phone: partner.phone,
        data: { amountEtb: payout.amountEtb, entries: payout.entries, reference: ref, ending: payout.payTo.slice(-2) },
      });
      return partnerRepo.payout(id);
    },

    async cancel(id, ctx) {
      requireAdmin(ctx);
      const payout = await mustGetPayout(id);
      await partnerRepo.settlePayout(id, { status: 'cancelled', settledBy: ctx.staff.name });
      await record('payout_cancelled', ctx, `${payout.amountEtb} ETB`);
      return partnerRepo.payout(id);
    },

    // CSV rows for bookkeeping.
    async rows(ctx) {
      return (await this.overview(ctx)).payouts;
    },
  };
}
