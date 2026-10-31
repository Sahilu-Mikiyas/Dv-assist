// Signed, expiring session cookies: "<subject>.<expires>.<stage>.<signature>".
// Staff cookie: subject = staff id; stage "ok" = fully signed in, "setup" = authenticator not set up yet.
// Applicant cookie: subject = case id; stage "applicant".

import { createHmac, timingSafeEqual } from 'node:crypto';

const HOUR_MS = 60 * 60 * 1000;

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

export function auth({
  sessionSecret, secureCookies, cookie = 'dv_session', maxAgeMs = 8 * HOUR_MS, stages = ['ok', 'setup'],
}) {
  // __Host- cookies are only accepted over HTTPS, for this exact host, with Path=/.
  const name = secureCookies ? `__Host-${cookie}` : cookie;
  const attrs = `Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;
  // The cookie name is part of what is signed, so one kind of cookie can never pass as another.
  const sign = (value) => createHmac('sha256', sessionSecret).update(`${cookie}|${value}`).digest('base64url');

  return {
    sessionCookie(subject, { stage = stages[0] } = {}) {
      const value = `${subject}.${Date.now() + maxAgeMs}.${stage}`;
      return `${name}=${value}.${sign(value)}; Max-Age=${Math.floor(maxAgeMs / 1000)}; ${attrs}`;
    },

    clearCookie: () => `${name}=; Max-Age=0; ${attrs}`,

    // Returns { subject, stage } for a valid, unexpired cookie, else null.
    readSession(req) {
      const parts = (readCookie(req, name) ?? '').split('.');
      if (parts.length !== 4) return null;
      const [subject, expires, stage, sig] = parts;
      if (!safeEqual(sig, sign(`${subject}.${expires}.${stage}`))) return null;
      if (Number(expires) <= Date.now() || !stages.includes(stage)) return null;
      return { subject, stage };
    },
  };
}

export const applicantAuth = ({ sessionSecret, secureCookies }) =>
  auth({ sessionSecret, secureCookies, cookie: 'dv_applicant', maxAgeMs: 30 * 24 * HOUR_MS, stages: ['applicant'] });
