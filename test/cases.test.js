import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../src/domain/case.js';
import { applicantInput, fakeJpeg, setupCases } from './helpers.js';

const ctx = { ip: '203.0.113.7' };

test('runs a case from draft to submitted', async () => {
  const { cases, bitnob, db } = await setupCases();
  const c = await cases.create(applicantInput(), ctx);
  assert.equal(c.status, 'draft');
  assert.deepEqual(c.photos, [{ key: 'applicant', uploaded: false }]);

  await assert.rejects(cases.issueCard(c.id, ctx), /Photo missing for applicant/);

  await cases.savePhoto(c.id, 'applicant', fakeJpeg(), ctx);
  const issued = await cases.issueCard(c.id, ctx);
  assert.equal(issued.status, 'card_issued');
  assert.deepEqual(bitnob.calls, [{ amountUsd: 5, reference: `dv-${c.id}` }]);

  assert.equal((await cases.getCard(c.id, ctx)).cardNumber, '4111111111111111');
  await assert.rejects(cases.update(c.id, applicantInput(), ctx), /Only draft/);

  const done = await cases.submit(c.id, ' 2027abcd1234efgh ', ctx);
  assert.equal(done.status, 'submitted');
  assert.equal(done.confirmationNumber, '2027ABCD1234EFGH');
  await assert.rejects(cases.getCard(c.id, ctx), ValidationError);

  const { rows } = await db.execute('SELECT action, ip FROM audit_events ORDER BY id');
  assert.deepEqual(rows.map((r) => r.action), [
    'case_created', 'photo_saved:applicant', 'card_issued', 'card_viewed', 'case_submitted',
  ]);
  assert.equal(rows[0].ip, ctx.ip);
});

test('stores applicant data and photos encrypted', async () => {
  const { cases, db } = await setupCases();
  const c = await cases.create(applicantInput(), ctx);
  await cases.savePhoto(c.id, 'applicant', fakeJpeg(), ctx);
  const raw = (await db.execute('SELECT applicant FROM cases')).rows[0].applicant;
  assert.ok(!Buffer.from(raw).toString('latin1').includes('Kebede'));
  const photo = (await db.execute('SELECT data FROM photos')).rows[0].data;
  assert.notDeepEqual(Buffer.from(photo).subarray(0, 2), Buffer.from([0xff, 0xd8]));
  assert.deepEqual(await cases.getPhoto(c.id, 'applicant'), fakeJpeg());
});

test('rejects photos for people not on the case', async () => {
  const { cases } = await setupCases();
  const c = await cases.create(applicantInput(), ctx);
  await assert.rejects(cases.savePhoto(c.id, 'spouse', fakeJpeg(), ctx), /No person "spouse"/);
});

test('does not issue two cards for concurrent or repeated requests', async () => {
  const { cases, bitnob } = await setupCases();
  const c = await cases.create(applicantInput(), ctx);
  await cases.savePhoto(c.id, 'applicant', fakeJpeg(), ctx);
  const results = await Promise.allSettled([cases.issueCard(c.id, ctx), cases.issueCard(c.id, ctx)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await assert.rejects(cases.issueCard(c.id, ctx), /draft/);
  assert.equal(bitnob.calls.length, 1);
});

test('cannot submit before a card is issued', async () => {
  const { cases } = await setupCases();
  const c = await cases.create(applicantInput(), ctx);
  await assert.rejects(cases.submit(c.id, '2027ABCD1234EFGH', ctx), /issued card/);
});
