import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { MIGRATIONS, openDb } from '../src/infra/db.js';

// Databases already in use have applied a prefix of this list, by position. Editing, reordering or inserting
// a migration breaks them on the next deploy (it happened once: a migration inserted mid-list re-ran
// "CREATE TABLE reminders" on the live database). New migrations go at the end; then append their
// fingerprints to migrations.lock.json.
test('migrations are append-only', () => {
  const locked = JSON.parse(readFileSync(new URL('./migrations.lock.json', import.meta.url), 'utf8'));
  const current = MIGRATIONS.map((m) => createHash('sha256').update(m).digest('hex').slice(0, 16));
  assert.ok(current.length >= locked.length, 'a migration was removed');
  locked.forEach((hash, i) => assert.equal(current[i], hash, `migration ${i + 1} was changed, moved or inserted before`));
});

test('a database at any earlier version upgrades cleanly to the latest', async () => {
  // The live site was at 48 migrations when this test was added; try every version from there.
  for (const applied of [48, 50, MIGRATIONS.length - 1]) {
    const url = `file:${join(mkdtempSync(join(tmpdir(), 'dv-mig-')), 'db.sqlite')}`;
    const old = createClient({ url });
    await old.execute('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (let v = 1; v <= applied; v++) {
      await old.batch([MIGRATIONS[v - 1], { sql: 'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', args: [v, 'then'] }], 'write');
    }
    old.close();
    const db = await openDb({ url });
    const { rows } = await db.execute('SELECT MAX(version) AS v FROM schema_migrations');
    assert.equal(Number(rows[0].v), MIGRATIONS.length, `from version ${applied}`);
    db.close();
  }
});
