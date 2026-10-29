// Single-operator login: one password, a signed expiring session cookie.

import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'dv_session';
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

export function auth({ adminPassword, sessionSecret, secureCookies }) {
  const attrs = `Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;

  return {
    checkPassword: (password) => typeof password === 'string' && safeEqual(password, adminPassword),

    sessionCookie() {
      const expires = String(Date.now() + SESSION_MS);
      return `${COOKIE}=${expires}.${sign(sessionSecret, expires)}; Max-Age=${SESSION_MS / 1000}; ${attrs}`;
    },

    clearCookie: () => `${COOKIE}=; Max-Age=0; ${attrs}`,

    isAuthenticated(req) {
      const [expires, sig] = (readCookie(req, COOKIE) ?? '').split('.');
      if (!expires || !sig) return false;
      return safeEqual(sig, sign(sessionSecret, expires)) && Number(expires) > Date.now();
    },
  };
}
