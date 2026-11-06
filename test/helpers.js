// Test fixtures shared across suites.

import { randomBytes } from 'node:crypto';
import { cipher, hashPassword } from '../src/infra/crypto.js';
import {
  auditLog, caseRepository, messageRepository, openDb, partnerRepository, settingsRepository, staffRepository,
} from '../src/infra/db.js';
import { newTotpSecret } from '../src/infra/totp.js';
import { applicationService } from '../src/services/applications.js';
import { caseService } from '../src/services/cases.js';
import { economicsService } from '../src/services/economics.js';
import { notificationService } from '../src/services/notifications.js';
import { partnerService } from '../src/services/partners.js';
import { payoutService } from '../src/services/payouts.js';
import { retentionService } from '../src/services/retention.js';
import { staffService } from '../src/services/staff.js';

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
  passportNumber: 'EP1234567',
  passportCountry: 'Ethiopia',
  passportExpiry: '2031-06-30',
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

// A passport scan: a landscape JPEG large enough to read.
export const fakePassport = () => fakeJpeg(1200, 850);

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

// Case and staff services on a fresh in-memory database, with the raw db exposed for assertions.
// Records what would have been sent. `fail` makes the next n sends throw.
export function fakeChannel(name) {
  const sent = [];
  const channel = {
    name, sent, fail: 0,
    async send(message) {
      if (channel.fail > 0) { channel.fail--; throw new Error(`${name} is down`); }
      sent.push(message);
    },
  };
  return channel;
}

export async function setupCases({ sms = null, email = null, retentionPolicy = {}, commissionEtb = 200 } = {}) {
  const db = await openDb({ url: ':memory:' });
  const crypt = cipher(randomBytes(32));
  const bitnob = fakeBitnob();
  const audit = auditLog(db);
  const repo = caseRepository(db, crypt);
  let clock = Date.now();
  const notifications = notificationService({
    repo: messageRepository(db, crypt), audit, sms, email, publicUrl: 'https://dv.example', now: () => clock,
  });
  notifications.wake = () => {}; // tests deliver explicitly with deliverDue()
  const partnerRepo = partnerRepository(db, crypt);
  const economics = economicsService({ settingsRepo: settingsRepository(db), audit, envCommissionEtb: commissionEtb });
  const commission = () => economics.techCenterCommission();
  const partners = partnerService({ repo: partnerRepo, caseRepo: repo, audit, notifications, commission, economics: () => economics.values() });
  const payouts = payoutService({ partnerRepo, caseRepo: repo, audit, notifications, commission, revenueShare: (p) => partners.revenueShare(p) });
  const retention = retentionService({ caseRepo: repo, partnerRepo, audit, policy: retentionPolicy, now: () => clock });
  const cases = caseService({ repo, audit, bitnob, cardAmountUsd: 5, partners, notifications });
  const applications = applicationService({ repo, audit, partners, notifications });
  const advanceClock = (ms) => { clock += ms; };
  const staffRepo = staffRepository(db, crypt);
  const staff = staffService({ repo: staffRepo, audit });
  return { db, cases, applications, partners, payouts, economics, notifications, retention, advanceClock, audit, bitnob, staff, staffRepo };
}

// Two signed-in-ready staff members (an admin and a staff member) with authenticators set up.
export async function seedStaff({ staffRepo }) {
  const members = {};
  for (const [key, role] of [['admin', 'admin'], ['meron', 'staff']]) {
    const id = `${key}-id`;
    await staffRepo.insert({ id, email: `${key}@example.com`, name: key[0].toUpperCase() + key.slice(1), role,
      passwordHash: await hashPassword(PASSWORD) });
    const secret = newTotpSecret();
    await staffRepo.setTotp(id, secret);
    members[key] = { ...(await staffRepo.byId(id)), secret };
  }
  return members;
}

export const PASSWORD = 'a-long-password-1';

export const ctxFor = (member) => ({ ip: '203.0.113.7', staff: member });

// Walks a fresh case to "approved": photo, Abol by `first`, Tona by `second`, Baraka in person.
export async function approvedCase(cases, first, second, overrides = {}) {
  const c = await cases.create(applicantInput(overrides), ctxFor(first));
  for (const p of c.photos) await cases.savePhoto(c.id, p.key, fakeJpeg(), ctxFor(first));
  await cases.saveDocument(c.id, 'passport', fakePassport(), ctxFor(first));
  await cases.check(c.id, ctxFor(first));
  await cases.verify(c.id, ctxFor(second));
  return cases.approve(c.id, 'in_person', ctxFor(second));
}
