// Application use cases. Wires domain rules to storage, the audit log and the Bitnob card client.
// `ctx` carries the request's staff member and IP ({ staff, ip }) for the audit trail.

import { randomUUID } from 'node:crypto';
import {
  DOCUMENT_KINDS,
  PACKAGE_PRICES_ETB,
  STATUS,
  ValidationError,
  validatePayment,
  assertCanApprove,
  assertCanCheck,
  assertCanIssueCard,
  assertCanReopen,
  assertCanSubmit,
  assertCanVerify,
  photoKeys,
  validateApplicant,
} from '../domain/case.js';
import { validateDocument, validatePhoto } from '../domain/photo.js';
import { ForbiddenError } from './staff.js';

export class NotFoundError extends Error {}

export const caseCode = (n) => `EDA-${String(n).padStart(4, '0')}`;

const QUIET = { notify: async () => {}, smsEnabled: false };

export function caseService({ repo, audit, bitnob, cardAmountUsd, partners = null, notifications = QUIET }) {
  const issuing = new Set(); // case ids with a card request in flight

  async function mustGet(id) {
    const found = await repo.get(id);
    if (!found) throw new NotFoundError(`Case ${id} not found`);
    return found;
  }

  // Erased cases can be looked at (number, status, history) but no longer worked on.
  async function mustGetActive(id) {
    const found = await mustGet(id);
    if (found.erasedAt) throw new ValidationError(['This case\'s personal data was erased']);
    return found;
  }

  async function documentsOf(id) {
    const present = await repo.documentKinds(id);
    return DOCUMENT_KINDS.map((kind) => ({ kind, uploaded: present.includes(kind) }));
  }

  // A state change that did not apply means someone else changed the case first.
  function changed(applied) {
    if (!applied) throw new ValidationError(['This case was changed by someone else just now. Reload and try again.']);
  }

  function assertNotIssuing(id) {
    if (issuing.has(id)) throw new ValidationError(['A card is being issued for this case right now. Wait a moment.']);
  }

  const partnerNames = async () => (partners ? partners.names() : new Map());

  async function withPhotos(c) {
    const present = await repo.photoKeys(c.id);
    return {
      ...c,
      partner: c.partnerId ? ((await partnerNames()).get(c.partnerId) ?? null) : null,
      expectedEtb: PACKAGE_PRICES_ETB[c.package] ?? null,
      payment: (await repo.payment(c.id)) ?? null,
      code: caseCode(c.caseNumber),
      photos: photoKeys(c.applicant).map((key) => ({ key, uploaded: present.includes(key) })),
      documents: await documentsOf(c.id),
      duplicates: c.erasedAt ? [] : (await repo.duplicatesOf({ id: c.id, applicant: c.applicant }))
        .map((d) => ({ id: d.id, code: caseCode(d.caseNumber), status: d.status, match: d.match })),
    };
  }

  async function mustGetDraft(id) {
    const existing = await mustGetActive(id);
    if (existing.status !== STATUS.DRAFT) throw new ValidationError(['Only draft cases can be edited. Reopen it first.']);
    return existing;
  }

  const record = (action, caseId, ctx = {}, detail = null) =>
    audit.record({ action, caseId, ip: ctx.ip, staffId: ctx.staff?.id, detail });

  const stamp = (ctx, extra = {}) => ({ by: ctx.staff?.id, name: ctx.staff?.name, at: new Date().toISOString(), ...extra });

  // A short row for the queue: no photos, no full applicant record.
  const summarize = (c, names = new Map()) => ({
    id: c.id,
    code: caseCode(c.caseNumber),
    name: [c.applicant.firstName, c.applicant.lastName].filter(Boolean).join(' '),
    people: photoKeys(c.applicant).length,
    status: c.status,
    source: c.source,
    package: c.package,
    partner: c.partnerId ? (names.get(c.partnerId) ?? null) : null,
    assignedTo: c.assignedTo,
    updatedAt: c.updatedAt,
  });

  return {
    // Filters: status (exact), q (name or case code, case-insensitive), assignedTo.
    // Website entries appear once their applicant has sent them for checking.
    async list({ status, q, assignedTo } = {}) {
      const needle = (q ?? '').trim().toLowerCase();
      const all = (await repo.list()).filter((c) => c.source !== 'website' || c.sentAt);
      const names = await partnerNames();
      const rows = all.map((c) => summarize(c, names));
      const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
      const cases = rows.filter((r) =>
        (!status || r.status === status)
        && (!assignedTo || r.assignedTo === assignedTo)
        && (!needle || r.name.toLowerCase().includes(needle) || r.code.toLowerCase().includes(needle)));
      return { cases, counts };
    },

    get: async (id) => withPhotos(await mustGet(id)),

    async create(input, ctx) {
      const id = randomUUID();
      await repo.insert({ id, applicant: validateApplicant(input), status: STATUS.DRAFT });
      await repo.assign(id, ctx?.staff?.id ?? null);
      await record('case_created', id, ctx);
      return withPhotos(await mustGet(id));
    },

    async update(id, input, ctx) {
      await mustGetDraft(id);
      await repo.updateApplicant(id, validateApplicant(input));
      await record('case_updated', id, ctx);
      return withPhotos(await mustGet(id));
    },

    async assign(id, staffId, ctx) {
      await mustGet(id);
      await repo.assign(id, staffId || null);
      await record('case_assigned', id, ctx, staffId || 'unassigned');
      return withPhotos(await mustGet(id));
    },

    async savePhoto(id, personKey, data, ctx) {
      const existing = await mustGetDraft(id);
      if (!photoKeys(existing.applicant).includes(personKey)) {
        throw new ValidationError([`No person "${personKey}" on this case`]);
      }
      validatePhoto(data);
      await repo.savePhoto(id, personKey, data);
      await record(`photo_saved:${personKey}`, id, ctx);
    },

    async saveDocument(id, kind, data, ctx) {
      await mustGetDraft(id);
      if (!DOCUMENT_KINDS.includes(kind)) throw new ValidationError([`Unknown document "${kind}"`]);
      validateDocument(data);
      await repo.saveDocument(id, kind, data);
      await record(`document_saved:${kind}`, id, ctx);
    },

    async getDocument(id, kind) {
      const data = await repo.getDocument(id, kind);
      if (!data) throw new NotFoundError('Document not found');
      return data;
    },

    async getPhoto(id, personKey) {
      const data = await repo.getPhoto(id, personKey);
      if (!data) throw new NotFoundError('Photo not found');
      return data;
    },

    // Abol: first check.
    async check(id, ctx) {
      const existing = await mustGetActive(id);
      assertCanCheck(existing, await repo.photoKeys(id), await repo.documentKinds(id));
      const sameP = (await repo.duplicatesOf({ id, applicant: existing.applicant })).filter((d) => d.match === 'passport');
      if (sameP.length) {
        throw new ValidationError([`Same passport as ${sameP.map((d) => caseCode(d.caseNumber)).join(', ')}. One entry per person: erase the extra entry first.`]);
      }
      changed(await repo.setStatus(id, { status: STATUS.CHECKED, checks: { abol: stamp(ctx) }, from: STATUS.DRAFT }));
      await record('check_abol', id, ctx);
      return withPhotos(await mustGet(id));
    },

    // Tona: second check, by a different person.
    async verify(id, ctx) {
      const existing = await mustGetActive(id);
      assertCanVerify(existing, ctx?.staff?.id);
      changed(await repo.setStatus(id, { status: STATUS.VERIFIED, checks: { ...existing.checks, tona: stamp(ctx) }, from: STATUS.CHECKED }));
      await record('check_tona', id, ctx);
      // Website applicants give their approval online; tell them it is their turn.
      if (existing.source === 'website') {
        await notifications.notify('approval_needed', {
          caseId: id, phone: existing.applicant.phone, email: existing.applicant.email, data: { code: caseCode(existing.caseNumber) },
        });
      }
      return withPhotos(await mustGet(id));
    },

    // Baraka: the applicant approved the final entry; staff record how.
    async approve(id, method, ctx) {
      const existing = await mustGetActive(id);
      assertCanApprove(existing, method);
      // "Online" is only ever the applicant's own approval on the website, never something staff record.
      if (method === 'online') throw new ValidationError(['Online approval is given by the applicant on the website']);
      changed(await repo.setStatus(id, { status: STATUS.APPROVED, checks: { ...existing.checks, baraka: stamp(ctx, { method }) }, from: STATUS.VERIFIED }));
      await record('check_baraka', id, ctx, method);
      return withPhotos(await mustGet(id));
    },

    async reopen(id, reason, ctx) {
      const existing = await mustGetActive(id);
      assertCanReopen(existing);
      assertNotIssuing(id);
      changed(await repo.setStatus(id, { status: STATUS.DRAFT, checks: {}, from: existing.status }));
      await record('case_reopened', id, ctx, (reason ?? '').slice(0, 200) || null);
      if (existing.source === 'website') {
        await notifications.notify('needs_correction', {
          caseId: id, phone: existing.applicant.phone, email: existing.applicant.email, data: { code: caseCode(existing.caseNumber) },
        });
      }
      return withPhotos(await mustGet(id));
    },

    async issueCard(id, ctx) {
      // Claim the case before any await so concurrent requests cannot both pass the status check.
      if (issuing.has(id)) throw new ValidationError(['A card is already being issued for this case']);
      issuing.add(id);
      try {
        assertCanIssueCard(await mustGetActive(id));
        // Reference is derived from the case id so a retried request cannot create a second card.
        const cardReference = `dv-${id}`;
        const { cardId } = await bitnob.createCard({ amountUsd: cardAmountUsd, reference: cardReference });
        if (!(await repo.markCardIssued(id, { cardId, cardReference, status: STATUS.CARD_ISSUED }))) {
          // Should not happen: the case cannot be reopened or erased while issuing. Keep a trail of the card.
          await record('card_orphaned', id, ctx, cardId);
          throw new ValidationError(['The case changed while the card was being issued. The card is recorded in the activity log: contact an admin.']);
        }
        await record('card_issued', id, ctx, `$${cardAmountUsd.toFixed(2)}`);
      } finally {
        issuing.delete(id);
      }
      return withPhotos(await mustGet(id));
    },

    async getCard(id, ctx) {
      const existing = await mustGetActive(id);
      if (existing.status !== STATUS.CARD_ISSUED) {
        throw new ValidationError(['Card details are only shown while the case awaits submission']);
      }
      await record('card_revealed', id, ctx);
      return bitnob.getCard(existing.cardId);
    },

    async submit(id, confirmationNumber, ctx) {
      const existing = await mustGetActive(id);
      const normalized = (confirmationNumber ?? '').trim().toUpperCase();
      assertCanSubmit(existing, normalized);
      changed(await repo.markSubmitted(id, { confirmationNumber: normalized, status: STATUS.SUBMITTED }));
      await record('case_submitted', id, ctx, normalized);
      await notifications.notify('submitted', {
        caseId: id, phone: existing.applicant.phone, email: existing.applicant.email,
        data: { code: caseCode(existing.caseNumber), confirmationNumber: normalized },
      });
      return withPhotos(await mustGet(id));
    },

    // The applicant paid us (Telebirr, CBE Birr, bank or cash). One payment per case; an admin can remove a
    // wrong one and record it again.
    async recordPayment(id, input, ctx) {
      const existing = await mustGetActive(id);
      if (await repo.payment(id)) throw new ValidationError(['A payment is already recorded for this case']);
      const payment = validatePayment(input);
      await repo.recordPayment(id, { ...payment, recordedBy: ctx.staff.name });
      await record('payment_recorded', id, ctx, `${payment.amountEtb} ETB ${payment.method}${payment.reference ? ` ${payment.reference}` : ''}`);
      return withPhotos(existing);
    },

    // Money returned to the applicant: they stop counting for revenue shares; already-paid shares are deducted later.
    async refundPayment(id, reason, ctx) {
      if (ctx?.staff?.role !== 'admin') throw new ForbiddenError('Only an admin can record a refund');
      const existing = await mustGet(id);
      const payment = await repo.payment(id);
      if (!payment) throw new ValidationError(['No payment is recorded for this case']);
      if (payment.refundedAt) throw new ValidationError(['This payment is already refunded']);
      const why = String(reason ?? '').trim().slice(0, 200);
      if (!why) throw new ValidationError(['Say why the payment was refunded']);
      if (!(await repo.refundPayment(id, { reason: why, refundedBy: ctx.staff.name }))) {
        throw new ValidationError(['This payment is already refunded']);
      }
      await record('payment_refunded', id, ctx, `${payment.amountEtb} ETB: ${why}`);
      return withPhotos(existing);
    },

    async removePayment(id, ctx) {
      if (ctx?.staff?.role !== 'admin') throw new ForbiddenError('Only an admin can remove a payment');
      const existing = await mustGet(id);
      const payment = await repo.payment(id);
      if (!payment) throw new ValidationError(['No payment is recorded for this case']);
      await repo.removePayment(id);
      await record('payment_removed', id, ctx, `${payment.amountEtb} ETB ${payment.method}`);
      return withPhotos(existing);
    },

    isIssuing: (id) => issuing.has(id),

    async auditList(options) {
      return (await audit.list(options)).map((r) => ({ ...r, caseCode: r.caseNumber ? caseCode(r.caseNumber) : null }));
    },

    activity(id) {
      return this.auditList({ caseId: id, limit: 50 });
    },

    // Bitnob webhook (already signature-checked): record it against the case whose card it concerns.
    async handleBitnobEvent(event, ctx) {
      const type = String(event?.event ?? event?.type ?? 'unknown').slice(0, 80);
      const data = event?.data ?? {};
      const cardId = data.card_id ?? data.cardId ?? data.card?.id ?? data.id;
      const target = cardId ? await repo.findByCardId(String(cardId)) : null;
      // Only non-sensitive fields: never card numbers or CVVs.
      const detail = ['status', 'amount', 'currency', 'reason', 'decline_reason', 'merchant_name']
        .filter((k) => data[k] !== undefined && data[k] !== null)
        .map((k) => `${k}=${String(data[k]).slice(0, 60)}`).join(' ') || null;
      await audit.record({ action: `bitnob:${type}`, caseId: target?.id ?? null, ip: ctx?.ip, detail });
    },
  };
}
