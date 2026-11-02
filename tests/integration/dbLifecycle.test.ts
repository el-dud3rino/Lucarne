import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';

test('Database Lifecycle: empty boot seeding, existing boot idempotency, and snapshot backup', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-dblifecycle-'));

  try {
    // 1. Boot against empty directory: run schema initialization & seed
    const bootScript = `
      import { initSchema } from './src/server/db/schema.js';
      import { seedIfNeeded } from './src/server/db/seed.js';
      import { db, performBackup } from './src/server/db/connection.js';

      initSchema();
      seedIfNeeded();

      const memberCount = db.prepare('SELECT COUNT(*) as c FROM family_members').get().c;
      const choreCount = db.prepare('SELECT COUNT(*) as c FROM chores').get().c;
      const listCount = db.prepare('SELECT COUNT(*) as c FROM lists').get().c;
      const recipeCount = db.prepare('SELECT COUNT(*) as c FROM recipes').get().c;

      console.log(JSON.stringify({ memberCount, choreCount, listCount, recipeCount }));
    `;

    const out1 = execFileSync(
      process.execPath,
      ['--import', 'tsx', '-e', bootScript],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATA_DIR: tempDir },
        encoding: 'utf-8',
      }
    );

    const stats1 = JSON.parse(out1.trim().split('\n').pop() || '{}');
    assert.equal(stats1.memberCount, 5, 'Must seed exactly 5 family members (Dad, Mom, Leo, Maya, Family)');
    assert.ok(stats1.choreCount >= 10, 'Must seed initial family chores');
    assert.ok(stats1.listCount >= 3, 'Must seed initial lists');
    assert.ok(stats1.recipeCount >= 3, 'Must seed initial recipes');

    // 2. Boot against existing populated database: verify no duplicate rows inserted
    const out2 = execFileSync(
      process.execPath,
      ['--import', 'tsx', '-e', bootScript],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATA_DIR: tempDir },
        encoding: 'utf-8',
      }
    );

    const stats2 = JSON.parse(out2.trim().split('\n').pop() || '{}');
    assert.equal(stats2.memberCount, stats1.memberCount, 'Member count must not change on reboot');
    assert.equal(stats2.choreCount, stats1.choreCount, 'Chore count must not change on reboot');
    assert.equal(stats2.listCount, stats1.listCount, 'List count must not change on reboot');
    assert.equal(stats2.recipeCount, stats1.recipeCount, 'Recipe count must not change on reboot');

    // 3. Trigger point-in-time backup snapshot and verify SQLite file integrity
    const backupScript = `
      import { initSchema } from './src/server/db/schema.js';
      import { performBackup, db } from './src/server/db/connection.js';

      initSchema();
      const backupPath = performBackup();
      const lastBackup = db.prepare("SELECT value FROM app_settings WHERE key = 'lastBackupAt'").get();
      console.log(JSON.stringify({ backupPath, lastBackupAt: lastBackup?.value }));
    `;

    const out3 = execFileSync(
      process.execPath,
      ['--import', 'tsx', '-e', backupScript],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATA_DIR: tempDir },
        encoding: 'utf-8',
      }
    );

    const backupResult = JSON.parse(out3.trim().split('\n').pop() || '{}');
    assert.ok(backupResult.backupPath, 'Backup path must be returned');
    assert.ok(fs.existsSync(backupResult.backupPath), 'Backup file must exist on disk');
    assert.ok(backupResult.lastBackupAt, 'lastBackupAt setting must be recorded');

    // Open backup database directly and execute PRAGMA integrity_check
    const backupDb = new DatabaseSync(backupResult.backupPath);
    const integrityRow = backupDb.prepare('PRAGMA integrity_check;').get() as { integrity_check?: string };
    assert.equal(
      integrityRow.integrity_check,
      'ok',
      'Backup SQLite database must pass PRAGMA integrity_check'
    );

    // Verify backup contains the seeded tables and records
    const backupMembers = backupDb.prepare('SELECT COUNT(*) as c FROM family_members').get() as { c: number };
    assert.equal(backupMembers.c, 5, 'Backup snapshot must contain 5 family members');
    backupDb.close();

  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
