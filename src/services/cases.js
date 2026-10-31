// Application use cases. Wires domain rules to storage, the audit log and the Bitnob card client.
// `ctx` carries the request's staff member and IP ({ staff, ip }) for the audit trail.

import { randomUUID } from 'node:crypto';
import {
  STATUS,
  ValidationError,
  assertCanApprove,
  assertCanCheck,
  assertCanIssueCard,
  assertCanReopen,
  assertCanSubmit,
  assertCanVerify,
  photoKeys,
  validateApplicant,
} from '../domain/case.js';
import { validatePhoto } from '../domain/photo.js';

export class NotFoundError extends Error {}

export const caseCode = (n) => `EDA-${String(n).padStart(4, '0')}`;

export function caseService({ repo, audit, bitnob, cardAmountUsd }) {
  const issuing = new Set(); // case ids with a card request in flight

  async function mustGet(id) {
    const found = await repo.get(id);
    if (!found) throw new NotFoundError(`Case ${id} not found`);
    return found;
  }

  async function withPhotos(c) {
    const present = await repo.photoKeys(c.id);
    return {
      ...c,
      code: caseCode(c.caseNumber),
      photos: photoKeys(c.applicant).map((key) => ({ key, uploaded: present.includes(key) })),
    };
  }

  async function mustGetDraft(id) {
    const existing = await mustGet(id);
    if (existing.status !== STATUS.DRAFT) throw new ValidationError(['Only draft cases can be edited. Reopen it first.']);
    return existing;
  }

  const record = (action, caseId, ctx = {}, detail = null) =>
    audit.record({ action, caseId, ip: ctx.ip, staffId: ctx.staff?.id, detail });

  const stamp = (ctx, extra = {}) => ({ by: ctx.staff?.id, name: ctx.staff?.name, at: new Date().toISOString(), ...extra });

  // A short row for the queue: no photos, no full applicant record.
  const summarize = (c) => ({
    id: c.id,
    code: caseCode(c.caseNumber),
    name: [c.applicant.firstName, c.applicant.lastName].filter(Boolean).join(' '),
    people: photoKeys(c.applicant).length,
    status: c.status,
    assignedTo: c.assignedTo,
    updatedAt: c.updatedAt,
  });

  return {
    // Filters: status (exact), q (name or case code, case-insensitive), assignedTo.
    async list({ status, q, assignedTo } = {}) {
      const needle = (q ?? '').trim().toLowerCase();
      const rows = (await repo.list()).map(summarize);
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

    async getPhoto(id, personKey) {
      const data = await repo.getPhoto(id, personKey);
      if (!data) throw new NotFoundError('Photo not found');
      return data;
    },

    // Abol: first check.
    async check(id, ctx) {
      const existing = await mustGet(id);
      assertCanCheck(existing, await repo.photoKeys(id));
      await repo.setStatus(id, { status: STATUS.CHECKED, checks: { abol: stamp(ctx) } });
      await record('check_abol', id, ctx);
      return withPhotos(await mustGet(id));
    },

    // Tona: second check, by a different person.
    async verify(id, ctx) {
      const existing = await mustGet(id);
      assertCanVerify(existing, ctx?.staff?.id);
      await repo.setStatus(id, { status: STATUS.VERIFIED, checks: { ...existing.checks, tona: stamp(ctx) } });
      await record('check_tona', id, ctx);
      return withPhotos(await mustGet(id));
    },

    // Baraka: the applicant approved the final entry; staff record how.
    async approve(id, method, ctx) {
      const existing = await mustGet(id);
      assertCanApprove(existing, method);
      await repo.setStatus(id, { status: STATUS.APPROVED, checks: { ...existing.checks, baraka: stamp(ctx, { method }) } });
      await record('check_baraka', id, ctx, method);
      return withPhotos(await mustGet(id));
    },

    async reopen(id, reason, ctx) {
      const existing = await mustGet(id);
      assertCanReopen(existing);
      await repo.setStatus(id, { status: STATUS.DRAFT, checks: {} });
      await record('case_reopened', id, ctx, (reason ?? '').slice(0, 200) || null);
      return withPhotos(await mustGet(id));
    },

    async issueCard(id, ctx) {
      // Claim the case before any await so concurrent requests cannot both pass the status check.
      if (issuing.has(id)) throw new ValidationError(['A card is already being issued for this case']);
      issuing.add(id);
      try {
        assertCanIssueCard(await mustGet(id));
        // Reference is derived from the case id so a retried request cannot create a second card.
        const cardReference = `dv-${id}`;
        const { cardId } = await bitnob.createCard({ amountUsd: cardAmountUsd, reference: cardReference });
        await repo.markCardIssued(id, { cardId, cardReference, status: STATUS.CARD_ISSUED });
        await record('card_issued', id, ctx, `$${cardAmountUsd.toFixed(2)}`);
      } finally {
        issuing.delete(id);
      }
      return withPhotos(await mustGet(id));
    },

    async getCard(id, ctx) {
      const existing = await mustGet(id);
      if (existing.status !== STATUS.CARD_ISSUED) {
        throw new ValidationError(['Card details are only shown while the case awaits submission']);
      }
      await record('card_revealed', id, ctx);
      return bitnob.getCard(existing.cardId);
    },

    async submit(id, confirmationNumber, ctx) {
      const existing = await mustGet(id);
      const normalized = (confirmationNumber ?? '').trim().toUpperCase();
      assertCanSubmit(existing, normalized);
      await repo.markSubmitted(id, { confirmationNumber: normalized, status: STATUS.SUBMITTED });
      await record('case_submitted', id, ctx, normalized);
      return withPhotos(await mustGet(id));
    },

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
