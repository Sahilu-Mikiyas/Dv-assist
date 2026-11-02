// Random codes people type or read out: resume codes, partner sign-in codes, invitation references.
// No 0/O or 1/I, so a code read out over the phone cannot be misheard. Only hashes are stored.

import { createHash, randomInt } from 'node:crypto';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const randomChars = (length) =>
  Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

// 12 characters in groups of four, e.g. "K7Q2-M9XD-4TPA": 32^12 = 2^60 possibilities.
export const newAccessCode = () => randomChars(12).match(/.{4}/g).join('-');

export const normalizeCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const hashCode = (code) => createHash('sha256').update(normalizeCode(code)).digest('hex');
