// Composition root: build dependencies, start the server, shut down cleanly on SIGTERM.

import { loadConfig } from './config.js';
import { applicantAuth, auth, partnerAuth } from './http/auth.js';
import { loginLimiter } from './http/rate-limit.js';
import { createApp } from './http/server.js';
import { bitnobClient } from './infra/bitnob.js';
import { cipher } from './infra/crypto.js';
import {
  auditLog, caseRepository, messageRepository, openDb, partnerRepository, settingsRepository, staffRepository,
} from './infra/db.js';
import { afroMessageSms, brevoEmail } from './infra/messaging.js';
import { writeBackup } from './infra/backup.js';
import { log } from './infra/log.js';
import { applicationService } from './services/applications.js';
import { caseService } from './services/cases.js';
import { economicsService } from './services/economics.js';
import { notificationService } from './services/notifications.js';
import { partnerService } from './services/partners.js';
import { payoutService } from './services/payouts.js';
import { reminderService } from './services/reminders.js';
import { retentionService } from './services/retention.js';
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
const fingerprinted = await caseRepo.backfillFingerprints();
if (fingerprinted) log.info('fingerprints_backfilled', { cases: fingerprinted });
const partnerRepo = partnerRepository(db, crypt);
const economics = economicsService({ settingsRepo: settingsRepository(db), audit, envCommissionEtb: config.partnerCommissionEtb });
const partners = partnerService({
  repo: partnerRepo, caseRepo, audit, notifications,
  commission: () => economics.techCenterCommission(), economics: () => economics.values(),
  economicsHistory: () => economics.history(),
});
const retention = retentionService({ caseRepo, partnerRepo, audit, policy: config.retention, isIssuing: (id) => cases.isIssuing(id) });
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
  retention,
  economics,
  payouts: payoutService({
    partnerRepo, caseRepo, audit, notifications,
    commission: () => economics.techCenterCommission(), revenueShare: (p) => partners.revenueShare(p),
  }),
  authn: auth(config),
  applicantAuthn: applicantAuth(config),
  partnerAuthn: partnerAuth(config),
  // Per-connection and per-account limits only: there is no global cap, so nobody can lock everyone out.
  // Resume and partner codes are 12 random characters (2^60), so per-connection limits are plenty.
  limiter: loginLimiter({ perIp: 10, global: Infinity }),
  accountLimiter: loginLimiter({ perIp: 5, global: Infinity }),
  startLimiter: loginLimiter({ perIp: 30, global: Infinity, windowMs: 60 * 60 * 1000 }),
  resumeLimiter: loginLimiter({ perIp: 10, global: Infinity }),
  partnerLimiter: loginLimiter({ perIp: 10, global: Infinity }),
  partnerApplyLimiter: loginLimiter({ perIp: 5, global: Infinity, windowMs: 60 * 60 * 1000 }),
  audit,
  backup: (write) => writeBackup(db, write),
  health: () => db.execute('SELECT 1'),
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

// Periodic jobs at start and every 6 hours: data retention rules and reminders.
const reminders = reminderService({ caseRepo, notifications });
const sweep = () => Promise.all([
  retention.run().then((n) => n.submitted + n.unsent + n.introductions && log.info('retention_run', n))
    .catch((err) => log.error('retention_failed', { message: err.message })),
  reminders.run().then((n) => n && log.info('reminders_sent', { count: n }))
    .catch((err) => log.error('reminders_failed', { message: err.message })),
]);
const retentionTimer = setInterval(sweep, 6 * 60 * 60 * 1000);
retentionTimer.unref();
sweep();

function shutdown(signal) {
  log.info('shutting_down', { signal });
  clearInterval(messageTimer);
  clearInterval(retentionTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
