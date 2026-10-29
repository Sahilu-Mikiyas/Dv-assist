// Application use cases. Wires domain rules to storage and the Bitnob card client.

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

export function caseService({ repo, bitnob, cardAmountUsd }) {
  const issuing = new Set(); // case ids with a card request in flight
  function mustGet(id) {
    const found = repo.get(id);
    if (!found) throw new NotFoundError(`Case ${id} not found`);
    return found;
  }

  function withPhotos(c) {
    const present = repo.photoKeys(c.id);
    return { ...c, photos: photoKeys(c.applicant).map((key) => ({ key, uploaded: present.includes(key) })) };
  }

  return {
    list: () => repo.list(),

    get: (id) => withPhotos(mustGet(id)),

    create(input) {
      const id = randomUUID();
      repo.insert({ id, applicant: validateApplicant(input), status: STATUS.DRAFT });
      return withPhotos(mustGet(id));
    },

    update(id, input) {
      const existing = mustGet(id);
      if (existing.status !== STATUS.DRAFT) throw new ValidationError(['Only draft cases can be edited']);
      repo.updateApplicant(id, validateApplicant(input));
      return withPhotos(mustGet(id));
    },

    savePhoto(id, personKey, data) {
      const existing = mustGet(id);
      if (existing.status !== STATUS.DRAFT) throw new ValidationError(['Only draft cases can be edited']);
      if (!photoKeys(existing.applicant).includes(personKey)) {
        throw new ValidationError([`No person "${personKey}" on this case`]);
      }
      validatePhoto(data);
      repo.savePhoto(id, personKey, data);
    },

    getPhoto(id, personKey) {
      const data = repo.getPhoto(id, personKey);
      if (!data) throw new NotFoundError('Photo not found');
      return data;
    },

    async issueCard(id) {
      const existing = mustGet(id);
      assertCanIssueCard(existing, repo.photoKeys(id));
      if (issuing.has(id)) throw new ValidationError(['A card is already being issued for this case']);
      issuing.add(id);
      try {
        // Reference is derived from the case id so a retried request cannot create a second card.
        const cardReference = `dv-${id}`;
        const { cardId } = await bitnob.createCard({ amountUsd: cardAmountUsd, reference: cardReference });
        repo.markCardIssued(id, { cardId, cardReference, status: STATUS.CARD_ISSUED });
      } finally {
        issuing.delete(id);
      }
      return withPhotos(mustGet(id));
    },

    async getCard(id) {
      const existing = mustGet(id);
      if (existing.status !== STATUS.CARD_ISSUED) {
        throw new ValidationError(['Card details are only shown while the case awaits submission']);
      }
      return bitnob.getCard(existing.cardId);
    },

    submit(id, confirmationNumber) {
      const existing = mustGet(id);
      const normalized = (confirmationNumber ?? '').trim().toUpperCase();
      assertCanSubmit(existing, normalized);
      repo.markSubmitted(id, { confirmationNumber: normalized, status: STATUS.SUBMITTED });
      return withPhotos(mustGet(id));
    },
  };
}
