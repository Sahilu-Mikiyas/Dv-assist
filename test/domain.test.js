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
