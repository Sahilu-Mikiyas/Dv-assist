// Test fixtures shared across suites.

import { randomBytes } from 'node:crypto';
import { cipher } from '../src/infra/crypto.js';
import { auditLog, caseRepository, openDb } from '../src/infra/db.js';
import { caseService } from '../src/services/cases.js';

export const person = (overrides = {}) => ({
  lastName: 'Abebe',
  firstName: 'Kebede',
  gender: 'male',
  birthDate: '1995-04-12',
  birthCity: 'Addis Ababa',
  birthCountry: 'Ethiopia',
  ...overrides,
});

export const applicantInput = (overrides = {}) => ({
  ...person(),
  eligibilityCountry: 'Ethiopia',
  mailingAddress: 'Bole, Addis Ababa',
  residenceCountry: 'Ethiopia',
  email: 'kebede@example.com',
  education: 'university_degree',
  maritalStatus: 'unmarried',
  children: [],
  ...overrides,
});

// Smallest buffer jpegDimensions() accepts: SOI + SOF0 header with the given size.
export function fakeJpeg(width = 600, height = 600, padTo = 0) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(20)]);
  return padTo > buf.length ? Buffer.concat([buf, Buffer.alloc(padTo - buf.length)]) : buf;
}

export function fakeBitnob() {
  const calls = [];
  return {
    calls,
    async createCard(args) {
      calls.push(args);
      await new Promise((r) => setTimeout(r, 5));
      return { cardId: 'card_123' };
    },
    async getCard() {
      return { cardNumber: '4111111111111111', cvv: '123', expiry: '12/29' };
    },
  };
}

// A case service on a fresh in-memory database, with the raw db exposed for assertions.
export async function setupCases() {
  const db = await openDb({ url: ':memory:' });
  const bitnob = fakeBitnob();
  const audit = auditLog(db);
  const cases = caseService({
    repo: caseRepository(db, cipher(randomBytes(32))), audit, bitnob, cardAmountUsd: 5,
  });
  return { db, cases, audit, bitnob };
}
