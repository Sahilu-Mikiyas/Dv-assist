// HTTP adapter: JSON API under /api, static pages from /public, /healthz for the platform.

import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPROVAL_METHODS, EDUCATION_LEVELS, MARITAL_STATUSES, PACKAGE_PRICES_ETB, PACKAGES, PAYMENT_METHODS, ValidationError,
} from '../domain/case.js';
import { PARTNER_TYPES } from '../domain/partner.js';
import { MAX_DOCUMENT_BYTES, MAX_PHOTO_BYTES } from '../domain/photo.js';
import { BitnobError } from '../infra/bitnob.js';
import { log } from '../infra/log.js';
import { TOGETHER_SESSION_MS } from './auth.js';
import { NotFoundError } from '../services/cases.js';
import { AuthError, ForbiddenError, ROLES } from '../services/staff.js';

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));
const MAX_JSON_BYTES = 64 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' blob:", "connect-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// A string field from a JSON body; anything else (objects, numbers) is refused cleanly instead of crashing.
function stringField(body, name) {
  const value = body[name];
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be text`);
  return value;
}

function adminOnly(ctx) {
  if (ctx.staff.role !== 'admin') throw new ForbiddenError('Admins only');
  return false;
}

const subjectOf = (id, version) => `${id}~${version}`;
function parseSubject(subject) {
  const [id, version] = String(subject).split('~');
  return { id, version: Number(version) };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        // Stop reading but let the 413 response go out; the connection closes after it.
        req.removeAllListeners('data');
        req.resume();
        reject(new HttpError(413, 'Request body too large'));
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Expected application/json');
  }
  const raw = await readBody(req, MAX_JSON_BYTES);
  let value;
  try {
    value = raw.length ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  // Every endpoint expects an object; null, arrays and plain values are refused before any handler sees them.
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Expected a JSON object');
  return value;
}

async function readJpeg(req, limit = MAX_PHOTO_BYTES) {
  if (req.headers['content-type'] !== 'image/jpeg') throw new HttpError(415, 'Expected image/jpeg');
  return readBody(req, limit + 1);
}

function send(res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body) || typeof body === 'string';
  res.writeHead(status, {
    'Content-Type': isBuffer ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isBuffer ? body : JSON.stringify(body ?? {}));
}

// Spreadsheet-safe cell: quoted, and a leading = + - @ is neutralised so a name cannot run as a formula.
const csvCell = (v) => {
  const text = String(v ?? '');
  return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};

// Monthly revenue-share statement: one line per month and stream, then the season total.
function revenueShareCsv(a, refCode) {
  const line = (month, stream, s) => [month, stream, s.applicants, s.revenue, s.costs.payment, s.costs.collection, s.costs.commission,
    s.costs.marketing, s.costs.support, s.costs.development, s.netProfit, s.pct, s.share];
  return csvFile(`revenue-share-${refCode}.csv`,
    ['month', 'stream', 'applicants', 'revenue_etb', 'payment_cost', 'collection_fee', 'tech_centre_commission', 'marketing', 'support',
      'development', 'net_profit_etb', 'share_pct', 'share_etb'],
    [...a.months.flatMap((m) => [line(m.month, 'direct', m.direct), line(m.month, 'through us', m.throughUs)]),
      line('season', 'direct', a.streams.direct), line('season', 'through us', a.streams.throughUs)]);
}

function csvFile(filename, header, rows) {
  return {
    body: `${[header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')}\n`,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
  };
}

// Bitnob signs webhooks with HMAC-SHA512 of the raw body, hex-encoded, in x-bitnob-signature.
function verifyWebhook(raw, signature, secret) {
  const expected = Buffer.from(createHmac('sha512', secret).update(raw).digest('hex'));
  const given = Buffer.from(String(signature ?? ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Each route: [method, pattern, stage, handler(req, params, ctx, url)] → { status?, body, headers? } | body.
// `stage`: 'public' (no session), 'applicant' (applicant cookie), 'partner' (partner cookie), 'setup' (staff
// signed in, authenticator not yet set up) or null (staff fully signed in).
function routes({
  cases, staff, applications, partners, payouts, economics, notifications, retention, authn, applicantAuthn, partnerAuthn,
  limiter, accountLimiter, startLimiter, resumeLimiter, partnerLimiter, partnerApplyLimiter, webhookSecret,
}) {
  // Staff and partner cookies carry the person's session version: bumping it (logout, password or code change)
  // makes every older cookie invalid at once.
  // The partner signed in on this device (for "fill in together"), if their session is still valid.
  const signedInPartnerId = async (req) => {
    const session = partnerAuthn.readSession(req);
    if (!session) return null;
    const { id, version } = parseSubject(session.subject);
    const partner = await partners.activeById(id);
    return partner && partner.sessionVersion === version ? partner.id : null;
  };
  const staffCookie = (member, stage = 'ok') => authn.sessionCookie(subjectOf(member.id, member.sessionVersion), { stage });

  return [
    ['POST', /^\/api\/login$/, 'public', async (req, _, ctx) => {
      const input = await readJson(req);
      const account = String(input.email ?? '').trim().toLowerCase();
      // Limited per connection and per account: guessing one person's password from many addresses is stopped,
      // and nobody can lock the whole team out.
      if (limiter.isBlocked(ctx.ip) || accountLimiter.isBlocked(account)) throw new HttpError(429, 'Too many failed attempts. Try again later.');
      try {
        const result = await staff.signIn(input, ctx);
        limiter.recordSuccess(ctx.ip);
        accountLimiter.recordSuccess(account);
        const member = await staff.activeById(result.staff.id);
        return { body: result, headers: { 'Set-Cookie': staffCookie(member, result.needsAuthenticator ? 'setup' : 'ok') } };
      } catch (err) {
        if (err instanceof AuthError) {
          limiter.recordFailure(ctx.ip);
          accountLimiter.recordFailure(account);
        }
        throw err;
      }
    }],
    ['POST', /^\/api\/webhooks\/bitnob$/, 'public', async (req, _, ctx) => {
      if (!webhookSecret) throw new HttpError(404, 'Not found');
      const raw = await readBody(req, MAX_JSON_BYTES);
      if (!verifyWebhook(raw, req.headers['x-bitnob-signature'], webhookSecret)) {
        throw new HttpError(401, 'Bad signature');
      }
      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        throw new HttpError(400, 'Invalid JSON');
      }
      await cases.handleBitnobEvent(event, ctx);
      return { received: true };
    }],
    ['POST', /^\/api\/logout$/, 'setup', async (_, __, ctx) => {
      await staff.signOut(ctx);
      return { body: { ok: true }, headers: { 'Set-Cookie': authn.clearCookie() } };
    }],
    ['GET', /^\/api\/me$/, 'setup', async (_, __, ctx) => ({ ...staff.me(ctx), stage: ctx.stage })],
    ['POST', /^\/api\/authenticator\/begin$/, 'setup', async (_, __, ctx) => staff.beginAuthenticator(ctx)],
    ['POST', /^\/api\/authenticator\/confirm$/, 'setup', async (req, _, ctx) => {
      const member = await staff.confirmAuthenticator(await readJson(req), ctx);
      return { body: { ok: true }, headers: { 'Set-Cookie': staffCookie(member) } };
    }],

    // What the policy pages say about how long data is kept: the configured retention rules.
    ['GET', /^\/api\/public\/policy$/, 'public', async () => ({ retention: retention.policy })],

    // Website applicants.
    ['GET', /^\/api\/apply\/options$/, 'public', async () => ({
      packages: PACKAGES, educationLevels: EDUCATION_LEVELS, maritalStatuses: MARITAL_STATUSES,
    })],
    ['POST', /^\/api\/apply\/start$/, 'public', async (req, _, ctx) => {
      // A partner filling the entry in with the applicant is signed in on this device. Partners are not limited
      // per connection (a shop may file many entries); everyone else is.
      const partnerId = await signedInPartnerId(req);
      if (!partnerId && startLimiter.isBlocked(ctx.ip)) throw new HttpError(429, 'Too many new entries from this connection. Try again later.');
      const input = await readJson(req);
      const { caseId, resumeCode, together, application } = await applications.start(input, { ...ctx, partnerId });
      if (!partnerId) startLimiter.recordFailure(ctx.ip); // counts every entry started, not only failures
      const cookie = applicantAuthn.sessionCookie(caseId, together ? { maxAgeMs: TOGETHER_SESSION_MS } : {});
      // Filled in together: the code goes to the applicant's own phone or email, never onto the partner's device.
      return { status: 201, body: { resumeCode: together ? null : resumeCode, together, application }, headers: { 'Set-Cookie': cookie } };
    }],
    ['POST', /^\/api\/apply\/resume$/, 'public', async (req, _, ctx) => {
      if (resumeLimiter.isBlocked(ctx.ip)) throw new HttpError(429, 'Too many wrong codes. Try again later.');
      const caseId = await applications.resume(stringField(await readJson(req), 'code'), ctx);
      if (!caseId) {
        resumeLimiter.recordFailure(ctx.ip);
        throw new HttpError(401, 'That code was not found. Check it and try again.');
      }
      resumeLimiter.recordSuccess(ctx.ip);
      return { body: await applications.get(caseId), headers: { 'Set-Cookie': applicantAuthn.sessionCookie(caseId) } };
    }],
    ['POST', /^\/api\/apply\/leave$/, 'public', async () => ({ body: { ok: true }, headers: { 'Set-Cookie': applicantAuthn.clearCookie() } })],
    ['GET', /^\/api\/apply$/, 'applicant', async (_, __, ctx) => applications.get(ctx.caseId)],
    ['PUT', /^\/api\/apply$/, 'applicant', async (req, _, ctx) => applications.update(ctx.caseId, await readJson(req), ctx)],
    ['GET', /^\/api\/apply\/photos\/(\w+)$/, 'applicant', async (_, [key], ctx) => ({
      body: await applications.getPhoto(ctx.caseId, key), headers: { 'Content-Type': 'image/jpeg' },
    })],
    ['PUT', /^\/api\/apply\/photos\/(\w+)$/, 'applicant', async (req, [key], ctx) =>
      applications.savePhoto(ctx.caseId, key, await readJpeg(req), ctx)],
    ['GET', /^\/api\/apply\/documents\/(\w+)$/, 'applicant', async (_, [kind], ctx) => ({
      body: await applications.getDocument(ctx.caseId, kind), headers: { 'Content-Type': 'image/jpeg' },
    })],
    ['PUT', /^\/api\/apply\/documents\/(\w+)$/, 'applicant', async (req, [kind], ctx) =>
      applications.saveDocument(ctx.caseId, kind, await readJpeg(req, MAX_DOCUMENT_BYTES), ctx)],
    ['POST', /^\/api\/apply\/send$/, 'applicant', async (_, __, ctx) => applications.send(ctx.caseId, ctx)],
    ['POST', /^\/api\/apply\/approve$/, 'applicant', async (req, _, ctx) => applications.approve(ctx.caseId, await readJson(req), ctx)],

    ['GET', /^\/api\/apply\/referrer$/, 'public', async (_, __, ___, url) => (await partners.referrer({
      ref: url.searchParams.get('ref'), invite: url.searchParams.get('invite'),
    })) ?? {}],

    // Referral partners.
    ['GET', /^\/api\/partners\/options$/, 'public', async () => ({ types: PARTNER_TYPES, packages: PACKAGES })],
    ['POST', /^\/api\/partners\/apply$/, 'public', async (req, _, ctx) => {
      if (partnerApplyLimiter.isBlocked(ctx.ip)) throw new HttpError(429, 'Too many applications from this connection. Try again later.');
      const result = await partners.apply(await readJson(req), ctx);
      partnerApplyLimiter.recordFailure(ctx.ip);
      return { status: 201, body: result };
    }],
    ['POST', /^\/api\/partner\/login$/, 'public', async (req, _, ctx) => {
      if (partnerLimiter.isBlocked(ctx.ip)) throw new HttpError(429, 'Too many wrong codes. Try again later.');
      const partnerId = await partners.signIn(stringField(await readJson(req), 'code'));
      if (!partnerId) {
        partnerLimiter.recordFailure(ctx.ip);
        throw new HttpError(401, 'That code was not found, or this partner account is not active.');
      }
      partnerLimiter.recordSuccess(ctx.ip);
      const partner = await partners.activeById(partnerId);
      return { body: { ok: true }, headers: { 'Set-Cookie': partnerAuthn.sessionCookie(subjectOf(partner.id, partner.sessionVersion)) } };
    }],
    ['POST', /^\/api\/partner\/logout$/, 'public', async (req) => {
      const session = partnerAuthn.readSession(req);
      const partner = session && (await partners.activeById(parseSubject(session.subject).id));
      if (partner && partner.sessionVersion === parseSubject(session.subject).version) await partners.signOut(partner);
      return { body: { ok: true }, headers: { 'Set-Cookie': partnerAuthn.clearCookie() } };
    }],
    ['GET', /^\/api\/partner$/, 'partner', async (_, __, ctx) => partners.dashboard(ctx.partner)],
    ['GET', /^\/api\/partner\/revenue-share$/, 'partner', async (_, __, ctx) => {
      const account = await partners.revenueShare(ctx.partner);
      if (!account) throw new HttpError(404, 'This account is not a revenue-share partnership');
      return account;
    }],
    ['GET', /^\/api\/partner\/revenue-share\.csv$/, 'partner', async (_, __, ctx) => {
      const account = await partners.revenueShare(ctx.partner);
      if (!account) throw new HttpError(404, 'This account is not a revenue-share partnership');
      return revenueShareCsv(account, ctx.partner.refCode);
    }],
    ['GET', /^\/api\/partner\/statement$/, 'partner', async (_, __, ctx) => partners.statement(ctx.partner)],
    ['GET', /^\/api\/partner\/statement\.csv$/, 'partner', async (_, __, ctx) => {
      const st = await partners.statement(ctx.partner);
      return csvFile(`statement-${st.refCode}.csv`,
        ['case', 'name', 'people', 'package', 'how', 'stage', 'applicant_paid', 'started', 'submitted', 'commission_etb', 'commission_status'],
        st.rows.map((r) => [r.code, r.name, r.people, r.package, r.how, r.stage, r.applicantPaid ? 'yes' : 'no',
          r.startedAt, r.submittedAt, r.commission?.amountEtb, r.commission?.status]));
    }],
    ['POST', /^\/api\/partners\/([\w-]+)\/terms$/, null, async (req, [id], ctx) => partners.setDeal(id, await readJson(req), ctx)],
    ['GET', /^\/api\/partners\/([\w-]+)\/revenue-share$/, null, async (_, [id], ctx) => {
      const account = await partners.revenueShareFor(id, ctx);
      if (!account) throw new HttpError(404, 'This partner has no revenue-share terms');
      return account;
    }],
    ['GET', /^\/api\/economics$/, null, async (_, __, ctx) => {
      if (ctx.staff.role !== 'admin') throw new ForbiddenError('Admins only');
      return economics.current();
    }],
    ['PUT', /^\/api\/economics$/, null, async (req, _, ctx) => economics.save(await readJson(req), ctx)],
    ['GET', /^\/api\/partners\/report$/, null, async (_, __, ctx) => partners.report(ctx)],
    ['GET', /^\/api\/partners\/report\.csv$/, null, async (_, __, ctx) => {
      const report = await partners.report(ctx);
      return csvFile('partner-report.csv',
        ['partner', 'code', 'status', 'referrals', 'people', 'invited', 'started', 'checking', 'filing', 'submitted', 'applicants_paid',
          'commission_paid_etb', 'commission_being_paid_etb', 'commission_due_etb', 'commission_earned_etb'],
        report.partners.map((r) => [r.organisation, r.refCode, r.status, r.referrals, r.people, r.byStage.invited, r.byStage.started,
          r.byStage.checking, r.byStage.filing, r.byStage.submitted, r.payments.paid, r.earnings.paidEtb, r.earnings.waitingEtb,
          r.earnings.dueEtb, r.earnings.earnedEtb]));
    }],
    ['POST', /^\/api\/partner\/introductions$/, 'partner', async (req, _, ctx) => ({
      status: 201, body: await partners.introduce(ctx.partner, await readJson(req), ctx),
    })],

    ['GET', /^\/api\/partners$/, null, async (_, __, ctx) => partners.list(ctx)],
    ['POST', /^\/api\/partners\/([\w-]+)\/code$/, null, async (_, [id], ctx) => partners.issueCode(id, ctx)],
    ['POST', /^\/api\/partners\/([\w-]+)\/status$/, null, async (req, [id], ctx) => partners.setStatus(id, (await readJson(req)).status, ctx)],
    ['GET', /^\/api\/introductions$/, null, async (_, __, ctx) => partners.introductions(ctx)],
    ['GET', /^\/api\/payouts$/, null, async (_, __, ctx) => payouts.overview(ctx)],
    ['POST', /^\/api\/payouts$/, null, async (req, _, ctx) => ({ status: 201, body: await payouts.create((await readJson(req)).partnerId, ctx) })],
    ['POST', /^\/api\/payouts\/([\w-]+)\/paid$/, null, async (req, [id], ctx) => payouts.markPaid(id, await readJson(req), ctx)],
    ['POST', /^\/api\/payouts\/([\w-]+)\/cancel$/, null, async (_, [id], ctx) => payouts.cancel(id, ctx)],
    ['GET', /^\/api\/payouts\.csv$/, null, async (_, __, ctx) => {
      const rows = await payouts.rows(ctx);
      const lines = [['created', 'partner', 'entries', 'rate_etb', 'amount_etb', 'status', 'telebirr_to', 'reference', 'settled', 'by'].join(','),
        ...rows.map((r) => [r.createdAt, r.organisation, r.entries, r.rateEtb, r.amountEtb, r.status, r.payTo, r.reference, r.settledAt, r.settledBy]
          .map(csvCell).join(','))];
      return {
        body: `${lines.join('\n')}\n`,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="partner-payouts.csv"' },
      };
    }],

    // Messages to applicants and partners that need a person to send them.
    // Admins only: waiting messages can hold resume codes.
    ['GET', /^\/api\/messages$/, null, async (_, __, ctx) => adminOnly(ctx) || ({
      ...(await notifications.overview()), toSend: await notifications.toSend(), recent: await notifications.recent(),
    })],
    ['POST', /^\/api\/messages\/(\d+)\/sent$/, null, async (_, [id], ctx) => {
      adminOnly(ctx);
      await notifications.markSent(Number(id), ctx);
      return { ok: true };
    }],

    // Data retention (admins).
    ['GET', /^\/api\/retention$/, null, async (_, __, ctx) => retention.overview(ctx)],
    ['POST', /^\/api\/retention\/run$/, null, async (_, __, ctx) => {
      if (ctx.staff.role !== 'admin') throw new ForbiddenError('Admins only');
      return retention.run(ctx);
    }],
    ['POST', /^\/api\/cases\/([\w-]+)\/erase$/, null, async (_, [id], ctx) => retention.eraseOne(id, ctx)],

    ['GET', /^\/api\/options$/, null, async () => ({
      educationLevels: EDUCATION_LEVELS, maritalStatuses: MARITAL_STATUSES, approvalMethods: APPROVAL_METHODS, roles: ROLES,
    })],
    ['GET', /^\/api\/cases$/, null, async (_, __, ___, url) => cases.list({
      status: url.searchParams.get('status') || undefined,
      q: url.searchParams.get('q') || undefined,
      assignedTo: url.searchParams.get('assignedTo') || undefined,
    })],
    ['POST', /^\/api\/cases$/, null, async (req, _, ctx) => ({ status: 201, body: await cases.create(await readJson(req), ctx) })],
    ['GET', /^\/api\/cases\/([\w-]+)$/, null, async (_, [id]) => cases.get(id)],
    ['PUT', /^\/api\/cases\/([\w-]+)$/, null, async (req, [id], ctx) => cases.update(id, await readJson(req), ctx)],
    ['GET', /^\/api\/cases\/([\w-]+)\/photos\/(\w+)$/, null, async (_, [id, key], __, url) => {
      const c = await cases.get(id);
      const headers = { 'Content-Type': 'image/jpeg' };
      if (url.searchParams.get('download')) headers['Content-Disposition'] = `attachment; filename="${c.code}-${key}.jpg"`;
      return { body: await cases.getPhoto(id, key), headers };
    }],
    ['PUT', /^\/api\/cases\/([\w-]+)\/photos\/(\w+)$/, null, async (req, [id, key], ctx) => {
      await cases.savePhoto(id, key, await readJpeg(req), ctx);
      return { ok: true };
    }],
    ['GET', /^\/api\/cases\/([\w-]+)\/documents\/(\w+)$/, null, async (_, [id, kind], __, url) => {
      const c = await cases.get(id);
      const headers = { 'Content-Type': 'image/jpeg' };
      if (url.searchParams.get('download')) headers['Content-Disposition'] = `attachment; filename="${c.code}-${kind}.jpg"`;
      return { body: await cases.getDocument(id, kind), headers };
    }],
    ['PUT', /^\/api\/cases\/([\w-]+)\/documents\/(\w+)$/, null, async (req, [id, kind], ctx) => {
      await cases.saveDocument(id, kind, await readJpeg(req, MAX_DOCUMENT_BYTES), ctx);
      return { ok: true };
    }],
    ['POST', /^\/api\/cases\/([\w-]+)\/assign$/, null, async (req, [id], ctx) => {
      const staffId = stringField(await readJson(req), 'staffId');
      // Only an active team member (or nobody) can be assigned.
      if (staffId && !(await staff.activeById(staffId))) throw new HttpError(422, 'No such active staff member');
      return cases.assign(id, staffId, ctx);
    }],
    ['POST', /^\/api\/cases\/([\w-]+)\/check$/, null, async (_, [id], ctx) => cases.check(id, ctx)],
    ['POST', /^\/api\/cases\/([\w-]+)\/verify$/, null, async (_, [id], ctx) => cases.verify(id, ctx)],
    ['POST', /^\/api\/cases\/([\w-]+)\/approve$/, null, async (req, [id], ctx) => cases.approve(id, (await readJson(req)).method, ctx)],
    ['POST', /^\/api\/cases\/([\w-]+)\/reopen$/, null, async (req, [id], ctx) => cases.reopen(id, (await readJson(req)).reason, ctx)],
    ['POST', /^\/api\/cases\/([\w-]+)\/card$/, null, async (_, [id], ctx) => cases.issueCard(id, ctx)],
    ['GET', /^\/api\/cases\/([\w-]+)\/card$/, null, async (_, [id], ctx) => cases.getCard(id, ctx)],
    ['POST', /^\/api\/cases\/([\w-]+)\/submit$/, null, async (req, [id], ctx) => {
      const { confirmationNumber } = await readJson(req);
      return cases.submit(id, confirmationNumber, ctx);
    }],
    ['POST', /^\/api\/cases\/([\w-]+)\/payment$/, null, async (req, [id], ctx) => cases.recordPayment(id, await readJson(req), ctx)],
    ['POST', /^\/api\/cases\/([\w-]+)\/payment\/refund$/, null, async (req, [id], ctx) => cases.refundPayment(id, (await readJson(req)).reason, ctx)],
    ['DELETE', /^\/api\/cases\/([\w-]+)\/payment$/, null, async (_, [id], ctx) => cases.removePayment(id, ctx)],
    ['GET', /^\/api\/cases\/([\w-]+)\/activity$/, null, async (_, [id]) => cases.activity(id)],

    ['GET', /^\/api\/staff\/directory$/, null, async () => staff.directory()],
    ['GET', /^\/api\/staff$/, null, async (_, __, ctx) => staff.list(ctx)],
    ['POST', /^\/api\/staff$/, null, async (req, _, ctx) => ({ status: 201, body: await staff.create(await readJson(req), ctx) })],
    ['PATCH', /^\/api\/staff\/([\w-]+)$/, null, async (req, [id], ctx) => staff.update(id, await readJson(req), ctx)],

    ['GET', /^\/api\/audit$/, null, async (_, __, ctx, url) => {
      if (ctx.staff.role !== 'admin') throw new ForbiddenError('Admins only');
      return cases.auditList({ actionPrefix: url.searchParams.get('kind') || undefined, limit: 500 });
    }],
    ['GET', /^\/api\/audit\.csv$/, null, async (_, __, ctx) => {
      if (ctx.staff.role !== 'admin') throw new ForbiddenError('Admins only');
      const rows = await cases.auditList({ limit: 10_000 });
      const lines = [['time', 'staff', 'action', 'case', 'detail', 'ip'].join(','),
        ...rows.map((r) => [r.at, r.staffName, r.action, r.caseCode, r.detail, r.ip].map(csvCell).join(','))];
      return {
        body: `${lines.join('\n')}\n`,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit-log.csv"' },
      };
    }],
  ];
}

// Clean URLs: "/" → index.html, "/staff/" → staff/index.html, "/apply" → apply.html.
function staticPath(pathname) {
  if (pathname.endsWith('/')) return `${pathname}index.html`;
  if (!extname(pathname)) return `${pathname}.html`;
  return pathname;
}

async function serveStatic(res, pathname) {
  const file = normalize(join(PUBLIC_DIR, staticPath(pathname)));
  if (!file.startsWith(PUBLIC_DIR + '/')) return notFoundPage(res);
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    notFoundPage(res);
  }
}

// People who mistype a link get a page with a way back, not raw JSON.
async function notFoundPage(res) {
  try {
    res.writeHead(404, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.end(await readFile(join(PUBLIC_DIR, '404.html')));
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

function toErrorResponse(err, requestId) {
  if (err instanceof ValidationError) return [422, { error: 'Validation failed', details: err.errors }];
  if (err instanceof NotFoundError) return [404, { error: err.message }];
  if (err instanceof AuthError) return [401, { error: err.message }];
  if (err instanceof ForbiddenError) return [403, { error: err.message }];
  if (err instanceof HttpError) return [err.status, { error: err.message }];
  if (err instanceof BitnobError) {
    log.warn('bitnob_error', { requestId, status: err.status, message: err.message, details: err.details });
    return [502, { error: `Bitnob: ${err.message}` }];
  }
  // Two requests doing the same thing at once: the database refused the second. Not a server fault.
  if (String(err.code ?? '').startsWith('SQLITE_CONSTRAINT') || /SQLITE_CONSTRAINT/.test(err.message ?? '')) {
    return [409, { error: 'This was just done by another request. Reload and check.' }];
  }
  log.error('unhandled_error', { requestId, message: err.message, stack: err.stack });
  return [500, { error: 'Internal error', requestId }];
}

// Blocks cross-site writes: browsers always send Origin on POST/PUT, and it must match our host.
function assertSameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    host = null; // e.g. "Origin: null" from sandboxed frames
  }
  if (host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
}

export function createApp(deps) {
  const { staff, authn, applicantAuthn, partnerAuthn, partners, trustProxy = false, hsts = false } = deps;
  const table = routes({ webhookSecret: null, ...deps });
  // Behind a proxy (Render, Railway) the client address is the entry the proxy itself appended: the last one.
  // Earlier entries come from the client and can be forged.
  const clientIp = (req) =>
    (trustProxy && req.headers['x-forwarded-for']?.split(',').at(-1).trim()) || req.socket.remoteAddress;

  return createServer(async (req, res) => {
    const started = performance.now();
    const requestId = randomUUID();
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => log.info('request', {
      requestId, method: req.method, path: pathname, status: res.statusCode, ms: Math.round(performance.now() - started),
    }));

    try {
      if (pathname === '/healthz') return send(res, 200, { ok: true });
      // Short links: /r/<partner code> for a partner's own link, /i/<reference> for a personal invitation.
      const short = pathname.match(/^\/(r|i)\/([A-Za-z0-9]{2,16})$/);
      if (short) {
        const param = short[1] === 'r' ? 'ref' : 'invite';
        return send(res, 302, {}, { Location: `/apply?${param}=${short[2].toUpperCase()}` });
      }
      if (!pathname.startsWith('/api/')) return await serveStatic(res, pathname);

      const route = table.find(([method, pattern]) => method === req.method && pattern.test(pathname));
      if (!route) throw new HttpError(404, 'Not found');
      const [, pattern, stage, handler] = route;

      // Webhooks come from Bitnob's servers, not a browser, so the Origin check does not apply to them.
      if (!pathname.startsWith('/api/webhooks/')) assertSameOrigin(req);
      const ctx = { ip: clientIp(req) };
      if (stage === 'applicant') {
        const session = applicantAuthn.readSession(req);
        if (!session) throw new HttpError(401, 'Enter your resume code to continue');
        ctx.caseId = session.subject;
      } else if (stage === 'partner') {
        const session = partnerAuthn.readSession(req);
        const subject = session && parseSubject(session.subject);
        const partner = subject && (await partners.activeById(subject.id));
        if (!partner || partner.sessionVersion !== subject.version) throw new HttpError(401, 'Sign in with your partner code');
        ctx.partner = partner;
      } else if (stage !== 'public') {
        const session = authn.readSession(req);
        const subject = session && parseSubject(session.subject);
        const member = subject && (await staff.activeById(subject.id));
        if (!member || member.sessionVersion !== subject.version) throw new HttpError(401, 'Login required');
        // A password-only "setup" session ends once the authenticator exists: it can never replace it.
        if (session.stage === 'setup' && member.totpSecret) throw new HttpError(401, 'Login required');
        if (session.stage === 'setup' && stage !== 'setup') throw new HttpError(403, 'Set up your authenticator first');
        Object.assign(ctx, { staff: member, stage: session.stage });
      }

      const result = await handler(req, pathname.match(pattern).slice(1), ctx, url);
      const isEnvelope = result && typeof result === 'object' && !Array.isArray(result) && 'body' in result;
      return send(res, isEnvelope ? (result.status ?? 200) : 200, isEnvelope ? result.body : result,
        isEnvelope ? result.headers : undefined);
    } catch (err) {
      if (!res.headersSent) send(res, ...toErrorResponse(err, requestId));
    }
  });
}
