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
      cardId: row.card_id,
      cardReference: row.card_reference,
      confirmationNumber: row.confirmation_number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

  return {
    async insert({ id, applicant, status }) {
      const ts = now();
      await run('INSERT INTO cases (id, applicant, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        id, crypt.encryptJson(applicant), status, ts, ts);
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

export function auditLog(db) {
  return {
    async record({ action, caseId = null, ip = null }) {
      await db.execute({
        sql: 'INSERT INTO audit_events (at, action, case_id, ip) VALUES (?, ?, ?, ?)',
        args: [new Date().toISOString(), action, caseId, ip],
      });
    },
  };
}
