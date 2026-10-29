// Application use cases. Wires domain rules to storage, the audit log and the Bitnob card client.
// `ctx` carries request metadata ({ ip }) for the audit trail.

import { randomUUID } from 'node:crypto';
import {
  STATUS,
  ValidationError,
  assertCanIssueCard,
  assertCanSubmit,
  photoKeys,
  validateApplicant,
} from '../domain/case.js';
import { validatePhoto } from '../domain/photo.js';

export class NotFoundError extends Error {}

export function caseService({ repo, audit, bitnob, cardAmountUsd }) {
  const issuing = new Set(); // case ids with a card request in flight

  async function mustGet(id) {
    const found = await repo.get(id);
    if (!found) throw new NotFoundError(`Case ${id} not found`);
    return found;
  }

  async function withPhotos(c) {
    const present = await repo.photoKeys(c.id);
    return { ...c, photos: photoKeys(c.applicant).map((key) => ({ key, uploaded: present.includes(key) })) };
  }

  async function mustGetDraft(id) {
    const existing = await mustGet(id);
    if (existing.status !== STATUS.DRAFT) throw new ValidationError(['Only draft cases can be edited']);
    return existing;
  }

  const record = (action, caseId, ctx = {}) => audit.record({ action, caseId, ip: ctx.ip });

  return {
    list: () => repo.list(),

    get: async (id) => withPhotos(await mustGet(id)),

    async create(input, ctx) {
      const id = randomUUID();
      await repo.insert({ id, applicant: validateApplicant(input), status: STATUS.DRAFT });
      await record('case_created', id, ctx);
      return withPhotos(await mustGet(id));
    },

    async update(id, input, ctx) {
      await mustGetDraft(id);
      await repo.updateApplicant(id, validateApplicant(input));
      await record('case_updated', id, ctx);
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

    async issueCard(id, ctx) {
      // Claim the case before any await so concurrent requests cannot both pass the status check.
      if (issuing.has(id)) throw new ValidationError(['A card is already being issued for this case']);
      issuing.add(id);
      try {
        assertCanIssueCard(await mustGet(id), await repo.photoKeys(id));
        // Reference is derived from the case id so a retried request cannot create a second card.
        const cardReference = `dv-${id}`;
        const { cardId } = await bitnob.createCard({ amountUsd: cardAmountUsd, reference: cardReference });
        await repo.markCardIssued(id, { cardId, cardReference, status: STATUS.CARD_ISSUED });
        await record('card_issued', id, ctx);
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
      await record('card_viewed', id, ctx);
      return bitnob.getCard(existing.cardId);
    },

    async submit(id, confirmationNumber, ctx) {
      const existing = await mustGet(id);
      const normalized = (confirmationNumber ?? '').trim().toUpperCase();
      assertCanSubmit(existing, normalized);
      await repo.markSubmitted(id, { confirmationNumber: normalized, status: STATUS.SUBMITTED });
      await record('case_submitted', id, ctx);
      return withPhotos(await mustGet(id));
    },
  };
}
