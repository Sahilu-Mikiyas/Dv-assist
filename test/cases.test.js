import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../src/domain/case.js';
import { caseRepository, openDb } from '../src/infra/db.js';
import { caseService } from '../src/services/cases.js';
import { applicantInput, fakeJpeg } from './helpers.js';

function setup() {
  const calls = [];
  const bitnob = {
    async createCard(args) {
      calls.push(args);
      return { cardId: 'card_123' };
    },
    async getCard(id) {
      return { cardNumber: '4111111111111111', cvv: '123', expiry: '12/29', cardId: id };
    },
  };
  const cases = caseService({ repo: caseRepository(openDb(':memory:')), bitnob, cardAmountUsd: 5 });
  return { cases, calls };
}

test('runs a case from draft to submitted', async () => {
  const { cases, calls } = setup();
  const c = cases.create(applicantInput());
  assert.equal(c.status, 'draft');
  assert.deepEqual(c.photos, [{ key: 'applicant', uploaded: false }]);

  await assert.rejects(cases.issueCard(c.id), /Photo missing for applicant/);

  cases.savePhoto(c.id, 'applicant', fakeJpeg());
  const issued = await cases.issueCard(c.id);
  assert.equal(issued.status, 'card_issued');
  assert.deepEqual(calls, [{ amountUsd: 5, reference: `dv-${c.id}` }]);

  assert.equal((await cases.getCard(c.id)).cardNumber, '4111111111111111');
  assert.throws(() => cases.update(c.id, applicantInput()), /Only draft/);

  const done = cases.submit(c.id, ' 2027abcd1234efgh ');
  assert.equal(done.status, 'submitted');
  assert.equal(done.confirmationNumber, '2027ABCD1234EFGH');
  await assert.rejects(cases.getCard(c.id), ValidationError);
});

test('rejects photos for people not on the case', () => {
  const { cases } = setup();
  const c = cases.create(applicantInput());
  assert.throws(() => cases.savePhoto(c.id, 'spouse', fakeJpeg()), /No person "spouse"/);
});

test('does not issue two cards for concurrent requests', async () => {
  const { cases, calls } = setup();
  const c = cases.create(applicantInput());
  cases.savePhoto(c.id, 'applicant', fakeJpeg());
  const results = await Promise.allSettled([cases.issueCard(c.id), cases.issueCard(c.id)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(calls.length, 1);
});

test('cannot submit before a card is issued', () => {
  const { cases } = setup();
  const c = cases.create(applicantInput());
  assert.throws(() => cases.submit(c.id, '2027ABCD1234EFGH'), /issued card/);
});
