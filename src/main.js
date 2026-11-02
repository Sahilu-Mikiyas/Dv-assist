// Composition root: build dependencies, start the server, shut down cleanly on SIGTERM.

import { loadConfig } from './config.js';
import { applicantAuth, auth, partnerAuth } from './http/auth.js';
import { loginLimiter } from './http/rate-limit.js';
import { createApp } from './http/server.js';
import { bitnobClient } from './infra/bitnob.js';
import { cipher } from './infra/crypto.js';
import { auditLog, caseRepository, messageRepository, openDb, partnerRepository, staffRepository } from './infra/db.js';
import { afroMessageSms, brevoEmail } from './infra/messaging.js';
import { log } from './infra/log.js';
import { applicationService } from './services/applications.js';
import { caseService } from './services/cases.js';
import { notificationService } from './services/notifications.js';
import { partnerService } from './services/partners.js';
import { staffService } from './services/staff.js';

const config = loadConfig();
const db = await openDb(config.database);
const audit = auditLog(db);
const crypt = cipher(config.encryptionKey);

const staff = staffService({ repo: staffRepository(db, crypt), audit });
if (await staff.bootstrap(config.firstAdmin)) log.info('first_admin_created', { email: config.firstAdmin.email });

const notifications = notificationService({
  repo: messageRepository(db, crypt),
  audit,
  sms: config.messaging.sms ? afroMessageSms(config.messaging.sms) : null,
  email: config.messaging.email ? brevoEmail(config.messaging.email) : null,
  publicUrl: config.publicUrl,
});

const caseRepo = caseRepository(db, crypt);
const partners = partnerService({
  repo: partnerRepository(db, crypt), caseRepo, audit, commissionEtb: config.partnerCommissionEtb, notifications,
});
const cases = caseService({
  repo: caseRepo,
  partners,
  notifications,
  audit,
  bitnob: bitnobClient(config.bitnob),
  cardAmountUsd: config.cardAmountUsd,
});

const server = createApp({
  cases,
  staff,
  partners,
  applications: applicationService({ repo: caseRepo, audit, partners, notifications }),
  notifications,
  authn: auth(config),
  applicantAuthn: applicantAuth(config),
  partnerAuthn: partnerAuth(config),
  limiter: loginLimiter(),
  startLimiter: loginLimiter({ perIp: 10, global: 500, windowMs: 60 * 60 * 1000 }),
  resumeLimiter: loginLimiter({ perIp: 10, global: 200 }),
  partnerLimiter: loginLimiter({ perIp: 10, global: 200 }),
  trustProxy: config.trustProxy,
  hsts: config.secureCookies,
  webhookSecret: config.bitnob.webhookSecret,
});

server.listen(config.port, () => log.info('started', {
  port: config.port, sms: Boolean(config.messaging.sms), email: Boolean(config.messaging.email),
}));

// Retries and anything queued before a restart. New messages are also sent right away when queued.
const messageTimer = setInterval(() => notifications.wake(), 30_000);
messageTimer.unref();
notifications.wake();

function shutdown(signal) {
  log.info('shutting_down', { signal });
  clearInterval(messageTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
