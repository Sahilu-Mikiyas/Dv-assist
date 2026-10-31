// Applicant case rules: what a DV entry needs and how a case moves through its lifecycle.
// Pure functions only — no I/O.

// Lifecycle: draft → checked (Abol) → verified (Tona, a different person) → approved (Baraka, the
// applicant's approval) → card_issued → submitted.
export const STATUS = Object.freeze({
  DRAFT: 'draft',
  CHECKED: 'checked',
  VERIFIED: 'verified',
  APPROVED: 'approved',
  CARD_ISSUED: 'card_issued',
  SUBMITTED: 'submitted',
});

export const APPROVAL_METHODS = ['in_person', 'phone', 'online'];

export const GENDERS = ['male', 'female'];

export const EDUCATION_LEVELS = [
  'primary_school_only',
  'some_high_school_no_diploma',
  'high_school_diploma',
  'vocational_school',
  'some_university_courses',
  'university_degree',
  'some_graduate_level_courses',
  'masters_degree',
  'some_doctorate_level_courses',
  'doctorate',
];

export const MARITAL_STATUSES = [
  'unmarried',
  'married_spouse_not_us_citizen_or_lpr',
  'married_spouse_us_citizen_or_lpr',
  'divorced',
  'widowed',
  'legally_separated',
];

const MARRIED_NEEDS_SPOUSE = 'married_spouse_not_us_citizen_or_lpr';

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.join('; '));
    this.errors = errors;
  }
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function validatePerson(person, prefix, errors) {
  const p = person ?? {};
  const clean = {
    lastName: text(p.lastName),
    firstName: text(p.firstName),
    noFirstName: Boolean(p.noFirstName),
    middleName: text(p.middleName),
    gender: text(p.gender),
    birthDate: text(p.birthDate),
    birthCity: text(p.birthCity),
    birthCountry: text(p.birthCountry),
  };
  if (!clean.lastName) errors.push(`${prefix}.lastName is required`);
  if (!clean.firstName && !clean.noFirstName)errors.push(`${prefix}.firstName is required`);
  if (!GENDERS.includes(clean.gender)) errors.push(`${prefix}.gender is invalid`);
  if (!isDate(clean.birthDate)) errors.push(`${prefix}.birthDate must be YYYY-MM-DD`);
  if (!clean.birthCity) errors.push(`${prefix}.birthCity is required`);
  if (!clean.birthCountry) errors.push(`${prefix}.birthCountry is required`);
  return clean;
}

// Returns a normalized applicant record or throws ValidationError.
export function validateApplicant(input) {
  const errors = [];
  const a = input ?? {};

  const applicant = {
    ...validatePerson(a, 'applicant', errors),
    eligibilityCountry: text(a.eligibilityCountry),
    mailingAddress: text(a.mailingAddress),
    residenceCountry: text(a.residenceCountry),
    phone: text(a.phone),
    email: text(a.email),
    education: text(a.education),
    maritalStatus: text(a.maritalStatus),
  };

  if (!applicant.eligibilityCountry) errors.push('applicant.eligibilityCountry is required');
  if (!applicant.mailingAddress) errors.push('applicant.mailingAddress is required');
  if (!applicant.residenceCountry) errors.push('applicant.residenceCountry is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicant.email)) errors.push('applicant.email is invalid');
  if (!EDUCATION_LEVELS.includes(applicant.education)) errors.push('applicant.education is invalid');
  if (!MARITAL_STATUSES.includes(applicant.maritalStatus)) errors.push('applicant.maritalStatus is invalid');

  applicant.spouse =
    applicant.maritalStatus === MARRIED_NEEDS_SPOUSE ? validatePerson(a.spouse, 'spouse', errors) : null;

  const children = Array.isArray(a.children) ? a.children : [];
  applicant.children = children.map((c, i) => validatePerson(c, `children[${i}]`, errors));

  if (errors.length) throw new ValidationError(errors);
  return applicant;
}

// The people on a case who each need a photo: "applicant", "spouse", "child0", "child1", ...
export function photoKeys(applicant) {
  return [
    'applicant',
    ...(applicant.spouse ? ['spouse'] : []),
    ...applicant.children.map((_, i) => `child${i}`),
  ];
}

function assertStatus(caseRecord, expected, action) {
  if (caseRecord.status !== expected) {
    throw new ValidationError([`Cannot ${action}: case is ${caseRecord.status.replace('_', ' ')}, expected ${expected.replace('_', ' ')}`]);
  }
}

// Abol: the first check. Every person on the entry needs a photo first.
export function assertCanCheck(caseRecord, photoKeysPresent) {
  assertStatus(caseRecord, STATUS.DRAFT, 'run the first check');
  const missing = photoKeys(caseRecord.applicant).filter((k) => !photoKeysPresent.includes(k));
  if (missing.length) throw new ValidationError(missing.map((k) => `Photo missing for ${k}`));
}

// Tona: the second check, by someone other than whoever did the first.
export function assertCanVerify(caseRecord, staffId) {
  assertStatus(caseRecord, STATUS.CHECKED, 'run the second check');
  if (caseRecord.checks?.abol?.by === staffId) {
    throw new ValidationError(['The second check must be done by a different person than the first']);
  }
}

// Baraka: staff record that the applicant approved the final entry, and how.
export function assertCanApprove(caseRecord, method) {
  assertStatus(caseRecord, STATUS.VERIFIED, 'record approval');
  if (!APPROVAL_METHODS.includes(method)) throw new ValidationError(['Say how the applicant approved']);
}

// Before a card exists, a case can go back to draft for corrections (its checks are cleared).
export function assertCanReopen(caseRecord) {
  if (![STATUS.CHECKED, STATUS.VERIFIED, STATUS.APPROVED].includes(caseRecord.status)) {
    throw new ValidationError([`Cannot reopen a case that is ${caseRecord.status.replace('_', ' ')}`]);
  }
}

export function assertCanIssueCard(caseRecord) {
  assertStatus(caseRecord, STATUS.APPROVED, 'issue a card');
}

export function assertCanSubmit(caseRecord, confirmationNumber) {
  assertStatus(caseRecord, STATUS.CARD_ISSUED, 'submit');
  if (!/^[A-Z0-9]{10,20}$/i.test(confirmationNumber ?? '')) {
    throw new ValidationError(['Confirmation number looks invalid']);
  }
}
