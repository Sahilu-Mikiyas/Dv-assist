// Single-operator login: scrypt-hashed password, signed expiring session cookie.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { verifyPassword } from '../infra/crypto.js';

const SESSION_MS = 8 * 60 * 60 * 1000;

const sign = (secret, value) => createHmac('sha256', secret).update(value).digest('base64url');

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function auth({ adminPasswordHash, sessionSecret, secureCookies }) {
  // __Host- cookies are only accepted over HTTPS, for this exact host, with Path=/.
  const name = secureCookies ? '__Host-dv_session' : 'dv_session';
  const attrs = `Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;

  return {
    checkPassword: (password) => verifyPassword(password, adminPasswordHash),

    sessionCookie() {
      const expires = String(Date.now() + SESSION_MS);
      return `${name}=${expires}.${sign(sessionSecret, expires)}; Max-Age=${SESSION_MS / 1000}; ${attrs}`;
    },

    clearCookie: () => `${name}=; Max-Age=0; ${attrs}`,

    isAuthenticated(req) {
      const [expires, sig] = (readCookie(req, name) ?? '').split('.');
      if (!expires || !sig) return false;
      return safeEqual(sig, sign(sessionSecret, expires)) && Number(expires) > Date.now();
    },
  };
}
