// SQLite persistence for cases and photos (Node's built-in node:sqlite).

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (
  id                  TEXT PRIMARY KEY,
  applicant           TEXT NOT NULL,
  status              TEXT NOT NULL,
  card_id             TEXT,
  card_reference      TEXT,
  confirmation_number TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  person_key TEXT NOT NULL,
  data       BLOB NOT NULL,
  PRIMARY KEY (case_id, person_key)
);
`;

const toCase = (row) =>
  row && {
    id: row.id,
    applicant: JSON.parse(row.applicant),
    status: row.status,
    cardId: row.card_id,
    cardReference: row.card_reference,
    confirmationNumber: row.confirmation_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function caseRepository(db) {
  const now = () => new Date().toISOString();

  return {
    insert({ id, applicant, status }) {
      const ts = now();
      db.prepare(
        'INSERT INTO cases (id, applicant, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, JSON.stringify(applicant), status, ts, ts);
    },

    updateApplicant(id, applicant) {
      db.prepare('UPDATE cases SET applicant = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(applicant), now(), id,
      );
    },

    markCardIssued(id, { cardId, cardReference, status }) {
      db.prepare(
        'UPDATE cases SET card_id = ?, card_reference = ?, status = ?, updated_at = ? WHERE id = ?',
      ).run(cardId, cardReference, status, now(), id);
    },

    markSubmitted(id, { confirmationNumber, status }) {
      db.prepare(
        'UPDATE cases SET confirmation_number = ?, status = ?, updated_at = ? WHERE id = ?',
      ).run(confirmationNumber, status, now(), id);
    },

    get(id) {
      return toCase(db.prepare('SELECT * FROM cases WHERE id = ?').get(id));
    },

    list() {
      return db.prepare('SELECT * FROM cases ORDER BY created_at DESC').all().map(toCase);
    },

    savePhoto(caseId, personKey, data) {
      db.prepare(
        `INSERT INTO photos (case_id, person_key, data) VALUES (?, ?, ?)
         ON CONFLICT (case_id, person_key) DO UPDATE SET data = excluded.data`,
      ).run(caseId, personKey, data);
    },

    getPhoto(caseId, personKey) {
      const row = db.prepare('SELECT data FROM photos WHERE case_id = ? AND person_key = ?').get(caseId, personKey);
      return row ? Buffer.from(row.data) : null;
    },

    photoKeys(caseId) {
      return db.prepare('SELECT person_key FROM photos WHERE case_id = ?').all(caseId).map((r) => r.person_key);
    },
  };
}
