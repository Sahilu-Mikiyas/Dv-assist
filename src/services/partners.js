// Referral partners: apply, get approved by an admin, sign in with a code, introduce people, follow their
// referrals. Partners see each referral's name, package and stage, never the entry's details.

import { randomUUID } from 'node:crypto';
import { ValidationError } from '../domain/case.js';
import {
  PARTNER_STATUS,
  refCodePrefix,
  validateIntroduction,
  validatePartnerApplication,
} from '../domain/partner.js';
import { hashCode, newAccessCode, normalizeCode, randomChars } from '../infra/codes.js';
import { buildStatement } from '../domain/statement.js';
import { NotFoundError, caseCode } from './cases.js';
import { ForbiddenError } from './staff.js';

const INVITE_STALE_MS = 2 * 24 * 60 * 60 * 1000; // the team calls invitees who have not started after 2 days

const QUIET = { notify: async () => {}, smsEnabled: false };

export function partnerService({ repo, caseRepo, audit, commissionEtb = null, notifications = QUIET }) {
  const record = (action, ctx = {}, detail = null) =>
    audit.record({ action, ip: ctx.ip, staffId: ctx.staff?.id ?? null, detail });

  const requireAdmin = (ctx) => {
    if (ctx?.staff?.role !== 'admin') throw new ForbiddenError('Admins only');
  };

  async function mustGet(id) {
    const found = await repo.get(id);
    if (!found) throw new NotFoundError('Partner not found');
    return found;
  }

  async function uniqueRefCode(organisation) {
    const prefix = refCodePrefix(organisation);
    for (let i = 0; i < 20; i++) {
      const code = `${prefix}${randomChars(2)}`;
      if (!(await repo.byRefCode(code))) return code;
    }
    return `${prefix}${randomChars(6)}`;
  }

  // Everything about one partner's referrals, from every route, and their earnings (see domain/statement.js).
  async function statementOf(partnerId) {
    const cases = await caseRepo.listByPartner(partnerId);
    return buildStatement({
      cases,
      introductions: await repo.introductionsFor(partnerId),
      payoutItems: await repo.payoutItems(partnerId),
      payments: await caseRepo.paymentsFor(cases.map((c) => c.id)),
      payouts: await repo.payouts(partnerId),
      commissionEtb,
      codeOf: caseCode,
    });
  }

  const countsOf = (st) => ({ introduced: st.totals.referrals, inProgress: st.totals.processing, submitted: st.totals.processed });

  return {
    // Public: anyone can apply; an admin approves.
    async apply(input, ctx) {
      const details = validatePartnerApplication(input);
      const id = randomUUID();
      await repo.insert({ id, details, status: PARTNER_STATUS.PENDING, refCode: await uniqueRefCode(details.organisation) });
      await record('partner_applied', ctx, id);
      return { ok: true };
    },

    // Returns the partner id for a valid code of an active partner, else null.
    async signIn(code) {
      if (normalizeCode(code).length !== 12) return null;
      const partner = await repo.byAccessHash(hashCode(code));
      return partner?.status === PARTNER_STATUS.ACTIVE ? partner.id : null;
    },

    async activeById(id) {
      const partner = await repo.get(id);
      return partner?.status === PARTNER_STATUS.ACTIVE ? partner : null;
    },

    async dashboard(partner) {
      const st = await statementOf(partner.id);
      return {
        name: partner.name,
        organisation: partner.organisation,
        refCode: partner.refCode,
        payoutPhoneEnding: partner.payoutPhone.slice(-2),
        commissionEtb,
        counts: countsOf(st),
        paidEtb: st.earnings.paidEtb,
        owedEtb: st.earnings.owedEtb,
        earned: st.earnings.earnedEtb,
        payouts: st.payouts,
        referrals: st.rows.map(({ caseId, ...row }) => row),
      };
    },

    // The full statement for the partner's own statement page: nothing about other partners.
    async statement(partner) {
      const st = await statementOf(partner.id);
      return {
        organisation: partner.organisation, refCode: partner.refCode, payoutPhoneEnding: partner.payoutPhone.slice(-2),
        ...st, rows: st.rows.map(({ caseId, ...row }) => row),
      };
    },

    // Admins: every partner's statement summary side by side, with totals.
    async report(ctx) {
      requireAdmin(ctx);
      const rows = [];
      for (const p of await repo.list()) {
        const st = await statementOf(p.id);
        rows.push({
          partnerId: p.id, organisation: p.organisation, refCode: p.refCode, status: p.status,
          ...st.totals, byStage: st.byStage, byPackage: st.byPackage, byHow: st.byHow, payments: st.payments, earnings: st.earnings,
        });
      }
      const sum = (pick) => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
      const unknown = rows.some((r) => r.earnings.owedEtb == null);
      return {
        commissionEtb,
        partners: rows,
        totals: {
          partners: rows.length,
          active: rows.filter((r) => r.status === 'active').length,
          referrals: sum((r) => r.referrals),
          people: sum((r) => r.people),
          processing: sum((r) => r.processing),
          processed: sum((r) => r.processed),
          applicantsPaid: sum((r) => r.payments.paid),
          paidEtb: sum((r) => r.earnings.paidEtb),
          waitingEtb: sum((r) => r.earnings.waitingEtb),
          dueEtb: unknown ? null : sum((r) => r.earnings.dueEtb),
          earnedEtb: unknown ? null : sum((r) => r.earnings.earnedEtb),
        },
      };
    },

    async introduce(partner, input, ctx) {
      const details = validateIntroduction(input);
      const token = randomChars(8);
      await repo.insertIntroduction({ id: randomUUID(), partnerId: partner.id, token, details });
      await record('partner_introduced', ctx, `${partner.refCode} ${token}`);
      const firstName = details.name.split(/\s+/)[0];
      // Sent by SMS when we can; otherwise the partner sends the same message from their phone.
      await notifications.notify('invitation', {
        partnerId: partner.id, phone: details.phone, smsOnly: true,
        data: { firstName, organisation: partner.organisation, reference: token },
      });
      return { reference: token, firstName, phone: details.phone, sentBySms: notifications.smsEnabled };
    },

    // For the apply flow: which partner (and introduction) an entry came through, if any.
    async resolve({ ref, invite } = {}) {
      if (invite) {
        const introduction = await repo.introductionByToken(normalizeCode(invite));
        const partner = introduction && (await this.activeById(introduction.partnerId));
        if (partner) return { partner, introduction };
      }
      if (ref) {
        const partner = await repo.byRefCode(normalizeCode(ref));
        if (partner?.status === PARTNER_STATUS.ACTIVE) return { partner, introduction: null };
      }
      return null;
    },

    // Public greeting on /apply: only the organisation, the suggested package and the invitee's first name.
    async referrer(query) {
      const found = await this.resolve(query);
      if (!found) return null;
      return {
        organisation: found.partner.organisation,
        package: found.introduction?.package ?? null,
        firstName: found.introduction ? found.introduction.name.split(/\s+/)[0] : null,
      };
    },

    async linkCase(caseId, found, { together = false } = {}) {
      await caseRepo.setReferral(caseId, { partnerId: found.partner.id, introductionId: found.introduction?.id ?? null, together });
      if (found.introduction) await repo.linkIntroduction(found.introduction.id, caseId);
    },

    // ---- admin ----

    async list(ctx) {
      requireAdmin(ctx);
      const partners = await repo.list();
      return Promise.all(partners.map(async (p) => ({ ...p, counts: countsOf(await statementOf(p.id)) })));
    },

    // Approving (or resetting) shows a new sign-in code once; only its hash is kept.
    async issueCode(id, ctx) {
      requireAdmin(ctx);
      const partner = await mustGet(id);
      if (partner.status === PARTNER_STATUS.SUSPENDED) throw new ValidationError(['Reactivate this partner first']);
      const code = newAccessCode();
      await repo.setAccessHash(id, hashCode(code));
      if (partner.status === PARTNER_STATUS.PENDING) {
        await repo.setStatus(id, PARTNER_STATUS.ACTIVE);
        await notifications.notify('partner_approved', { partnerId: id, phone: partner.phone, data: { organisation: partner.organisation } });
      }
      await record(partner.status === PARTNER_STATUS.PENDING ? 'partner_approved' : 'partner_code_reset', ctx, partner.refCode);
      return { code, partner: await repo.get(id) };
    },

    async setStatus(id, status, ctx) {
      requireAdmin(ctx);
      const partner = await mustGet(id);
      if (![PARTNER_STATUS.ACTIVE, PARTNER_STATUS.SUSPENDED].includes(status)) throw new ValidationError(['Status is invalid']);
      if (status === PARTNER_STATUS.ACTIVE && !partner.hasAccessCode) throw new ValidationError(['Approve the partner to give them a code']);
      await repo.setStatus(id, status);
      await record(`partner_${status === PARTNER_STATUS.ACTIVE ? 'reactivated' : 'suspended'}`, ctx, partner.refCode);
      return repo.get(id);
    },

    // Introductions for the team to follow up: who has not started an entry yet, and for how long.
    async introductions(ctx, now = Date.now()) {
      requireAdmin(ctx);
      const partners = new Map((await repo.list()).map((p) => [p.id, p.organisation]));
      return (await repo.listIntroductions()).map((i) => ({
        reference: i.token,
        name: i.name,
        phone: i.phone,
        people: i.people,
        package: i.package,
        note: i.note,
        partner: partners.get(i.partnerId) ?? '—',
        started: Boolean(i.caseId),
        needsCall: !i.caseId && now - Date.parse(i.createdAt) > INVITE_STALE_MS,
        createdAt: i.createdAt,
      }));
    },

    // Organisation names by partner id, for the staff queue.
    async names() {
      return new Map((await repo.list()).map((p) => [p.id, p.organisation]));
    },
  };
}
