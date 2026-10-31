// Website applicants: start an entry, come back to it with a resume code, add photos, send it for
// checking, and give the final (Baraka) approval online. Applicants only ever see their own case.

import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  PACKAGES,
  STATUS,
  ValidationError,
  assertApplicantCanEdit,
  assertCanApprove,
  assertCanSend,
  photoKeys,
  validateApplicant,
} from '../domain/case.js';
import { validatePhoto } from '../domain/photo.js';
import { NotFoundError, caseCode } from './cases.js';

// No 0/O or 1/I, so a code read out over the phone cannot be misheard.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12; // 32^12 = 2^60 possibilities

export function newResumeCode() {
  const chars = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]);
  return chars.join('').match(/.{4}/g).join('-');
}

const normalizeCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Only the hash is stored, so a copy of the database cannot be used to open applicants' entries.
const hashCode = (code) => createHash('sha256').update(normalizeCode(code)).digest('hex');

function validatePackage(pkg) {
  if (!PACKAGES.includes(pkg)) throw new ValidationError(['package is invalid']);
  return pkg;
}

export function applicationService({ repo, audit }) {
  async function mustGet(id) {
    const found = await repo.get(id);
    if (!found || found.source !== 'website') throw new NotFoundError('Entry not found');
    return found;
  }

  const record = (action, caseId, ctx = {}, detail = null) =>
    audit.record({ action, caseId, ip: ctx.ip, detail: detail ?? 'applicant' });

  // What the applicant sees: their own details and progress, never staff names or card data.
  async function view(c) {
    const present = await repo.photoKeys(c.id);
    return {
      code: caseCode(c.caseNumber),
      status: c.status,
      package: c.package,
      applicant: c.applicant,
      photos: photoKeys(c.applicant).map((key) => ({ key, uploaded: present.includes(key) })),
      sentAt: c.sentAt,
      editable: c.status === STATUS.DRAFT && !c.sentAt,
      checks: { abol: Boolean(c.checks.abol), tona: Boolean(c.checks.tona), baraka: Boolean(c.checks.baraka) },
      confirmationNumber: c.status === STATUS.SUBMITTED ? c.confirmationNumber : null,
      createdAt: c.createdAt,
    };
  }

  return {
    async start(input, ctx) {
      const pkg = validatePackage(input?.package);
      const applicant = validateApplicant(input?.applicant);
      const id = randomUUID();
      const resumeCode = newResumeCode();
      await repo.insert({ id, applicant, status: STATUS.DRAFT, source: 'website', pkg, accessHash: hashCode(resumeCode) });
      await record('application_started', id, ctx, pkg);
      return { caseId: id, resumeCode, application: await view(await mustGet(id)) };
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
      await repo.updateApplicant(id, validateApplicant(input?.applicant));
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

    async getPhoto(id, personKey) {
      await mustGet(id);
      const data = await repo.getPhoto(id, personKey);
      if (!data) throw new NotFoundError('Photo not found');
      return data;
    },

    // Puts the entry in the staff queue for the first check.
    async send(id, ctx) {
      assertCanSend(await mustGet(id), await repo.photoKeys(id));
      await repo.markSent(id);
      await record('application_sent', id, ctx);
      return view(await mustGet(id));
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
