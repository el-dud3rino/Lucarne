import type { DatabaseSync } from 'node:sqlite';
import { db, runTransaction } from './connection.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

export function getCurrentUserVersion(): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

export function columnExists(tableName: string, columnName: string): boolean {
  try {
    const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return cols.some((c) => c.name === columnName);
  } catch {
    return false;
  }
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: '001_initial_schema_and_recurrence',
    up: (d: DatabaseSync) => {
      // 1. Create all 13 core tables if they do not already exist
      d.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS family_members (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          initial TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '🙂',
          role TEXT NOT NULL DEFAULT 'parent',
          color_bg TEXT NOT NULL,
          color_text TEXT NOT NULL,
          color_accent TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS google_accounts (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          avatar_url TEXT,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          expiry_date INTEGER NOT NULL DEFAULT 0,
          last_synced_at TEXT,
          sync_status TEXT NOT NULL DEFAULT 'idle',
          sync_error TEXT
        );

        CREATE TABLE IF NOT EXISTS calendar_sources (
          id TEXT PRIMARY KEY,
          google_account_id TEXT NOT NULL REFERENCES google_accounts(id) ON DELETE CASCADE,
          external_calendar_id TEXT NOT NULL,
          name TEXT NOT NULL,
          member_id TEXT REFERENCES family_members(id) ON DELETE SET NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          is_writable INTEGER NOT NULL DEFAULT 1,
          sync_token TEXT,
          last_synced_at TEXT,
          UNIQUE(google_account_id, external_calendar_id)
        );

        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL DEFAULT '',
          start_iso TEXT NOT NULL,
          end_iso TEXT NOT NULL,
          all_day INTEGER NOT NULL DEFAULT 0,
          member_ids_json TEXT NOT NULL DEFAULT '[]',
          calendar_source_id TEXT REFERENCES calendar_sources(id) ON DELETE CASCADE,
          external_event_id TEXT,
          recurrence_rule TEXT DEFAULT NULL,
          exception_dates_json TEXT NOT NULL DEFAULT '[]',
          deleted INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_range ON events(start_iso, end_iso);
        CREATE INDEX IF NOT EXISTS idx_events_external ON events(calendar_source_id, external_event_id);

        CREATE TABLE IF NOT EXISTS outbox_mutations (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          action TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          next_retry_at INTEGER DEFAULT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chores (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '✨',
          assigned_member_id TEXT REFERENCES family_members(id) ON DELETE SET NULL,
          time_of_day TEXT NOT NULL DEFAULT 'anytime',
          frequency TEXT NOT NULL DEFAULT 'daily',
          days_of_week_json TEXT NOT NULL DEFAULT '[]',
          specific_date TEXT,
          stars INTEGER NOT NULL DEFAULT 1,
          active INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS chore_completions (
          id TEXT PRIMARY KEY,
          chore_id TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
          date_str TEXT NOT NULL,
          completed_by_member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
          stars_earned INTEGER NOT NULL DEFAULT 1,
          completed_at TEXT NOT NULL,
          UNIQUE(chore_id, date_str)
        );
        CREATE INDEX IF NOT EXISTS idx_chore_completions_date ON chore_completions(date_str);
        CREATE INDEX IF NOT EXISTS idx_chore_completions_member ON chore_completions(completed_by_member_id, date_str);

        CREATE TABLE IF NOT EXISTS lists (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '🛒',
          color_accent TEXT NOT NULL DEFAULT '#0284C7',
          is_grocery INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS list_items (
          id TEXT PRIMARY KEY,
          list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          quantity TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'Other',
          checked INTEGER NOT NULL DEFAULT 0,
          added_by_member_id TEXT REFERENCES family_members(id) ON DELETE SET NULL,
          recipe_source_title TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id, checked);

        CREATE TABLE IF NOT EXISTS recipes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          image_url TEXT,
          source_url TEXT,
          prep_minutes INTEGER,
          cook_minutes INTEGER,
          servings INTEGER,
          tags_json TEXT NOT NULL DEFAULT '[]',
          ingredients_json TEXT NOT NULL DEFAULT '[]',
          instructions_json TEXT NOT NULL DEFAULT '[]',
          favorite INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS meal_plans (
          id TEXT PRIMARY KEY,
          date_str TEXT NOT NULL,
          slot TEXT NOT NULL DEFAULT 'dinner',
          recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
          custom_title TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          UNIQUE(date_str, slot)
        );
        CREATE INDEX IF NOT EXISTS idx_meal_plans_date ON meal_plans(date_str);

        CREATE TABLE IF NOT EXISTS photos (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          orientation TEXT NOT NULL DEFAULT 'landscape',
          caption TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'starter',
          external_id TEXT,
          created_at TEXT NOT NULL
        );
      `);

      // 2. Defensive schema evolution for pre-existing databases (v0 -> v1)
      if (!columnExists('events', 'recurrence_rule')) {
        d.exec('ALTER TABLE events ADD COLUMN recurrence_rule TEXT DEFAULT NULL');
      }
      if (!columnExists('events', 'exception_dates_json')) {
        d.exec("ALTER TABLE events ADD COLUMN exception_dates_json TEXT DEFAULT '[]'");
      }
      if (!columnExists('outbox_mutations', 'next_retry_at')) {
        d.exec('ALTER TABLE outbox_mutations ADD COLUMN next_retry_at INTEGER DEFAULT NULL');
      }
      d.exec('CREATE INDEX IF NOT EXISTS idx_events_recurrence ON events(recurrence_rule)');
    },
  },
];

export function initSchema(): void {
  const currentVersion = getCurrentUserVersion();
  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) return;

  for (const migration of pending) {
    runTransaction(() => {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
}
