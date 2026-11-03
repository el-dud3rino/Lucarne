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

const KEEP_BACKUPS = 14;
const BACKUP_NAME_RE = /^lucarne-[A-Za-z0-9-]+\.db$/;

export interface BackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: string;
  /** Safety copy taken automatically just before a restore */
  preRestore: boolean;
}

export function performBackup(label = ''): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUPS_DIR, `lucarne-${label ? `${label}-` : ''}${stamp}.db`);
  const escaped = backupFile.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);

  // Prune old backups, keeping the newest KEEP_BACKUPS
  const files = listBackups();
  for (const old of files.slice(KEEP_BACKUPS)) {
    try {
      fs.unlinkSync(path.join(BACKUPS_DIR, old.name));
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

/** Backups on disk, newest first. */
export function listBackups(): BackupInfo[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(BACKUPS_DIR).filter((f) => BACKUP_NAME_RE.test(f));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const st = fs.statSync(path.join(BACKUPS_DIR, name));
      return { name, sizeBytes: st.size, createdAt: new Date(st.mtimeMs).toISOString(), preRestore: name.startsWith('lucarne-pre-restore-') };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function lastBackupMs(): number {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'lastBackupAt'").get() as { value: string } | undefined;
  if (!row) return 0;
  try {
    return Date.parse(JSON.parse(row.value)) || 0;
  } catch {
    return 0;
  }
}

/** Takes the daily backup if the last one is more than ~a day old (checked at startup and every 30 min). */
export function backupIfDue(now = Date.now()): string | null {
  if (now - lastBackupMs() < 23 * 3600_000) return null;
  return performBackup();
}

/**
 * Restores a backup into the live database without restarting: a safety backup is taken first,
 * the backup is integrity-checked, then every table is replaced in one transaction (columns that
 * exist in both are copied, so backups from older Lucarne versions restore too).
 */
export function restoreBackup(name: string): { restoredFrom: string; safetyBackup: string } {
  if (!BACKUP_NAME_RE.test(name)) throw new Error('Unknown backup');
  const file = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(file)) throw new Error('That backup file no longer exists');

  const check = new DatabaseSync(file, { readOnly: true });
  let backupVersion = 0;
  try {
    const ok = check.prepare('PRAGMA integrity_check').get() as Record<string, string>;
    if (Object.values(ok)[0] !== 'ok') throw new Error('That backup file is damaged and cannot be restored');
    backupVersion = Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  } finally {
    check.close();
  }
  const currentVersion = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (backupVersion > currentVersion) {
    throw new Error('That backup was made by a newer version of Lucarne. Update Lucarne first.');
  }

  const safety = performBackup('pre-restore');
  const escaped = file.replace(/'/g, "''");
  db.exec(`ATTACH DATABASE '${escaped}' AS bak`);
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    runTransaction(() => {
      const tables = db
        .prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>;
      const bakTables = new Set(
        (db.prepare("SELECT name FROM bak.sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name)
      );
      for (const { name: t } of tables) {
        const q = `"${t.replace(/"/g, '""')}"`;
        db.exec(`DELETE FROM main.${q}`);
        if (!bakTables.has(t)) continue;
        const mainCols = (db.prepare(`PRAGMA main.table_info(${q})`).all() as Array<{ name: string }>).map((c) => c.name);
        const bakCols = new Set((db.prepare(`PRAGMA bak.table_info(${q})`).all() as Array<{ name: string }>).map((c) => c.name));
        const cols = mainCols.filter((c) => bakCols.has(c)).map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
        if (cols) db.exec(`INSERT INTO main.${q} (${cols}) SELECT ${cols} FROM bak.${q}`);
      }
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('DETACH DATABASE bak');
  }
  // The restored settings carry the backup's own timestamp; record that a backup exists now.
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('lastBackupAt', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(new Date().toISOString()));
  return { restoredFrom: name, safetyBackup: path.basename(safety) };
}
