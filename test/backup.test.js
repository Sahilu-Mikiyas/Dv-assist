import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { restoreBackup, writeBackup } from '../src/infra/backup.js';
import { cipher } from '../src/infra/crypto.js';
import { caseRepository, openDb } from '../src/infra/db.js';
import { applicantInput, ctxFor, fakeJpeg, fakePassport, seedStaff, setupCases } from './helpers.js';

test('a backup restores into an empty database with everything readable, and personal data stays encrypted in the file', async () => {
  const env = await setupCases();
  const { meron } = await seedStaff(env);
  const c = await env.cases.create(applicantInput({ firstName: 'Backupname' }), ctxFor(meron));
  const photo = fakeJpeg(600, 600, 500);
  await env.cases.savePhoto(c.id, 'applicant', photo, ctxFor(meron));
  await env.cases.saveDocument(c.id, 'passport', fakePassport(), ctxFor(meron));
  await env.cases.recordPayment(c.id, { amountEtb: 1500, method: 'cash' }, ctxFor(meron));

  let file = '';
  const counts = await writeBackup(env.db, async (chunk) => { file += chunk; });
  assert.equal(counts.cases, 1);
  assert.equal(counts.photos, 1);
  assert.ok(!file.includes('Backupname'), 'names must not appear readably in the backup');

  const restored = await openDb({ url: ':memory:' });
  const result = await restoreBackup(restored, file.split('\n'));
  assert.equal(result.counts.cases, 1);
  // The restored database reads with the original key... (setupCases uses its own key, so read raw rows here)
  const rows = (await restored.execute('SELECT case_number FROM cases')).rows;
  assert.equal(Number(rows[0].case_number), 1);
  const pay = (await restored.execute('SELECT amount_etb FROM payments')).rows[0];
  assert.equal(Number(pay.amount_etb), 1500);
  await assert.rejects(restoreBackup(restored, file.split('\n')), /empty database/);

  // A tampered column name is refused.
  const bad = file.replace('"case_number"', '"case_number) VALUES (1); DROP TABLE cases; --"');
  await assert.rejects(restoreBackup(await openDb({ url: ':memory:' }), bad.split('\n')), /Bad column name/);
});

test('restored data decrypts with the same key and the next case number continues', async () => {
  const key = randomBytes(32);
  const crypt = cipher(key);
  const db = await openDb({ url: ':memory:' });
  const repo = caseRepository(db, crypt);
  await repo.insert({ id: 'c1', applicant: applicantInput({ firstName: 'Original' }), status: 'draft' });
  let file = '';
  await writeBackup(db, async (chunk) => { file += chunk; });

  const target = await openDb({ url: ':memory:' });
  await restoreBackup(target, file.split('\n'));
  const restoredRepo = caseRepository(target, cipher(key));
  assert.equal((await restoredRepo.get('c1')).applicant.firstName, 'Original');
  await restoredRepo.insert({ id: 'c2', applicant: applicantInput(), status: 'draft' });
  assert.equal((await restoredRepo.get('c2')).caseNumber, 2);
});
