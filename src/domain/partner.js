// Referral partners: shops, schools, faith and community groups who introduce applicants.
// Pure rules only — no I/O.

import { PACKAGES, ValidationError } from './case.js';

export const PARTNER_TYPES = ['shop', 'school', 'faith', 'community', 'other'];
export const PARTNER_STATUS = Object.freeze({ PENDING: 'pending', ACTIVE: 'active', SUSPENDED: 'suspended' });

const text = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const tooLong = (v, max = 120) => typeof v === 'string' && v.trim().length > max;
// Ethiopian numbers: +251 or 0, then 9 or 7, then 8 digits. Spaces and dashes are ignored.
const ETHIOPIAN_PHONE = /^(?:\+?251|0)([79]\d{8})$/;

export function normalizePhone(value) {
  const match = String(value ?? '').replace(/[\s-]/g, '').match(ETHIOPIAN_PHONE);
  return match ? `+251${match[1]}` : null;
}

export function validatePartnerApplication(input) {
  const a = input ?? {};
  const errors = [];
  const clean = {
    name: text(a.name),
    organisation: text(a.organisation),
    type: text(a.type),
    phone: normalizePhone(a.phone),
    city: text(a.city, 60),
    payoutPhone: normalizePhone(a.payoutPhone),
  };
  if (!clean.name) errors.push('Your name is required');
  if (!clean.organisation) errors.push('Organisation is required');
  if (tooLong(a.organisation) || tooLong(a.name)) errors.push('Name and organisation must be 120 characters or fewer');
  if (!PARTNER_TYPES.includes(clean.type)) errors.push('Choose a type of organisation');
  if (!clean.phone) errors.push('Phone must be an Ethiopian mobile number, e.g. 0911 234 567');
  if (!clean.city) errors.push('City is required');
  if (!clean.payoutPhone) errors.push('Telebirr number must be an Ethiopian mobile number');
  if (a.agree !== true) errors.push('Agree to the partner promises to apply');
  if (errors.length) throw new ValidationError(errors);
  return clean;
}

export function validateIntroduction(input) {
  const a = input ?? {};
  const errors = [];
  const people = Number(a.people);
  const clean = {
    name: text(a.name),
    phone: normalizePhone(a.phone),
    people: Number.isInteger(people) && people >= 1 && people <= 15 ? people : null,
    package: text(a.package),
    note: text(a.note, 300),
  };
  if (!clean.name) errors.push('Their name is required');
  if (!clean.phone) errors.push('Their phone must be an Ethiopian mobile number');
  if (!clean.people) errors.push('People in the entry must be between 1 and 15');
  if (!PACKAGES.includes(clean.package)) errors.push('Choose a package');
  if (a.consent !== true) errors.push('Confirm that they asked you to share their number');
  if (errors.length) throw new ValidationError(errors);
  return clean;
}

// A short, readable referral code from the organisation's name: "Haile Internet Café" → "HAILE" + 2 random
// characters. Names without Latin letters fall back to "P".
export function refCodePrefix(organisation) {
  const letters = String(organisation ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return (letters.slice(0, 5) || 'P');
}

// What a partner sees about an applicant they referred: a stage, never the entry's details.
export function referralStage(caseRecord) {
  if (!caseRecord) return 'invited';
  switch (caseRecord.status) {
    case 'submitted': return 'submitted';
    case 'approved':
    case 'card_issued': return 'filing';
    case 'draft': return caseRecord.sentAt ? 'checking' : 'started';
    default: return 'checking';
  }
}
