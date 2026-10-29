// HTTP adapter: JSON API under /api, static pages from /public.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDUCATION_LEVELS, MARITAL_STATUSES, ValidationError } from '../domain/case.js';
import { MAX_PHOTO_BYTES } from '../domain/photo.js';
import { BitnobError } from '../infra/bitnob.js';
import { NotFoundError } from '../services/cases.js';

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));
const MAX_JSON_BYTES = 1024 * 1024;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

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
  const raw = await readBody(req, MAX_JSON_BYTES);
  try {
    return raw.length ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function send(res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isBuffer ? 'application/octet-stream' : 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isBuffer ? body : JSON.stringify(body ?? {}));
}

// Each route: [method, pattern, handler(req, params)] → { status?, body, headers? } | body
function routes(cases, authn) {
  return [
    ['POST', /^\/api\/login$/, async (req) => {
      const { password } = await readJson(req);
      if (!authn.checkPassword(password)) throw new HttpError(401, 'Wrong password');
      return { body: { ok: true }, headers: { 'Set-Cookie': authn.sessionCookie() } };
    }],
    ['POST', /^\/api\/logout$/, async () => ({ body: { ok: true }, headers: { 'Set-Cookie': authn.clearCookie() } })],
    ['GET', /^\/api\/options$/, async () => ({ educationLevels: EDUCATION_LEVELS, maritalStatuses: MARITAL_STATUSES })],
    ['GET', /^\/api\/cases$/, async () => cases.list()],
    ['POST', /^\/api\/cases$/, async (req) => ({ status: 201, body: cases.create(await readJson(req)) })],
    ['GET', /^\/api\/cases\/([\w-]+)$/, async (_, [id]) => cases.get(id)],
    ['PUT', /^\/api\/cases\/([\w-]+)$/, async (req, [id]) => cases.update(id, await readJson(req))],
    ['GET', /^\/api\/cases\/([\w-]+)\/photos\/(\w+)$/, async (_, [id, key]) => ({
      body: cases.getPhoto(id, key), headers: { 'Content-Type': 'image/jpeg' },
    })],
    ['PUT', /^\/api\/cases\/([\w-]+)\/photos\/(\w+)$/, async (req, [id, key]) => {
      cases.savePhoto(id, key, await readBody(req, MAX_PHOTO_BYTES + 1));
      return { ok: true };
    }],
    ['POST', /^\/api\/cases\/([\w-]+)\/card$/, async (_, [id]) => cases.issueCard(id)],
    ['GET', /^\/api\/cases\/([\w-]+)\/card$/, async (_, [id]) => cases.getCard(id)],
    ['POST', /^\/api\/cases\/([\w-]+)\/submit$/, async (req, [id]) => {
      const { confirmationNumber } = await readJson(req);
      return cases.submit(id, confirmationNumber);
    }],
  ];
}

const PUBLIC_API = new Set(['/api/login']);

async function serveStatic(res, pathname) {
  const file = normalize(join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 404, { error: 'Not found' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

function toErrorResponse(err) {
  if (err instanceof ValidationError) return [422, { error: 'Validation failed', details: err.errors }];
  if (err instanceof NotFoundError) return [404, { error: err.message }];
  if (err instanceof HttpError) return [err.status, { error: err.message }];
  if (err instanceof BitnobError) return [502, { error: `Bitnob: ${err.message}` }];
  console.error(err);
  return [500, { error: 'Internal error' }];
}

export function createApp({ cases, authn }) {
  const table = routes(cases, authn);

  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (!pathname.startsWith('/api/')) return await serveStatic(res, pathname);
      if (!PUBLIC_API.has(pathname) && !authn.isAuthenticated(req)) throw new HttpError(401, 'Login required');

      for (const [method, pattern, handler] of table) {
        const match = pathname.match(pattern);
        if (!match || req.method !== method) continue;
        const result = await handler(req, match.slice(1));
        const isEnvelope = result && typeof result === 'object' && 'body' in result;
        return send(res, isEnvelope ? (result.status ?? 200) : 200, isEnvelope ? result.body : result,
          isEnvelope ? result.headers : undefined);
      }
      throw new HttpError(404, 'Not found');
    } catch (err) {
      send(res, ...toErrorResponse(err));
    }
  });
}
