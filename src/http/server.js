// HTTP adapter: JSON API under /api, static pages from /public, /healthz for the platform.

import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVAL_METHODS, EDUCATION_LEVELS, MARITAL_STATUSES, ValidationError } from '../domain/case.js';
import { MAX_PHOTO_BYTES } from '../domain/photo.js';
import { BitnobError } from '../infra/bitnob.js';
import { log } from '../infra/log.js';
import { NotFoundError } from '../services/cases.js';
import { AuthError, ForbiddenError, ROLES } from '../services/staff.js';

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));
const MAX_JSON_BYTES = 64 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
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
  try {
    return raw.length ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

async function readJpeg(req) {
  if (req.headers['content-type'] !== 'image/jpeg') throw new HttpError(415, 'Expected image/jpeg');
  return readBody(req, MAX_PHOTO_BYTES + 1);
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

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// Bitnob signs webhooks with HMAC-SHA512 of the raw body, hex-encoded, in x-bitnob-signature.
function verifyWebhook(raw, signature, secret) {
  const expected = Buffer.from(createHmac('sha512', secret).update(raw).digest('hex'));
  const given = Buffer.from(String(signature ?? ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Each route: [method, pattern, handler(req, params, ctx, url)] → { status?, body, headers? } | body.
// `stage`: 'public' (no session), 'setup' (signed in, authenticator not yet set up) or default (fully signed in).
function routes({ cases, staff, authn, limiter, webhookSecret }) {
  const sessionFor = (result) => authn.sessionCookie(result.staff.id, { stage: result.needsAuthenticator ? 'setup' : 'ok' });

  return [
    ['POST', /^\/api\/login$/, 'public', async (req, _, ctx) => {
      if (limiter.isBlocked(ctx.ip)) throw new HttpError(429, 'Too many failed attempts. Try again later.');
      try {
        const result = await staff.signIn(await readJson(req), ctx);
        limiter.recordSuccess(ctx.ip);
        return { body: result, headers: { 'Set-Cookie': sessionFor(result) } };
      } catch (err) {
        if (err instanceof AuthError) limiter.recordFailure(ctx.ip);
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
    ['POST', /^\/api\/logout$/, 'setup', async () => ({ body: { ok: true }, headers: { 'Set-Cookie': authn.clearCookie() } })],
    ['GET', /^\/api\/me$/, 'setup', async (_, __, ctx) => ({ ...staff.me(ctx), stage: ctx.stage })],
    ['POST', /^\/api\/authenticator\/begin$/, 'setup', async (_, __, ctx) => staff.beginAuthenticator(ctx)],
    ['POST', /^\/api\/authenticator\/confirm$/, 'setup', async (req, _, ctx) => {
      await staff.confirmAuthenticator(await readJson(req), ctx);
      return { body: { ok: true }, headers: { 'Set-Cookie': authn.sessionCookie(ctx.staff.id) } };
    }],

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
    ['POST', /^\/api\/cases\/([\w-]+)\/assign$/, null, async (req, [id], ctx) => cases.assign(id, (await readJson(req)).staffId, ctx)],
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

async function serveStatic(res, pathname) {
  const file = normalize(join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR + '/')) return send(res, 404, { error: 'Not found' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
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

export function createApp({ cases, staff, authn, limiter, trustProxy = false, hsts = false, webhookSecret = null }) {
  const table = routes({ cases, staff, authn, limiter, webhookSecret });
  const clientIp = (req) =>
    (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;

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
      if (!pathname.startsWith('/api/')) return await serveStatic(res, pathname);

      const route = table.find(([method, pattern]) => method === req.method && pattern.test(pathname));
      if (!route) throw new HttpError(404, 'Not found');
      const [, pattern, stage, handler] = route;

      // Webhooks come from Bitnob's servers, not a browser, so the Origin check does not apply to them.
      if (!pathname.startsWith('/api/webhooks/')) assertSameOrigin(req);
      const ctx = { ip: clientIp(req) };
      if (stage !== 'public') {
        const session = authn.readSession(req);
        const member = session && (await staff.activeById(session.staffId));
        if (!member) throw new HttpError(401, 'Login required');
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
