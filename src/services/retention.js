// Data retention: erases applicants' personal data once it is no longer needed.
//
// Two rules, each off until its number of days is set:
//   afterSubmissionDays — submitted entries, counted from submission. Selected applicants need their details
//                         for the visa forms until the end of the DV fiscal year, so keep this long.
//   unsentDays          — website entries never sent for checking, and partner introductions nobody started,
//                         counted from their last change.
// Entries still being worked on (checked, approved, card issued) are never erased automatically.
// An admin can also erase one case on request (an applicant asks to be deleted).

import { STATUS, ValidationError } from '../domain/case.js';
import { NotFoundError, caseCode } from './cases.js';
import { ForbiddenError } from './staff.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionService({ caseRepo, partnerRepo, audit, policy = {}, now = () => Date.now() }) {
  const { afterSubmissionDays = null, unsentDays = null } = policy;

  const requireAdmin = (ctx) => {
    if (ctx?.staff?.role !== 'admin') throw new ForbiddenError('Admins only');
  };
  const olderThan = (iso, days) => days != null && iso && now() - Date.parse(iso) > days * DAY_MS;

  // What each rule would erase right now, whether or not the rule is switched on.
  async function due({ submittedDays = afterSubmissionDays, draftDays = unsentDays } = {}) {
    const cases = (await caseRepo.list()).filter((c) => !c.erasedAt);
    const intros = await partnerRepo.listIntroductions();
    return {
      submitted: cases.filter((c) => c.status === STATUS.SUBMITTED && olderThan(c.submittedAt, submittedDays)),
      unsent: cases.filter((c) => c.source === 'website' && c.status === STATUS.DRAFT && !c.sentAt && olderThan(c.updatedAt, draftDays)),
      introductions: intros.filter((i) => !i.caseId && olderThan(i.createdAt, draftDays)),
    };
  }

  async function eraseCase(c, reason, ctx = {}) {
    await caseRepo.erase(c.id);
    await audit.record({ action: 'case_erased', caseId: c.id, ip: ctx.ip, staffId: ctx.staff?.id, detail: reason });
  }

  return {
    policy: { afterSubmissionDays, unsentDays },

    // Applies the rules that are switched on. Safe to run often.
    async run(ctx = {}) {
      const found = await due();
      for (const c of found.submitted) await eraseCase(c, `retention: ${afterSubmissionDays} days after submission`, ctx);
      for (const c of found.unsent) await eraseCase(c, `retention: unsent for ${unsentDays} days`, ctx);
      for (const i of found.introductions) await partnerRepo.deleteIntroduction(i.id);
      const counts = { submitted: found.submitted.length, unsent: found.unsent.length, introductions: found.introductions.length };
      if (counts.submitted || counts.unsent || counts.introductions) {
        await audit.record({ action: 'retention_run', ip: ctx.ip, staffId: ctx.staff?.id, detail: JSON.stringify(counts) });
      }
      return counts;
    },

    // For the admin page: the policy, and what is (or, for a rule that is off, would be) due.
    async overview(ctx, { previewDays = { submittedDays: 548, draftDays: 60 } } = {}) {
      requireAdmin(ctx);
      const live = await due();
      const preview = await due(previewDays);
      const cases = (await caseRepo.list());
      return {
        policy: { afterSubmissionDays, unsentDays },
        due: { submitted: live.submitted.length, unsent: live.unsent.length, introductions: live.introductions.length },
        preview: { ...previewDays, submitted: preview.submitted.length, unsent: preview.unsent.length, introductions: preview.introductions.length },
        erased: cases.filter((c) => c.erasedAt).length,
        kept: cases.filter((c) => !c.erasedAt).length,
      };
    },

    // An applicant asked to be deleted. Not while a card is out: its payment must be settled first.
    async eraseOne(id, ctx) {
      requireAdmin(ctx);
      const c = await caseRepo.get(id);
      if (!c) throw new NotFoundError(`Case ${id} not found`);
      if (c.erasedAt) throw new ValidationError(['This case is already erased']);
      if (c.status === STATUS.CARD_ISSUED) throw new ValidationError(['A card is issued for this case. Submit or settle it first.']);
      await eraseCase(c, 'applicant request', ctx);
      return { code: caseCode(c.caseNumber) };
    },
  };
}
