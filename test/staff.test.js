import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../src/infra/crypto.js';
import { totpCode } from '../src/infra/totp.js';
import { AuthError, ForbiddenError } from '../src/services/staff.js';
import { PASSWORD, ctxFor, seedStaff, setupCases } from './helpers.js';

test('creates the first admin only when no staff exist', async () => {
  const env = await setupCases();
  const passwordHash = await hashPassword(PASSWORD);
  assert.equal(await env.staff.bootstrap({ email: 'Owner@Example.com', passwordHash }), true);
  assert.equal(await env.staff.bootstrap({ email: 'other@example.com', passwordHash }), false);
  const owner = await env.staffRepo.byEmail('owner@example.com');
  assert.equal(owner.role, 'admin');
});

test('signs in with password, then requires authenticator setup, then the code', async () => {
  const env = await setupCases();
  await env.staff.bootstrap({ email: 'owner@example.com', passwordHash: await hashPassword(PASSWORD) });

  await assert.rejects(env.staff.signIn({ email: 'owner@example.com', password: 'nope' }), AuthError);
  const first = await env.staff.signIn({ email: 'OWNER@example.com', password: PASSWORD });
  assert.equal(first.needsAuthenticator, true);

  const ctx = ctxFor(await env.staffRepo.byEmail('owner@example.com'));
  const { secret, url } = env.staff.beginAuthenticator(ctx);
  assert.match(url, /^otpauth:\/\/totp\//);
  await assert.rejects(env.staff.confirmAuthenticator({ secret, code: '000000' }, ctx), /does not match/);
  await env.staff.confirmAuthenticator({ secret, code: totpCode(secret) }, ctx);

  await assert.rejects(env.staff.signIn({ email: 'owner@example.com', password: PASSWORD }), AuthError);
  const second = await env.staff.signIn({ email: 'owner@example.com', password: PASSWORD, code: totpCode(secret) });
  assert.equal(second.needsAuthenticator, false);

  const { rows } = await env.db.execute('SELECT action FROM audit_events ORDER BY id');
  assert.deepEqual(rows.map((r) => r.action), ['login_failed', 'login', 'authenticator_set', 'login_failed', 'login']);
});

test('admins manage staff; others cannot', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  await assert.rejects(env.staff.list(ctxFor(meron)), ForbiddenError);
  await assert.rejects(env.staff.create({ email: 'x@example.com', name: 'X', role: 'staff', password: 'short' }, ctxFor(admin)), /12 characters/);

  const yared = await env.staff.create({ email: 'Yared@example.com', name: 'Yared', role: 'staff', password: PASSWORD }, ctxFor(admin));
  assert.equal(yared.email, 'yared@example.com');
  assert.equal(yared.hasAuthenticator, false);
  await assert.rejects(env.staff.create({ email: 'yared@example.com', name: 'Y', role: 'staff', password: PASSWORD }, ctxFor(admin)), /already exists/);

  await env.staff.update(yared.id, { active: false }, ctxFor(admin));
  await assert.rejects(env.staff.signIn({ email: 'yared@example.com', password: PASSWORD }), AuthError);
  await assert.rejects(env.staff.update(admin.id, { active: false }, ctxFor(admin)), /yourself/);

  await env.staff.update(meron.id, { resetAuthenticator: true }, ctxFor(admin));
  assert.equal((await env.staff.signIn({ email: 'meron@example.com', password: PASSWORD })).needsAuthenticator, true);
  assert.deepEqual((await env.staff.directory()).map((m) => m.name).sort(), ['Admin', 'Meron']);
});
