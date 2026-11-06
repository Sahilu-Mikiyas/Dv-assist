import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, photoKeys, validateApplicant } from '../src/domain/case.js';
import { jpegDimensions, validatePhoto } from '../src/domain/photo.js';
import { applicantInput, fakeJpeg, person } from './helpers.js';

test('accepts a complete applicant and trims text', () => {
  const a = validateApplicant(applicantInput({ lastName: '  Abebe ' }));
  assert.equal(a.lastName, 'Abebe');
  assert.equal(a.spouse, null);
});

test('reports every missing field at once', () => {
  assert.throws(() => validateApplicant({}), (err) => err instanceof ValidationError && err.errors.length > 5);
});

test('allows a missing first name only when flagged', () => {
  assert.throws(() => validateApplicant(applicantInput({ firstName: '' })), ValidationError);
  assert.doesNotThrow(() => validateApplicant(applicantInput({ firstName: '', noFirstName: true })));
});

test('requires spouse details only for a non-US-citizen spouse', () => {
  const married = { maritalStatus: 'married_spouse_not_us_citizen_or_lpr' };
  assert.throws(() => validateApplicant(applicantInput(married)), ValidationError);
  const a = validateApplicant(applicantInput({ ...married, spouse: person({ gender: 'female' }) }));
  assert.equal(a.spouse.gender, 'female');
  const usSpouse = validateApplicant(applicantInput({ maritalStatus: 'married_spouse_us_citizen_or_lpr', spouse: person() }));
  assert.equal(usSpouse.spouse, null);
});

test('lists a photo slot per person', () => {
  const a = validateApplicant(applicantInput({
    maritalStatus: 'married_spouse_not_us_citizen_or_lpr', spouse: person(), children: [person(), person()],
  }));
  assert.deepEqual(photoKeys(a), ['applicant', 'spouse', 'child0', 'child1']);
});

test('reads JPEG dimensions and enforces photo rules', () => {
  assert.deepEqual(jpegDimensions(fakeJpeg(600, 600)), { width: 600, height: 600 });
  assert.doesNotThrow(() => validatePhoto(fakeJpeg()));
  assert.throws(() => validatePhoto(fakeJpeg(600, 601)), /600x600/);
  assert.throws(() => validatePhoto(Buffer.from('not a jpeg')), /JPEG/);
  assert.throws(() => validatePhoto(fakeJpeg(600, 600, 241 * 1024)), /240 KB/);
});

test('the entrant needs a valid passport: number, country and a future expiry date', async () => {
  const { validateApplicant } = await import('../src/domain/case.js');
  const { applicantInput } = await import('./helpers.js');
  assert.equal(validateApplicant(applicantInput({ passportNumber: 'ep 123 4567' })).passportNumber, 'EP1234567');
  assert.throws(() => validateApplicant(applicantInput({ passportNumber: '12' })), /passportNumber is invalid/);
  assert.throws(() => validateApplicant(applicantInput({ passportCountry: '' })), /passportCountry is required/);
  assert.throws(() => validateApplicant(applicantInput({ passportExpiry: '2020-01-01' })), /passport must be valid/);
});

test('passport scans must be readable JPEGs of a sensible size', async () => {
  const { validateDocument } = await import('../src/domain/photo.js');
  const { fakeJpeg, fakePassport } = await import('./helpers.js');
  assert.doesNotThrow(() => validateDocument(fakePassport()));
  assert.throws(() => validateDocument(fakeJpeg(600, 400)), /too small to read/);
  assert.throws(() => validateDocument(Buffer.from('not a jpeg')), /must be a JPEG/);
  assert.throws(() => validateDocument(fakeJpeg(1200, 850, 2 * 1024 * 1024)), /1.5 MB/);
});
