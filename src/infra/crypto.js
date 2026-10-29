// Encryption at rest (AES-256-GCM) and password hashing (scrypt).

import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const IV_BYTES = 12;
const TAG_BYTES = 16;

// Encrypted blob layout: version(1) | iv(12) | tag(16) | ciphertext
const VERSION = 1;

export function parseKey(base64) {
  const key = Buffer.from(base64 ?? '', 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return key;
}

export function cipher(key) {
  function encrypt(plain) {
    const iv = randomBytes(IV_BYTES);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), body]);
  }

  function decrypt(blob) {
    const buf = Buffer.from(blob);
    if (buf[0] !== VERSION) throw new Error('Unknown encryption version');
    const iv = buf.subarray(1, 1 + IV_BYTES);
    const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(buf.subarray(1 + IV_BYTES + TAG_BYTES)), d.final()]);
  }

  return {
    encrypt,
    decrypt,
    encryptJson: (value) => encrypt(Buffer.from(JSON.stringify(value))),
    decryptJson: (blob) => JSON.parse(decrypt(blob).toString('utf8')),
  };
}

// Hash format: scrypt$N$r$p$saltBase64$hashBase64
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || typeof password !== 'string') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(actual, expected);
}
