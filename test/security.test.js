import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cipher, hashPassword, parseKey, verifyPassword } from '../src/infra/crypto.js';
import { loginLimiter } from '../src/http/rate-limit.js';

test('encrypts and decrypts, and detects tampering', () => {
  const c = cipher(randomBytes(32));
  const blob = c.encryptJson({ name: 'Kebede' });
  assert.deepEqual(c.decryptJson(blob), { name: 'Kebede' });
  assert.notDeepEqual(c.encryptJson({ name: 'Kebede' }), blob); // fresh IV every time
  blob[blob.length - 1] ^= 1;
  assert.throws(() => c.decryptJson(blob));
  assert.throws(() => cipher(randomBytes(32)).decrypt(c.encrypt(Buffer.from('x'))));
});

test('rejects malformed encryption keys', () => {
  assert.throws(() => parseKey('short'), /32 bytes/);
  assert.equal(parseKey(randomBytes(32).toString('base64')).length, 32);
});

test('hashes and verifies passwords', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.equal(await verifyPassword(undefined, hash), false);
});

test('limits failed logins per IP and globally, then resets', () => {
  let t = 0;
  const limiter = loginLimiter({ perIp: 2, global: 3, windowMs: 1000, now: () => t });
  limiter.recordFailure('a');
  assert.equal(limiter.isBlocked('a'), false);
  limiter.recordFailure('a');
  assert.equal(limiter.isBlocked('a'), true);
  assert.equal(limiter.isBlocked('b'), false);
  limiter.recordFailure('b');
  assert.equal(limiter.isBlocked('c'), true); // global cap reached
  t = 1001;
  assert.equal(limiter.isBlocked('a'), false);
});
