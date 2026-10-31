// Signed, expiring session cookie: "<staffId>.<expires>.<stage>.<signature>".
// stage "ok" = fully signed in; "setup" = password accepted, authenticator not set up yet.

import { createHmac, timingSafeEqual } from 'node:crypto';

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

export function auth({ sessionSecret, secureCookies }) {
  // __Host- cookies are only accepted over HTTPS, for this exact host, with Path=/.
  const name = secureCookies ? '__Host-dv_session' : 'dv_session';
  const attrs = `Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;

  return {
    sessionCookie(staffId, { stage = 'ok' } = {}) {
      const value = `${staffId}.${Date.now() + SESSION_MS}.${stage}`;
      return `${name}=${value}.${sign(sessionSecret, value)}; Max-Age=${SESSION_MS / 1000}; ${attrs}`;
    },

    clearCookie: () => `${name}=; Max-Age=0; ${attrs}`,

    // Returns { staffId, stage } for a valid, unexpired cookie, else null.
    readSession(req) {
      const parts = (readCookie(req, name) ?? '').split('.');
      if (parts.length !== 4) return null;
      const [staffId, expires, stage, sig] = parts;
      if (!safeEqual(sig, sign(sessionSecret, `${staffId}.${expires}.${stage}`))) return null;
      if (Number(expires) <= Date.now() || !['ok', 'setup'].includes(stage)) return null;
      return { staffId, stage };
    },
  };
}
