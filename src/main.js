// Composition root: build dependencies, start the server, shut down cleanly on SIGTERM.

import { loadConfig } from './config.js';
import { auth } from './http/auth.js';
import { loginLimiter } from './http/rate-limit.js';
import { createApp } from './http/server.js';
import { bitnobClient } from './infra/bitnob.js';
import { cipher } from './infra/crypto.js';
import { auditLog, caseRepository, openDb, staffRepository } from './infra/db.js';
import { log } from './infra/log.js';
import { caseService } from './services/cases.js';
import { staffService } from './services/staff.js';

const config = loadConfig();
const db = await openDb(config.database);
const audit = auditLog(db);
const crypt = cipher(config.encryptionKey);

const staff = staffService({ repo: staffRepository(db, crypt), audit });
if (await staff.bootstrap(config.firstAdmin)) log.info('first_admin_created', { email: config.firstAdmin.email });

const cases = caseService({
  repo: caseRepository(db, crypt),
  audit,
  bitnob: bitnobClient(config.bitnob),
  cardAmountUsd: config.cardAmountUsd,
});

const server = createApp({
  cases,
  staff,
  authn: auth(config),
  limiter: loginLimiter(),
  trustProxy: config.trustProxy,
  hsts: config.secureCookies,
  webhookSecret: config.bitnob.webhookSecret,
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
