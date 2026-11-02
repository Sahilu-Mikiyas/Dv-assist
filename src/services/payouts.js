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

export function payoutService({ partnerRepo, caseRepo, audit, notifications = QUIET, commissionEtb = null }) {
  const requireAdmin = (ctx) => {
    if (ctx?.staff?.role !== 'admin') throw new ForbiddenError('Admins only');
  };
  const record = (action, ctx, detail) => audit.record({ action, ip: ctx.ip, staffId: ctx.staff?.id, detail });

  // Submitted referrals not yet in a payout.
  async function unpaidCases(partnerId) {
    const items = await partnerRepo.payoutItems(partnerId);
    return (await caseRepo.listByPartner(partnerId)).filter((c) => c.status === STATUS.SUBMITTED && !items.has(c.id));
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
      const owed = [];
      for (const p of partners) {
        const unpaid = await unpaidCases(p.id);
        if (unpaid.length) {
          owed.push({
            partnerId: p.id, organisation: p.organisation, status: p.status, payTo: p.payoutPhone, entries: unpaid.length,
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
      if (commissionEtb == null) throw new ValidationError(['Set the commission (PARTNER_COMMISSION_ETB) before paying partners']);
      const partner = await partnerRepo.get(partnerId);
      if (!partner) throw new NotFoundError('Partner not found');
      if ((await partnerRepo.payouts(partnerId)).some((p) => p.status === 'pending')) {
        throw new ValidationError(['This partner already has a payout waiting to be paid']);
      }
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
