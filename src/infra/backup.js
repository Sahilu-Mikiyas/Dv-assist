// Full backups as newline-delimited JSON: a header line, then one line per row: {"t": table, "r": {column: value}}.
// Binary columns (already encrypted at rest) are written as {"$b64": "..."} and stay encrypted, so a backup
// file alone reveals no personal data: it needs DATA_ENCRYPTION_KEY, which is kept separately.

import { MIGRATIONS } from './db.js';

// Every table, parents before children so a restore never breaks a foreign key.
export const BACKUP_TABLES = [
  'counters', 'staff', 'partners', 'cases', 'photos', 'documents', 'payments', 'introductions', 'payouts',
  'payout_items', 'messages', 'reminders', 'settings', 'audit_events', 'passport_claims',
];

const encode = (value) => (value instanceof ArrayBuffer || ArrayBuffer.isView(value)
  ? { $b64: Buffer.from(value instanceof ArrayBuffer ? value : value.buffer, value.byteOffset ?? 0, value.byteLength).toString('base64') }
  : value);
const decode = (value) => (value && typeof value === 'object' && '$b64' in value ? Buffer.from(value.$b64, 'base64') : value);

// Writes the backup line by line (photos can make it large), in pages so memory stays small.
export async function writeBackup(db, write, { now = new Date() } = {}) {
  await write(`${JSON.stringify({ kind: 'ethio-dv-assist-backup', version: MIGRATIONS.length, createdAt: now.toISOString() })}\n`);
  const counts = {};
  for (const table of BACKUP_TABLES) {
    counts[table] = 0;
    for (let offset = 0; ; offset += 200) {
      const { rows, columns } = await db.execute({ sql: `SELECT * FROM ${table} ORDER BY rowid LIMIT 200 OFFSET ?`, args: [offset] });
      for (const row of rows) {
        await write(`${JSON.stringify({ t: table, r: Object.fromEntries(columns.map((c) => [c, encode(row[c])])) })}\n`);
        counts[table] += 1;
      }
      if (rows.length < 200) break;
    }
  }
  return counts;
}

// Restores a backup into a freshly created (empty) database at the latest schema.
export async function restoreBackup(db, lines) {
  const [header, ...rows] = lines.filter((l) => l.trim());
  const meta = JSON.parse(header);
  if (meta.kind !== 'ethio-dv-assist-backup') throw new Error('Not an Ethio DV Assist backup file');
  if (meta.version > MIGRATIONS.length) throw new Error('This backup comes from a newer version of the app: update the app first');
  const existing = Number((await db.execute('SELECT COUNT(*) AS n FROM cases')).rows[0].n);
  if (existing) throw new Error('Restore only into an empty database');
  await db.execute('DELETE FROM counters'); // the fresh schema seeds a counter row; the backup brings its own
  const counts = {};
  const batch = [];
  for (const line of rows) {
    const { t, r } = JSON.parse(line);
    if (!BACKUP_TABLES.includes(t)) throw new Error(`Unknown table in backup: ${t}`);
    const columns = Object.keys(r);
    // A tampered file must not be able to smuggle SQL in through a column name.
    if (!columns.every((c) => /^[a-z_]+$/.test(c))) throw new Error(`Bad column name in backup for ${t}`);
    batch.push({ sql: `INSERT INTO ${t} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, args: columns.map((c) => decode(r[c])) });
    counts[t] = (counts[t] ?? 0) + 1;
    if (batch.length >= 200) await db.batch(batch.splice(0), 'write');
  }
  if (batch.length) await db.batch(batch, 'write');
  return { createdAt: meta.createdAt, counts };
}
