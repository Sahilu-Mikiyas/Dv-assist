// Restores a backup file into an EMPTY database.
//   DATABASE_URL=file:./data/restored.db node scripts/restore-backup.mjs ethio-dv-assist-backup-….ndjson
// (or a new, empty Turso database with DATABASE_URL + DATABASE_AUTH_TOKEN). The app then needs the same
// DATA_ENCRYPTION_KEY as the site the backup came from, or the personal data cannot be read.

import { readFileSync } from 'node:fs';
import { restoreBackup } from '../src/infra/backup.js';
import { openDb } from '../src/infra/db.js';

const file = process.argv[2];
if (!file || !process.env.DATABASE_URL) {
  console.error('Usage: DATABASE_URL=<empty database> node scripts/restore-backup.mjs <backup.ndjson>');
  process.exit(1);
}
const db = await openDb({ url: process.env.DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN });
const result = await restoreBackup(db, readFileSync(file, 'utf8').split('\n'));
console.log(`Restored the backup made ${result.createdAt}:`, result.counts);
db.close();
