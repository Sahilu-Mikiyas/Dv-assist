// HTTP adapter: JSON API under /api, static pages from /public, /healthz for the platform.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDUCATION_LEVELS, MARITAL_STATUSES, ValidationError } from '../domain/case.js';
import { MAX_PHOTO_BYTES } from '../domain/photo.js';
import { BitnobError } from '../infra/bitnob.js';
import { log } from '../infra/log.js';
import { NotFoundError } from '../services/cases.js';

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));
const MAX_JSON_BYTES = 64 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' blob:", "connect-src 'self'",
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
  const isBuffer = Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isBuffer ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isBuffer ? body : JSON.stringify(body ?? {}));
}

// Each route: [method, pattern, handler(req, params, ctx)] → { status?, body, headers? } | body
function routes({ cases, authn, limiter, audit }) {
  return [
    ['POST', /^\/api\/login$/, async (req, _, ctx) => {
      if (limiter.isBlocked(ctx.ip)) throw new HttpError(429, 'Too many failed attempts. Try again later.');
      const { password } = await readJson(req);
      if (!(await authn.checkPassword(password))) {
        limiter.recordFailure(ctx.ip);
        await audit.record({ action: 'login_failed', ip: ctx.ip });
        throw new HttpError(401, 'Wrong password');
      }
      limiter.recordSuccess(ctx.ip);
      await audit.record({ action: 'login', ip: ctx.ip });
      return { body: { ok: true }, headers: { 'Set-Cookie': authn.sessionCookie() } };
    }],
    ['POST', /^\/api\/logout$/, async () => ({ body: { ok: true }, headers: { 'Set-Cookie': authn.clearCookie() } })],
    ['GET', /^\/api\/options$/, async () => ({ educationLevels: EDUCATION_LEVELS, maritalStatuses: MARITAL_STATUSES })],
    ['GET', /^\/api\/cases$/, async () => cases.list()],
    ['POST', /^\/api\/cases$/, async (req, _, ctx) => ({ status: 201, body: await cases.create(await readJson(req), ctx) })],
    ['GET', /^\/api\/cases\/([\w-]+)$/, async (_, [id]) => cases.get(id)],
    ['PUT', /^\/api\/cases\/([\w-]+)$/, async (req, [id], ctx) => cases.update(id, await readJson(req), ctx)],
    ['GET', /^\/api\/cases\/([\w-]+)\/photos\/(\w+)$/, async (_, [id, key]) => ({
      body: await cases.getPhoto(id, key), headers: { 'Content-Type': 'image/jpeg' },
    })],
    ['PUT', /^\/api\/cases\/([\w-]+)\/photos\/(\w+)$/, async (req, [id, key], ctx) => {
      await cases.savePhoto(id, key, await readJpeg(req), ctx);
      return { ok: true };
    }],
    ['POST', /^\/api\/cases\/([\w-]+)\/card$/, async (_, [id], ctx) => cases.issueCard(id, ctx)],
    ['GET', /^\/api\/cases\/([\w-]+)\/card$/, async (_, [id], ctx) => cases.getCard(id, ctx)],
    ['POST', /^\/api\/cases\/([\w-]+)\/submit$/, async (req, [id], ctx) => {
      const { confirmationNumber } = await readJson(req);
      return cases.submit(id, confirmationNumber, ctx);
    }],
  ];
}

const PUBLIC_API = new Set(['/api/login']);

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
  if (err instanceof HttpError) return [err.status, { error: err.message }];
  if (err instanceof BitnobError) {
    log.warn('bitnob_error', { requestId, status: err.status, message: err.message });
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

export function createApp({ cases, authn, limiter, audit, trustProxy = false, hsts = false }) {
  const table = routes({ cases, authn, limiter, audit });
  const clientIp = (req) =>
    (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;

  return createServer(async (req, res) => {
    const started = performance.now();
    const requestId = randomUUID();
    const { pathname } = new URL(req.url, 'http://localhost');
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => log.info('request', {
      requestId, method: req.method, path: pathname, status: res.statusCode, ms: Math.round(performance.now() - started),
    }));

    try {
      if (pathname === '/healthz') return send(res, 200, { ok: true });
      if (!pathname.startsWith('/api/')) return await serveStatic(res, pathname);
      assertSameOrigin(req);
      if (!PUBLIC_API.has(pathname) && !authn.isAuthenticated(req)) throw new HttpError(401, 'Login required');

      const ctx = { ip: clientIp(req) };
      for (const [method, pattern, handler] of table) {
        const match = pathname.match(pattern);
        if (!match || req.method !== method) continue;
        const result = await handler(req, match.slice(1), ctx);
        const isEnvelope = result && typeof result === 'object' && 'body' in result;
        return send(res, isEnvelope ? (result.status ?? 200) : 200, isEnvelope ? result.body : result,
          isEnvelope ? result.headers : undefined);
      }
      throw new HttpError(404, 'Not found');
    } catch (err) {
      if (!res.headersSent) send(res, ...toErrorResponse(err, requestId));
    }
  });
}
