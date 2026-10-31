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
];

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
      applicant: crypt.decryptJson(row.applicant),
      status: row.status,
      caseNumber: Number(row.case_number),
      assignedTo: row.assigned_to,
      checks: row.checks ? JSON.parse(row.checks) : {},
      source: row.source,
      package: row.package,
      sentAt: row.sent_at,
      cardId: row.card_id,
      cardReference: row.card_reference,
      confirmationNumber: row.confirmation_number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

  return {
    // source: 'staff' or 'website'. Website cases carry the hash of the applicant's resume code.
    async insert({ id, applicant, status, source = 'staff', pkg = null, accessHash = null }) {
      const ts = now();
      const { rows } = await run("UPDATE counters SET value = value + 1 WHERE name = 'case' RETURNING value");
      await run(`INSERT INTO cases (id, case_number, applicant, status, checks, source, package, access_hash, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, rows[0].value, crypt.encryptJson(applicant), status, '{}', source, pkg, accessHash, ts, ts);
    },

    async findByAccessHash(accessHash) {
      return toCase((await run('SELECT * FROM cases WHERE access_hash = ?', accessHash)).rows[0]);
    },

    async setPackage(id, pkg) {
      await run('UPDATE cases SET package = ?, updated_at = ? WHERE id = ?', pkg, now(), id);
    },

    async markSent(id) {
      await run('UPDATE cases SET sent_at = ?, updated_at = ? WHERE id = ?', now(), now(), id);
    },

    async setStatus(id, { status, checks }) {
      await run('UPDATE cases SET status = ?, checks = ?, updated_at = ? WHERE id = ?',
        status, JSON.stringify(checks), now(), id);
    },

    async assign(id, staffId) {
      await run('UPDATE cases SET assigned_to = ?, updated_at = ? WHERE id = ?', staffId, now(), id);
    },

    async findByCardId(cardId) {
      return toCase((await run('SELECT * FROM cases WHERE card_id = ?', cardId)).rows[0]);
    },

    async updateApplicant(id, applicant) {
      await run('UPDATE cases SET applicant = ?, updated_at = ? WHERE id = ?', crypt.encryptJson(applicant), now(), id);
    },

    async markCardIssued(id, { cardId, cardReference, status }) {
      await run('UPDATE cases SET card_id = ?, card_reference = ?, status = ?, updated_at = ? WHERE id = ?',
        cardId, cardReference, status, now(), id);
    },

    async markSubmitted(id, { confirmationNumber, status }) {
      await run('UPDATE cases SET confirmation_number = ?, status = ?, updated_at = ? WHERE id = ?',
        confirmationNumber, status, now(), id);
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

    async photoKeys(caseId) {
      return (await run('SELECT person_key FROM photos WHERE case_id = ?', caseId)).rows.map((r) => r.person_key);
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
