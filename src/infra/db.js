// Persistence via libSQL: a local SQLite file (file:...) or a hosted Turso database (libsql://...).
// Applicant data and photos are encrypted before they leave the process.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';

// Append-only: each entry runs once, in order, and is recorded in schema_migrations.
const MIGRATIONS = [
  `CREATE TABLE cases (
     id                  TEXT PRIMARY KEY,
     applicant           BLOB NOT NULL,
     status              TEXT NOT NULL,
     card_id             TEXT,
     card_reference      TEXT,
     confirmation_number TEXT,
     created_at          TEXT NOT NULL,
     updated_at          TEXT NOT NULL
   )`,
  `CREATE TABLE photos (
     case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     person_key TEXT NOT NULL,
     data       BLOB NOT NULL,
     PRIMARY KEY (case_id, person_key)
   )`,
  `CREATE TABLE audit_events (
     id      INTEGER PRIMARY KEY AUTOINCREMENT,
     at      TEXT NOT NULL,
     action  TEXT NOT NULL,
     case_id TEXT,
     ip      TEXT
   )`,
  `CREATE TABLE staff (
     id            TEXT PRIMARY KEY,
     email         TEXT NOT NULL UNIQUE,
     name          TEXT NOT NULL,
     role          TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     totp_secret   BLOB,
     active        INTEGER NOT NULL DEFAULT 1,
     created_at    TEXT NOT NULL
   )`,
  'ALTER TABLE cases ADD COLUMN case_number INTEGER',
  'ALTER TABLE cases ADD COLUMN assigned_to TEXT',
  'ALTER TABLE cases ADD COLUMN checks TEXT',
  'UPDATE cases SET case_number = rowid WHERE case_number IS NULL',
  'CREATE UNIQUE INDEX cases_case_number ON cases (case_number)',
  'CREATE INDEX cases_card_id ON cases (card_id)',
  'CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)',
  "INSERT INTO counters (name, value) SELECT 'case', COALESCE(MAX(case_number), 0) FROM cases",
  'ALTER TABLE audit_events ADD COLUMN staff_id TEXT',
  'ALTER TABLE audit_events ADD COLUMN detail TEXT',
  'CREATE INDEX audit_events_case ON audit_events (case_id)',
  "ALTER TABLE cases ADD COLUMN source TEXT NOT NULL DEFAULT 'staff'",
  'ALTER TABLE cases ADD COLUMN package TEXT',
  'ALTER TABLE cases ADD COLUMN access_hash TEXT',
  'ALTER TABLE cases ADD COLUMN sent_at TEXT',
  'CREATE UNIQUE INDEX cases_access_hash ON cases (access_hash)',
  `CREATE TABLE partners (
     id          TEXT PRIMARY KEY,
     details     BLOB NOT NULL,
     status      TEXT NOT NULL,
     ref_code    TEXT NOT NULL UNIQUE,
     access_hash TEXT UNIQUE,
     created_at  TEXT NOT NULL,
     approved_at TEXT
   )`,
  `CREATE TABLE introductions (
     id         TEXT PRIMARY KEY,
     partner_id TEXT NOT NULL REFERENCES partners(id),
     token      TEXT NOT NULL UNIQUE,
     details    BLOB NOT NULL,
     case_id    TEXT,
     created_at TEXT NOT NULL
   )`,
  'CREATE INDEX introductions_partner ON introductions (partner_id)',
  'ALTER TABLE cases ADD COLUMN partner_id TEXT',
  'ALTER TABLE cases ADD COLUMN introduction_id TEXT',
  'ALTER TABLE cases ADD COLUMN filled_together INTEGER NOT NULL DEFAULT 0',
  'CREATE INDEX cases_partner ON cases (partner_id)',
  `CREATE TABLE messages (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     template        TEXT NOT NULL,
     case_id         TEXT,
     partner_id      TEXT,
     content         BLOB,
     sms_only        INTEGER NOT NULL DEFAULT 0,
     status          TEXT NOT NULL,
     channel         TEXT,
     attempts        INTEGER NOT NULL DEFAULT 0,
     last_error      TEXT,
     next_attempt_at TEXT NOT NULL,
     created_at      TEXT NOT NULL,
     done_at         TEXT,
     done_by         TEXT
   )`,
  'CREATE INDEX messages_due ON messages (status, next_attempt_at)',
  'ALTER TABLE cases ADD COLUMN submitted_at TEXT',
  "UPDATE cases SET submitted_at = updated_at WHERE status = 'submitted'",
  'ALTER TABLE cases ADD COLUMN erased_at TEXT',
  `CREATE TABLE payouts (
     id          TEXT PRIMARY KEY,
     partner_id  TEXT NOT NULL REFERENCES partners(id),
     rate_etb    INTEGER NOT NULL,
     amount_etb  INTEGER NOT NULL,
     entries     INTEGER NOT NULL,
     pay_to      BLOB NOT NULL,
     status      TEXT NOT NULL,
     reference   TEXT,
     created_at  TEXT NOT NULL,
     created_by  TEXT,
     settled_at  TEXT,
     settled_by  TEXT
   )`,
  'CREATE INDEX payouts_partner ON payouts (partner_id)',
  // Each submitted referral is paid at most once: the primary key is the case.
  `CREATE TABLE payout_items (
     case_id    TEXT PRIMARY KEY,
     payout_id  TEXT NOT NULL REFERENCES payouts(id),
     amount_etb INTEGER NOT NULL
   )`,
  // What an applicant paid us, recorded by staff until Telebirr / CBE Birr payments are connected.
  `CREATE TABLE payments (
     case_id     TEXT PRIMARY KEY REFERENCES cases(id),
     amount_etb  INTEGER NOT NULL,
     method      TEXT NOT NULL,
     reference   TEXT,
     received_at TEXT NOT NULL,
     recorded_by TEXT NOT NULL
   )`,
  // Passport scans (and any later documents), encrypted like photos.
  `CREATE TABLE documents (
     case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
     kind    TEXT NOT NULL,
     data    BLOB NOT NULL,
     PRIMARY KEY (case_id, kind)
   )`,
  // Business settings edited by admins, e.g. the cost figures the revenue share is computed from.
  `CREATE TABLE settings (
     key        TEXT PRIMARY KEY,
     value      TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     updated_by TEXT
   )`,
  // "tech_center": fixed commission per submitted entry. "revenue_share": a share of net profit (terms in deal).
  "ALTER TABLE partners ADD COLUMN kind TEXT NOT NULL DEFAULT 'tech_center'",
  'ALTER TABLE partners ADD COLUMN deal TEXT',
  'ALTER TABLE payments ADD COLUMN refunded_at TEXT',
  'ALTER TABLE payments ADD COLUMN refunded_by TEXT',
  'ALTER TABLE payments ADD COLUMN refund_reason TEXT',
  // Keyed fingerprints of the principal applicant, to find duplicate entries (one entry per person).
  'ALTER TABLE cases ADD COLUMN passport_fp TEXT',
  'ALTER TABLE cases ADD COLUMN person_fp TEXT',
  'CREATE INDEX cases_passport_fp ON cases (passport_fp)',
  'CREATE INDEX cases_person_fp ON cases (person_fp)',
  // At most one payout waiting to be paid per partner, enforced by the database (two clicks cannot both pay).
  "CREATE UNIQUE INDEX payouts_one_pending ON payouts (partner_id) WHERE status = 'pending'",
  // Reminder messages already sent, so each goes out once.
  `CREATE TABLE reminders (
     case_id TEXT NOT NULL,
     kind    TEXT NOT NULL,
     sent_at TEXT NOT NULL,
     PRIMARY KEY (case_id, kind)
   )`,
];

