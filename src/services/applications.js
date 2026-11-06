// Website applicants: start an entry, come back to it with a resume code, add photos, send it for
// checking, and give the final (Baraka) approval online. Applicants only ever see their own case.

import { randomUUID } from 'node:crypto';
import {
  DOCUMENT_KINDS,
  PACKAGES,
  STATUS,
  ValidationError,
  assertApplicantCanEdit,
  assertCanApprove,
  assertCanSend,
  photoKeys,
  validateApplicant,
} from '../domain/case.js';
import { validateDocument, validatePhoto } from '../domain/photo.js';
import { hashCode, newAccessCode, normalizeCode } from '../infra/codes.js';
import { NotFoundError, caseCode } from './cases.js';

const CODE_LENGTH = 12;

export const newResumeCode = newAccessCode;

function validatePackage(pkg) {
  if (!PACKAGES.includes(pkg)) throw new ValidationError(['package is invalid']);
  return pkg;
}

const QUIET = { notify: async () => {}, smsEnabled: false };

export function applicationService({ repo, audit, partners = null, notifications = QUIET }) {
  async function mustGet(id) {
    const found = await repo.get(id);
    if (!found || found.source !== 'website' || found.erasedAt) throw new NotFoundError('Entry not found');
    return found;
  }

  // One entry per person: a passport already on another live entry is refused (the DV rules disqualify
  // people who enter twice).
  async function assertNoPassportDuplicate(id, applicant) {
    if ((await repo.duplicatesOf({ id, applicant })).some((d) => d.match === 'passport')) {
      throw new ValidationError(['An entry with this passport number already exists. Continue it with your code, or contact us.']);
    }
  }

  const record = (action, caseId, ctx = {}, detail = null) =>
    audit.record({ action, caseId, ip: ctx.ip, detail: detail ?? 'applicant' });

  async function paymentView(id) {
    const p = await repo.payment(id);
    if (!p) return { status: 'none' };
    return { status: p.refundedAt ? 'refunded' : 'paid', amountEtb: p.amountEtb };
  }

  // What the applicant sees: their own details and progress, never staff names or card data.
  async function view(c) {
    const present = await repo.photoKeys(c.id);
    const documents = await repo.documentKinds(c.id);
    return {
      code: caseCode(c.caseNumber),
      status: c.status,
      package: c.package,
      applicant: c.applicant,
      photos: photoKeys(c.applicant).map((key) => ({ key, uploaded: present.includes(key) })),
      documents: DOCUMENT_KINDS.map((kind) => ({ kind, uploaded: documents.includes(kind) })),
      sentAt: c.sentAt,
      editable: c.status === STATUS.DRAFT && !c.sentAt,
      checks: { abol: Boolean(c.checks.abol), tona: Boolean(c.checks.tona), baraka: Boolean(c.checks.baraka) },
      confirmationNumber: c.status === STATUS.SUBMITTED ? c.confirmationNumber : null,
      payment: await paymentView(c.id),
      createdAt: c.createdAt,
    };
  }

  return {
    // `input.ref` / `input.invite` link the entry to a referral partner. `input.together` marks it as filled in
    // with that partner, which only counts when the partner is signed in on this device (ctx.partnerId).
    async start(input, ctx) {
      const pkg = validatePackage(input?.package);
      const applicant = validateApplicant(input?.applicant);
      await assertNoPassportDuplicate(null, applicant);
      const id = randomUUID();
      const resumeCode = newResumeCode();
      await repo.insert({ id, applicant, status: STATUS.DRAFT, source: 'website', pkg, accessHash: hashCode(resumeCode) });
      const referral = partners && (await partners.resolve({ ref: input?.ref, invite: input?.invite }));
      const together = Boolean(referral && input?.together === true && ctx?.partnerId === referral.partner.id);
      if (referral) await partners.linkCase(id, referral, { together });
      await record('application_started', id, ctx, referral ? `${pkg} via ${referral.partner.refCode}${together ? ' (together)' : ''}` : pkg);
      const created = await mustGet(id);
      // The applicant's own copy of their code, so a lost note is not a lost entry.
      await notifications.notify('resume_code', {
        caseId: id, phone: applicant.phone, email: applicant.email,
        data: { code: caseCode(created.caseNumber), resumeCode },
      });
      return { caseId: id, resumeCode, together, application: await view(created) };
    },

    // Returns the case id for a valid code, else null.
    async resume(code) {
      if (normalizeCode(code).length !== CODE_LENGTH) return null;
      const found = await repo.findByAccessHash(hashCode(code));
      return found?.source === 'website' ? found.id : null;
    },

    get: async (id) => view(await mustGet(id)),

    async update(id, input, ctx) {
      assertApplicantCanEdit(await mustGet(id));
      const pkg = validatePackage(input?.package);
      const applicant = validateApplicant(input?.applicant);
      await assertNoPassportDuplicate(id, applicant);
      await repo.updateApplicant(id, applicant);
      await repo.setPackage(id, pkg);
      await record('application_updated', id, ctx);
      return view(await mustGet(id));
    },

    async savePhoto(id, personKey, data, ctx) {
      const existing = await mustGet(id);
      assertApplicantCanEdit(existing);
      if (!photoKeys(existing.applicant).includes(personKey)) {
        throw new ValidationError([`No person "${personKey}" on this entry`]);
      }
      validatePhoto(data);
      await repo.savePhoto(id, personKey, data);
      await record(`photo_saved:${personKey}`, id, ctx);
      return view(await mustGet(id));
    },

    async saveDocument(id, kind, data, ctx) {
      assertApplicantCanEdit(await mustGet(id));
      if (!DOCUMENT_KINDS.includes(kind)) throw new ValidationError([`Unknown document "${kind}"`]);
      validateDocument(data);
      await repo.saveDocument(id, kind, data);
      await record(`document_saved:${kind}`, id, ctx);
      return view(await mustGet(id));
    },

    async getDocument(id, kind) {
      await mustGet(id);
      const data = await repo.getDocument(id, kind);
      if (!data) throw new NotFoundError('Document not found');
      return data;
    },

    async getPhoto(id, personKey) {
      await mustGet(id);
      const data = await repo.getPhoto(id, personKey);
      if (!data) throw new NotFoundError('Photo not found');
      return data;
    },

    // Puts the entry in the staff queue for the first check.
    async send(id, ctx) {
      assertCanSend(await mustGet(id), await repo.photoKeys(id), await repo.documentKinds(id));
      await repo.markSent(id);
      await record('application_sent', id, ctx);
      const sent = await mustGet(id);
      await notifications.notify('received', {
        caseId: id, phone: sent.applicant.phone, email: sent.applicant.email, data: { code: caseCode(sent.caseNumber) },
      });
      return view(sent);
    },

    // Baraka, given online by the applicant after both staff checks.
    async approve(id, { confirm } = {}, ctx) {
      const existing = await mustGet(id);
      assertCanApprove(existing, 'online');
      if (confirm !== true) throw new ValidationError(['Confirm that every detail and photo is correct']);
      const baraka = { by: null, name: 'Applicant', at: new Date().toISOString(), method: 'online' };
      await repo.setStatus(id, { status: STATUS.APPROVED, checks: { ...existing.checks, baraka } });
      await record('check_baraka', id, ctx, 'online (applicant)');
      return view(await mustGet(id));
    },
  };
}
