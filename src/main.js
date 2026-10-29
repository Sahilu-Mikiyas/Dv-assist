// Composition root: build dependencies, start the server, shut down cleanly on SIGTERM.

import { loadConfig } from './config.js';
import { auth } from './http/auth.js';
import { loginLimiter } from './http/rate-limit.js';
import { createApp } from './http/server.js';
import { bitnobClient } from './infra/bitnob.js';
import { cipher } from './infra/crypto.js';
import { auditLog, caseRepository, openDb } from './infra/db.js';
import { log } from './infra/log.js';
import { caseService } from './services/cases.js';

const config = loadConfig();
const db = await openDb(config.database);
const audit = auditLog(db);

const cases = caseService({
  repo: caseRepository(db, cipher(config.encryptionKey)),
  audit,
  bitnob: bitnobClient(config.bitnob),
  cardAmountUsd: config.cardAmountUsd,
});

const server = createApp({
  cases,
  audit,
  authn: auth(config),
  limiter: loginLimiter(),
  trustProxy: config.trustProxy,
  hsts: config.hsts,
});

server.listen(config.port, () => log.info('started', { port: config.port }));

function shutdown(signal) {
  log.info('shutting_down', { signal });
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