const norm = (v) => String(v ?? '').trim().toLowerCase().normalize('NFC').replace(/\s+/g, ' ');
// The principal applicant's fingerprints: passport number, and full name with birth date.
export function applicantFingerprints(crypt, a) {
  const passport = String(a.passportNumber ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return {
    passportFp: passport ? crypt.fingerprint(`passport|${passport}`) : null,
    personFp: a.lastName && a.birthDate ? crypt.fingerprint(`person|${norm(a.lastName)}|${norm(a.firstName)}|${a.birthDate}`) : null,
  };
}

export function settingsRepository(db) {
  const run = (sql, ...args) => db.execute({ sql, args });
  return {
    async get(key) {
      const row = (await run('SELECT * FROM settings WHERE key = ?', key)).rows[0];
      return row ? { value: JSON.parse(row.value), updatedAt: row.updated_at, updatedBy: row.updated_by } : null;
    },
    async set(key, value, updatedBy) {
      await run(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      key, JSON.stringify(value), new Date().toISOString(), updatedBy);
    },
  };
}

// What an erased case's applicant reads as: no personal data, but the shape the rest of the code expects.
const ERASED_APPLICANT = Object.freeze({
  erased: true, lastName: '(erased)', firstName: '', middleName: '', gender: '', birthDate: '', birthCity: '',
  birthCountry: '', eligibilityCountry: '', mailingAddress: '', residenceCountry: '', phone: '', email: '',
  education: '', maritalStatus: '', spouse: null, children: [],
});

export async function openDb({ url, authToken }) {
  if (url.startsWith('file:') && url !== 'file::memory:') {
    mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
  }
  const db = createClient({ url, authToken });
  await db.execute('PRAGMA foreign_keys = ON');
  await migrate(db);
  return db;
}

async function migrate(db) {
  await db.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const { rows } = await db.execute('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations');
  for (let v = Number(rows[0].v) + 1; v <= MIGRATIONS.length; v++) {
    await db.batch([
      MIGRATIONS[v - 1],
      { sql: 'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', args: [v, new Date().toISOString()] },
    ], 'write');
  }
}

export function caseRepository(db, crypt) {
  const now = () => new Date().toISOString();
  const run = (sql, ...args) => db.execute({ sql, args });

  const toCase = (row) =>
    row && {
      id: row.id,
      applicant: row.erased_at ? ERASED_APPLICANT : crypt.decryptJson(row.applicant),
      status: row.status,
      caseNumber: Number(row.case_number),
      submittedAt: row.submitted_at,
      erasedAt: row.erased_at,
      assignedTo: row.assigned_to,
      checks: row.checks ? JSON.parse(row.checks) : {},
      source: row.source,
      package: row.package,
      sentAt: row.sent_at,
      partnerId: row.partner_id,
      introductionId: row.introduction_id,
      filledTogether: Boolean(row.filled_together),
      cardId: row.card_id,
      cardReference: row.card_reference,
      confirmationNumber: row.confirmation_number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

  const toPayment = (row) =>
    row && {
      amountEtb: Number(row.amount_etb), method: row.method, reference: row.reference, receivedAt: row.received_at, recordedBy: row.recorded_by,
      refundedAt: row.refunded_at ?? null, refundedBy: row.refunded_by ?? null, refundReason: row.refund_reason ?? null,
    };

  return {
    // source: 'staff' or 'website'. Website cases carry the hash of the applicant's resume code.
    async insert({ id, applicant, status, source = 'staff', pkg = null, accessHash = null }) {
      const ts = now();
      const { passportFp, personFp } = applicantFingerprints(crypt, applicant);
      const { rows } = await run("UPDATE counters SET value = value + 1 WHERE name = 'case' RETURNING value");
      await run(`INSERT INTO cases (id, case_number, applicant, status, checks, source, package, access_hash, passport_fp, person_fp, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, rows[0].value, crypt.encryptJson(applicant), status, '{}', source, pkg, accessHash, passportFp, personFp, ts, ts);
    },

    // Other live cases for the same person: same passport number, or same name and birth date.
    async duplicatesOf({ id = null, applicant }) {
      const { passportFp, personFp } = applicantFingerprints(crypt, applicant);
      if (!passportFp && !personFp) return [];
      const { rows } = await run(`SELECT id, case_number, status, passport_fp, person_fp FROM cases
        WHERE erased_at IS NULL AND id IS NOT ? AND ((passport_fp IS NOT NULL AND passport_fp = ?) OR (person_fp IS NOT NULL AND person_fp = ?))`,
      id, passportFp, personFp);
      return rows.map((r) => ({
        id: r.id, caseNumber: Number(r.case_number), status: r.status,
        match: passportFp && r.passport_fp === passportFp ? 'passport' : 'name and birth date',
      }));
    },

    // Cases saved before fingerprints existed get them on start-up.
    async backfillFingerprints() {
      const { rows } = await run('SELECT id, applicant FROM cases WHERE erased_at IS NULL AND passport_fp IS NULL AND person_fp IS NULL');
      for (const r of rows) {
        const { passportFp, personFp } = applicantFingerprints(crypt, crypt.decryptJson(r.applicant));
        await run('UPDATE cases SET passport_fp = ?, person_fp = ? WHERE id = ?', passportFp, personFp, r.id);
      }
      return rows.length;
    },

    async remindedAlready(caseId, kind) {
      return (await run('SELECT 1 FROM reminders WHERE case_id = ? AND kind = ?', caseId, kind)).rows.length > 0;
    },
    async markReminded(caseId, kind) {
      await run('INSERT INTO reminders (case_id, kind, sent_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', caseId, kind, now());
    },

    async findByAccessHash(accessHash) {
      return toCase((await run('SELECT * FROM cases WHERE access_hash = ?', accessHash)).rows[0]);
    },

    async setPackage(id, pkg) {
      await run('UPDATE cases SET package = ?, updated_at = ? WHERE id = ?', pkg, now(), id);
    },

    // Erases everything personal about a case: applicant details, photos, confirmation number, resume code
    // and queued messages. The row stays (case number, status, dates) so counts and the audit trail add up.
    async erase(id) {
      const ts = now();
      await db.batch([
        { sql: `UPDATE cases SET applicant = ?, confirmation_number = NULL, access_hash = NULL, passport_fp = NULL, person_fp = NULL,
                erased_at = ?, updated_at = ? WHERE id = ?`,
          args: [crypt.encryptJson({ erased: true }), ts, ts, id] },
        { sql: 'DELETE FROM photos WHERE case_id = ?', args: [id] },
        { sql: 'DELETE FROM documents WHERE case_id = ?', args: [id] },
        { sql: 'DELETE FROM messages WHERE case_id = ?', args: [id] },
      ], 'write');
    },

    async recordPayment(caseId, { amountEtb, method, reference, recordedBy }) {
      await run('INSERT INTO payments (case_id, amount_etb, method, reference, received_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?)',
        caseId, amountEtb, method, reference, now(), recordedBy);
    },
    // Returns false if the payment was already refunded (e.g. two admins at once).
    async refundPayment(caseId, { reason, refundedBy }) {
      const r = await run('UPDATE payments SET refunded_at = ?, refunded_by = ?, refund_reason = ? WHERE case_id = ? AND refunded_at IS NULL',
        now(), refundedBy, reason, caseId);
      return r.rowsAffected === 1;
    },

    // Every payment, for the revenue-share accounts.
    async allPayments() {
      return new Map((await run('SELECT * FROM payments')).rows.map((r) => [r.case_id, toPayment(r)]));
    },

    // Every case without decrypting applicants: just what the accounts need.
    async listForAccounting() {
      const { rows } = await run('SELECT id, case_number, partner_id, source, package, status, sent_at, submitted_at, erased_at, created_at, updated_at FROM cases');
      return rows.map((r) => ({
        id: r.id, caseNumber: Number(r.case_number), partnerId: r.partner_id, source: r.source, package: r.package, status: r.status,
        sentAt: r.sent_at, submittedAt: r.submitted_at, erasedAt: r.erased_at, createdAt: r.created_at, updatedAt: r.updated_at,
      }));
    },

    async removePayment(caseId) {
      await run('DELETE FROM payments WHERE case_id = ?', caseId);
    },
    async payment(caseId) {
      return toPayment((await run('SELECT * FROM payments WHERE case_id = ?', caseId)).rows[0]);
    },
    // Case id → payment, for many cases at once.
    async paymentsFor(caseIds) {
      if (!caseIds.length) return new Map();
      const { rows } = await run(`SELECT * FROM payments WHERE case_id IN (${caseIds.map(() => '?').join(', ')})`, ...caseIds);
      return new Map(rows.map((r) => [r.case_id, toPayment(r)]));
    },

    async setReferral(id, { partnerId, introductionId = null, together = false }) {
      await run('UPDATE cases SET partner_id = ?, introduction_id = ?, filled_together = ? WHERE id = ?',
        partnerId, introductionId, together ? 1 : 0, id);
    },

    async listByPartner(partnerId) {
      return (await run('SELECT * FROM cases WHERE partner_id = ? ORDER BY created_at DESC', partnerId)).rows.map(toCase);
    },

    async markSent(id) {
      await run('UPDATE cases SET sent_at = ?, updated_at = ? WHERE id = ?', now(), now(), id);
    },

    // State changes only apply if the case is still in the state it was read in (`from`), and not erased:
    // two people acting at once cannot both win. Returns whether the change applied.
    async setStatus(id, { status, checks, from }) {
      const r = await run('UPDATE cases SET status = ?, checks = ?, updated_at = ? WHERE id = ? AND status = ? AND erased_at IS NULL',
        status, JSON.stringify(checks), now(), id, from);
      return r.rowsAffected === 1;
    },

    async assign(id, staffId) {
      await run('UPDATE cases SET assigned_to = ?, updated_at = ? WHERE id = ?', staffId, now(), id);
    },

    async findByCardId(cardId) {
      return toCase((await run('SELECT * FROM cases WHERE card_id = ?', cardId)).rows[0]);
    },

    async updateApplicant(id, applicant) {
      const { passportFp, personFp } = applicantFingerprints(crypt, applicant);
      await run('UPDATE cases SET applicant = ?, passport_fp = ?, person_fp = ?, updated_at = ? WHERE id = ?',
        crypt.encryptJson(applicant), passportFp, personFp, now(), id);
    },

    async markCardIssued(id, { cardId, cardReference, status }) {
      const r = await run(`UPDATE cases SET card_id = ?, card_reference = ?, status = ?, updated_at = ?
                           WHERE id = ? AND status = 'approved' AND erased_at IS NULL`,
      cardId, cardReference, status, now(), id);
      return r.rowsAffected === 1;
    },

    async markSubmitted(id, { confirmationNumber, status }) {
      const r = await run(`UPDATE cases SET confirmation_number = ?, status = ?, updated_at = ?, submitted_at = ?
                           WHERE id = ? AND status = 'card_issued' AND erased_at IS NULL`,
      confirmationNumber, status, now(), now(), id);
      return r.rowsAffected === 1;
    },

    async get(id) {
      return toCase((await run('SELECT * FROM cases WHERE id = ?', id)).rows[0]);
    },

    async list() {
      return (await run('SELECT * FROM cases ORDER BY created_at DESC')).rows.map(toCase);
    },

    async savePhoto(caseId, personKey, data) {
      await run(`INSERT INTO photos (case_id, person_key, data) VALUES (?, ?, ?)
                 ON CONFLICT (case_id, person_key) DO UPDATE SET data = excluded.data`,
      caseId, personKey, crypt.encrypt(data));
    },

    async getPhoto(caseId, personKey) {
      const row = (await run('SELECT data FROM photos WHERE case_id = ? AND person_key = ?', caseId, personKey)).rows[0];
      return row ? crypt.decrypt(row.data) : null;
    },

    async saveDocument(caseId, kind, data) {
      await run(`INSERT INTO documents (case_id, kind, data) VALUES (?, ?, ?)
                 ON CONFLICT (case_id, kind) DO UPDATE SET data = excluded.data`,
      caseId, kind, crypt.encrypt(data));
    },

    async getDocument(caseId, kind) {
      const row = (await run('SELECT data FROM documents WHERE case_id = ? AND kind = ?', caseId, kind)).rows[0];
      return row ? crypt.decrypt(row.data) : null;
    },

    async documentKinds(caseId) {
      return (await run('SELECT kind FROM documents WHERE case_id = ?', caseId)).rows.map((r) => r.kind);
    },

    async photoKeys(caseId) {
      return (await run('SELECT person_key FROM photos WHERE case_id = ?', caseId)).rows.map((r) => r.person_key);
    },
  };
}

// Partner contact details and introductions are personal data, so they are encrypted like applicants'.
export function partnerRepository(db, crypt) {
  const run = (sql, ...args) => db.execute({ sql, args });
  const toPartner = (row) =>
    row && {
      id: row.id,
      ...crypt.decryptJson(row.details),
      status: row.status,
      kind: row.kind ?? 'tech_center',
      deal: row.deal ? JSON.parse(row.deal) : null,
      refCode: row.ref_code,
      hasAccessCode: Boolean(row.access_hash),
      createdAt: row.created_at,
      approvedAt: row.approved_at,
    };
  const toPayout = (row) =>
    row && {
      id: row.id,
      partnerId: row.partner_id,
      rateEtb: Number(row.rate_etb),
      amountEtb: Number(row.amount_etb),
      entries: Number(row.entries),
      payTo: crypt.decryptJson(row.pay_to).payTo,
      status: row.status,
      reference: row.reference,
      createdAt: row.created_at,
      createdBy: row.created_by,
      settledAt: row.settled_at,
      settledBy: row.settled_by,
    };
  const toIntroduction = (row) =>
    row && {
      id: row.id,
      partnerId: row.partner_id,
      token: row.token,
      ...crypt.decryptJson(row.details),
      caseId: row.case_id,
      createdAt: row.created_at,
    };

  return {
    async insert({ id, details, status, refCode }) {
      await run('INSERT INTO partners (id, details, status, ref_code, created_at) VALUES (?, ?, ?, ?, ?)',
        id, crypt.encryptJson(details), status, refCode, new Date().toISOString());
    },
    async get(id) {
      return toPartner((await run('SELECT * FROM partners WHERE id = ?', id)).rows[0]);
    },
    async byRefCode(refCode) {
      return toPartner((await run('SELECT * FROM partners WHERE ref_code = ?', refCode)).rows[0]);
    },
    async byAccessHash(accessHash) {
      return toPartner((await run('SELECT * FROM partners WHERE access_hash = ?', accessHash)).rows[0]);
    },
    async list() {
      return (await run('SELECT * FROM partners ORDER BY created_at DESC')).rows.map(toPartner);
    },
    async setStatus(id, status) {
      await run('UPDATE partners SET status = ?, approved_at = COALESCE(approved_at, ?) WHERE id = ?',
        status, status === 'active' ? new Date().toISOString() : null, id);
    },
    async setDeal(id, { kind, deal }) {
      await run('UPDATE partners SET kind = ?, deal = ? WHERE id = ?', kind, deal ? JSON.stringify(deal) : null, id);
    },
    async setAccessHash(id, accessHash) {
      await run('UPDATE partners SET access_hash = ? WHERE id = ?', accessHash, id);
    },

    async insertIntroduction({ id, partnerId, token, details }) {
      await run('INSERT INTO introductions (id, partner_id, token, details, created_at) VALUES (?, ?, ?, ?, ?)',
        id, partnerId, token, crypt.encryptJson(details), new Date().toISOString());
    },
    async introductionByToken(token) {
      return toIntroduction((await run('SELECT * FROM introductions WHERE token = ?', token)).rows[0]);
    },
    async introductionsFor(partnerId) {
      return (await run('SELECT * FROM introductions WHERE partner_id = ? ORDER BY created_at DESC', partnerId)).rows.map(toIntroduction);
    },
    async listIntroductions() {
      return (await run('SELECT * FROM introductions ORDER BY created_at DESC')).rows.map(toIntroduction);
    },
    // ---- payouts ----
    // Tech centres: rate × the cases listed. Revenue share: an explicit amount, the entries it covers counted.
    async insertPayout({ id, partnerId, rateEtb, caseIds, payTo, createdBy, amountEtb = rateEtb * caseIds.length, entries = caseIds.length }) {
      const ts = new Date().toISOString();
      await db.batch([
        { sql: `INSERT INTO payouts (id, partner_id, rate_etb, amount_etb, entries, pay_to, status, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          args: [id, partnerId, rateEtb, amountEtb, entries, crypt.encryptJson({ payTo }), ts, createdBy] },
        ...caseIds.map((caseId) => ({ sql: 'INSERT INTO payout_items (case_id, payout_id, amount_etb) VALUES (?, ?, ?)', args: [caseId, id, rateEtb] })),
      ], 'write');
    },
    async payout(id) {
      return toPayout((await run('SELECT * FROM payouts WHERE id = ?', id)).rows[0]);
    },
    async payouts(partnerId = null) {
      const rows = partnerId
        ? (await run('SELECT * FROM payouts WHERE partner_id = ? ORDER BY created_at DESC', partnerId)).rows
        : (await run('SELECT * FROM payouts ORDER BY created_at DESC')).rows;
      return rows.map(toPayout);
    },
    // Case id → { payoutId, amountEtb, status } for every case already in a (non-cancelled) payout.
    async payoutItems(partnerId) {
      const { rows } = await run(`SELECT i.case_id, i.payout_id, i.amount_etb, p.status FROM payout_items i
        JOIN payouts p ON p.id = i.payout_id WHERE p.partner_id = ?`, partnerId);
      return new Map(rows.map((r) => [r.case_id, { payoutId: r.payout_id, amountEtb: Number(r.amount_etb), status: r.status }]));
    },
    // Settles a waiting payout as paid or cancelled. Returns false if it was already settled. A cancelled
    // payout releases its entries, in the same transaction and only if this call cancelled it.
    async settlePayout(id, { status, reference = null, settledBy }) {
      const ts = new Date().toISOString();
      const [update] = await db.batch([
        {
          sql: "UPDATE payouts SET status = ?, reference = ?, settled_at = ?, settled_by = ? WHERE id = ? AND status = 'pending'",
          args: [status, reference, ts, settledBy, id],
        },
        // Runs in the same batch (one transaction) and only deletes if this very call cancelled the payout.
        {
          sql: `DELETE FROM payout_items WHERE payout_id = ?
                AND (SELECT status FROM payouts WHERE id = ?) = 'cancelled' AND (SELECT settled_at FROM payouts WHERE id = ?) = ?`,
          args: [id, id, id, status === 'cancelled' ? ts : '-'],
        },
      ], 'write');
      return update.rowsAffected === 1;
    },



    async deleteIntroduction(id) {
      await run('DELETE FROM introductions WHERE id = ?', id);
    },
    async linkIntroduction(id, caseId) {
      await run('UPDATE introductions SET case_id = ? WHERE id = ? AND case_id IS NULL', caseId, id);
    },
  };
}

// Outbox of messages to applicants and partners. Recipient and text are encrypted, and erased once the
// message is delivered: they can carry resume codes and confirmation numbers.
export function messageRepository(db, crypt) {
  const run = (sql, ...args) => db.execute({ sql, args });
  const toMessage = (row) =>
    row && {
      id: Number(row.id),
      template: row.template,
      caseId: row.case_id,
      partnerId: row.partner_id,
      ...(row.content ? crypt.decryptJson(row.content) : { to: null, subject: null, text: null }),
      smsOnly: Boolean(row.sms_only),
      status: row.status,
      channel: row.channel,
      attempts: Number(row.attempts),
      lastError: row.last_error,
      nextAttemptAt: row.next_attempt_at,
      createdAt: row.created_at,
      doneAt: row.done_at,
      doneBy: row.done_by,
    };

  return {
    async insert({ template, caseId = null, partnerId = null, to, subject, text, smsOnly = false, at = new Date() }) {
      const ts = at.toISOString();
      await run(`INSERT INTO messages (template, case_id, partner_id, content, sms_only, status, next_attempt_at, created_at)
                 VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      template, caseId, partnerId, crypt.encryptJson({ to, subject, text }), smsOnly ? 1 : 0, ts, ts);
    },
    async due(now, limit = 20) {
      return (await run("SELECT * FROM messages WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT ?",
        now, limit)).rows.map(toMessage);
    },
    async get(id) {
      return toMessage((await run('SELECT * FROM messages WHERE id = ?', id)).rows[0]);
    },
    async list({ statuses, limit = 200 }) {
      const marks = statuses.map(() => '?').join(', ');
      return (await run(`SELECT * FROM messages WHERE status IN (${marks}) ORDER BY id DESC LIMIT ?`, ...statuses, limit)).rows.map(toMessage);
    },
    async counts() {
      const { rows } = await run('SELECT status, COUNT(*) AS n FROM messages GROUP BY status');
      return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    },
    // Delivered or handled by hand: keep the record, erase who and what.
    async finish(id, { status, channel = null, doneBy = null }) {
      await run('UPDATE messages SET status = ?, channel = COALESCE(?, channel), content = NULL, done_at = ?, done_by = ? WHERE id = ?',
        status, channel, new Date().toISOString(), doneBy, id);
    },
    async retryLater(id, { attempts, error, nextAttemptAt, status = 'pending', channel = null }) {
      await run('UPDATE messages SET attempts = ?, last_error = ?, next_attempt_at = ?, status = ?, channel = COALESCE(?, channel) WHERE id = ?',
        attempts, error, nextAttemptAt, status, channel, id);
    },
  };
}

export function staffRepository(db, crypt) {
  const run = (sql, ...args) => db.execute({ sql, args });
  const toStaff = (row) =>
    row && {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      passwordHash: row.password_hash,
      totpSecret: row.totp_secret ? crypt.decrypt(row.totp_secret).toString('utf8') : null,
      active: Boolean(row.active),
      createdAt: row.created_at,
    };

  return {
    async count() {
      return Number((await run('SELECT COUNT(*) AS n FROM staff')).rows[0].n);
    },
    async insert({ id, email, name, role, passwordHash }) {
      await run('INSERT INTO staff (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        id, email, name, role, passwordHash, new Date().toISOString());
    },
    async byId(id) {
      return toStaff((await run('SELECT * FROM staff WHERE id = ?', id)).rows[0]);
    },
    async byEmail(email) {
      return toStaff((await run('SELECT * FROM staff WHERE email = ?', email)).rows[0]);
    },
    async list() {
      return (await run('SELECT * FROM staff ORDER BY active DESC, name')).rows.map(toStaff);
    },
    async update(id, { role, active, passwordHash }) {
      const current = await this.byId(id);
      await run('UPDATE staff SET role = ?, active = ?, password_hash = ? WHERE id = ?',
        role ?? current.role, (active ?? current.active) ? 1 : 0, passwordHash ?? current.passwordHash, id);
    },
    async setTotp(id, secret) {
      await run('UPDATE staff SET totp_secret = ? WHERE id = ?', secret ? crypt.encrypt(Buffer.from(secret)) : null, id);
    },
  };
}

export function auditLog(db) {
  const run = (sql, ...args) => db.execute({ sql, args });
  return {
    async record({ action, caseId = null, ip = null, staffId = null, detail = null }) {
      await run('INSERT INTO audit_events (at, action, case_id, ip, staff_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
        new Date().toISOString(), action, caseId, ip, staffId, detail);
    },

    // Newest first. `actionPrefix` filters by kind, e.g. "card" or "login".
    async list({ caseId, actionPrefix, limit = 200 } = {}) {
      const where = [];
      const args = [];
      if (caseId) { where.push('e.case_id = ?'); args.push(caseId); }
      if (actionPrefix) { where.push('e.action LIKE ?'); args.push(`${actionPrefix}%`); }
      const sql = `SELECT e.*, s.name AS staff_name, c.case_number FROM audit_events e
        LEFT JOIN staff s ON s.id = e.staff_id LEFT JOIN cases c ON c.id = e.case_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.id DESC LIMIT ?`;
      args.push(limit);
      return (await run(sql, ...args)).rows.map((r) => ({
        at: r.at, action: r.action, caseId: r.case_id, caseNumber: r.case_number == null ? null : Number(r.case_number),
        ip: r.ip, staffName: r.staff_name, detail: r.detail,
      }));
    },
  };
}
