import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
export const MEDIA_PHOTOS_DIR = path.join(DATA_DIR, 'media', 'photos');
export const MEDIA_RECIPES_DIR = path.join(DATA_DIR, 'media', 'recipes');

for (const dir of [DATA_DIR, BACKUPS_DIR, MEDIA_PHOTOS_DIR, MEDIA_RECIPES_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'lucarne.db');

export const db = new DatabaseSync(DB_PATH);

// Appliance-grade SQLite pragmas: WAL mode + in-memory temp tables + 16MB page cache
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -16000;
`);

export function runTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error if transaction already closed
    }
    throw err;
  }
}

export function performBackup(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUPS_DIR, `lucarne-${stamp}.db`);
  const escaped = backupFile.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);

  // Prune old backups, keeping the newest 7
  const files = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith('lucarne-') && f.endsWith('.db'))
    .map((f) => ({
      name: f,
      full: path.join(BACKUPS_DIR, f),
      mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const old of files.slice(7)) {
    try {
      fs.unlinkSync(old.full);
    } catch {
      // ignore
    }
  }

  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('lastBackupAt', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(nowIso));

  return backupFile;
}
