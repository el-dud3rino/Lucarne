import type { DatabaseSync } from 'node:sqlite';
import { db, runTransaction } from './connection.js';
import { categoryForCalendar, categoryForEvent, type EventCategory } from '../../shared/eventCategories.js';
import { classifyGroceryItem } from '../../shared/groceryClassifier.js';

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
  {
    version: 2,
    name: '002_google_keep_list_bridge',
    up: (d: DatabaseSync) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS keep_list_links (
          list_id TEXT PRIMARY KEY REFERENCES lists(id) ON DELETE CASCADE,
          keep_note_id TEXT NOT NULL,
          keep_note_title TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS keep_item_links (
          list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
          local_item_id TEXT NOT NULL,
          keep_item_id TEXT NOT NULL,
          last_keep_text TEXT NOT NULL,
          last_local_text TEXT NOT NULL,
          last_checked INTEGER NOT NULL,
          PRIMARY KEY (list_id, keep_item_id)
        );
      `);
    },
  },
  {
    version: 3,
    name: '003_google_keep_chore_bridge',
    up: (d: DatabaseSync) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS keep_chore_links (
          member_id TEXT PRIMARY KEY REFERENCES family_members(id) ON DELETE CASCADE,
          keep_note_id TEXT NOT NULL,
          keep_note_title TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS keep_chore_item_links (
          member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
          chore_id TEXT NOT NULL,
          keep_item_id TEXT NOT NULL,
          last_keep_text TEXT NOT NULL,
          last_local_text TEXT NOT NULL,
          last_checked INTEGER NOT NULL,
          PRIMARY KEY (member_id, keep_item_id)
        );
      `);
    },
  },
  {
    version: 4,
    name: '004_calendar_multi_member_and_source_errors',
    up: (d: DatabaseSync) => {
      if (!columnExists('calendar_sources', 'member_ids_json')) {
        d.exec("ALTER TABLE calendar_sources ADD COLUMN member_ids_json TEXT NOT NULL DEFAULT '[]'");
        d.exec(
          "UPDATE calendar_sources SET member_ids_json = json_array(member_id) WHERE member_id IS NOT NULL AND member_id != ''"
        );
      }
      if (!columnExists('calendar_sources', 'sync_error')) {
        d.exec('ALTER TABLE calendar_sources ADD COLUMN sync_error TEXT DEFAULT NULL');
      }
    },
  },
  {
    version: 5,
    name: '005_shared_photo_albums',
    up: (d: DatabaseSync) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS photo_albums (
          id TEXT PRIMARY KEY,
          share_url TEXT NOT NULL,
          album_key TEXT NOT NULL UNIQUE,
          auth_key TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1,
          photo_count INTEGER NOT NULL DEFAULT 0,
          last_synced_at TEXT,
          sync_error TEXT,
          created_at TEXT NOT NULL
        );
      `);
      if (!columnExists('photos', 'album_id')) {
        d.exec('ALTER TABLE photos ADD COLUMN album_id TEXT DEFAULT NULL');
      }
      d.exec('CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album_id, external_id)');
    },
  },
  {
    version: 6,
    name: '006_birthday_holiday_categories',
    up: (d: DatabaseSync) => {
      if (!columnExists('calendar_sources', 'category')) {
        d.exec('ALTER TABLE calendar_sources ADD COLUMN category TEXT DEFAULT NULL');
      }
      if (!columnExists('events', 'category')) {
        d.exec('ALTER TABLE events ADD COLUMN category TEXT DEFAULT NULL');
      }
      // Backfill: holiday / birthday calendars by ID or name, then each event (calendar wins, else "…Birthday" title).
      const sources = d.prepare('SELECT id, external_calendar_id, name FROM calendar_sources').all() as Array<{
        id: string;
        external_calendar_id: string;
        name: string;
      }>;
      const catBySource = new Map<string, EventCategory | null>();
      for (const s of sources) {
        const cat = categoryForCalendar(s.external_calendar_id, s.name);
        catBySource.set(s.id, cat);
        d.prepare('UPDATE calendar_sources SET category = ? WHERE id = ?').run(cat, s.id);
      }
      const events = d.prepare('SELECT id, title, calendar_source_id FROM events').all() as Array<{
        id: string;
        title: string;
        calendar_source_id: string | null;
      }>;
      const setCat = d.prepare('UPDATE events SET category = ? WHERE id = ?');
      for (const e of events) {
        setCat.run(categoryForEvent(catBySource.get(e.calendar_source_id ?? '') ?? null, e.title), e.id);
      }
    },
  },
  {
    version: 7,
    name: '007_recipe_nutrition',
    up: (d: DatabaseSync) => {
      if (!columnExists('recipes', 'nutrition_json')) {
        d.exec('ALTER TABLE recipes ADD COLUMN nutrition_json TEXT DEFAULT NULL');
      }
    },
  },
  {
    version: 8,
    name: '008_grocery_aisle_overrides',
    up: (d: DatabaseSync) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS grocery_aisle_overrides (
          name_key TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      // One-time re-sort of existing grocery items with the improved aisle rules (there was no way to
      // move items by hand before this version, so nothing user-chosen is overwritten).
      const items = d
        .prepare('SELECT li.id, li.text FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.is_grocery = 1')
        .all() as Array<{ id: string; text: string }>;
      const setCat = d.prepare('UPDATE list_items SET category = ? WHERE id = ?');
      for (const it of items) setCat.run(classifyGroceryItem(it.text), it.id);
    },
  },
  {
    version: 9,
    name: '009_family_extras',
    up: (d: DatabaseSync) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS countdowns (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '🎉',
          date_str TEXT NOT NULL,
          member_id TEXT REFERENCES family_members(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rewards (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '🎁',
          cost INTEGER NOT NULL DEFAULT 10,
          member_id TEXT REFERENCES family_members(id) ON DELETE CASCADE,
          active INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS reward_redemptions (
          id TEXT PRIMARY KEY,
          reward_id TEXT REFERENCES rewards(id) ON DELETE SET NULL,
          member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '🎁',
          cost INTEGER NOT NULL,
          redeemed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_redemptions_member ON reward_redemptions(member_id);

        CREATE TABLE IF NOT EXISTS routines (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '🌅',
          member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
          time_of_day TEXT NOT NULL DEFAULT 'morning',
          days_of_week_json TEXT NOT NULL DEFAULT '[]',
          stars INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS routine_steps (
          id TEXT PRIMARY KEY,
          routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '✅',
          sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_routine_steps ON routine_steps(routine_id, sort_order);

        CREATE TABLE IF NOT EXISTS routine_step_checks (
          step_id TEXT NOT NULL REFERENCES routine_steps(id) ON DELETE CASCADE,
          date_str TEXT NOT NULL,
          checked_at TEXT NOT NULL,
          PRIMARY KEY (step_id, date_str)
        );

        CREATE TABLE IF NOT EXISTS habits (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '💧',
          member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
          target_per_day INTEGER NOT NULL DEFAULT 1,
          unit TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS habit_logs (
          habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
          date_str TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (habit_id, date_str)
        );

        CREATE TABLE IF NOT EXISTS ics_feeds (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          name TEXT NOT NULL,
          member_ids_json TEXT NOT NULL DEFAULT '[]',
          category TEXT DEFAULT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          event_count INTEGER NOT NULL DEFAULT 0,
          last_synced_at TEXT,
          sync_error TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS grocery_history (
          name_key TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          category TEXT NOT NULL,
          add_count INTEGER NOT NULL DEFAULT 0,
          last_added_at TEXT NOT NULL,
          hidden INTEGER NOT NULL DEFAULT 0
        );
      `);
      if (!columnExists('events', 'travel_minutes')) {
        d.exec('ALTER TABLE events ADD COLUMN travel_minutes INTEGER DEFAULT NULL');
      }
      if (!columnExists('events', 'driver_member_id')) {
        d.exec('ALTER TABLE events ADD COLUMN driver_member_id TEXT DEFAULT NULL');
      }
      if (!columnExists('events', 'ics_feed_id')) {
        d.exec('ALTER TABLE events ADD COLUMN ics_feed_id TEXT DEFAULT NULL');
      }
      d.exec('CREATE INDEX IF NOT EXISTS idx_events_ics ON events(ics_feed_id)');
    },
  },
  {
    version: 10,
    name: '010_kid_artwork',
    up: (d: DatabaseSync) => {
      // Drawings from the Draw tab. No FK to family_members: a picture outlives a renamed/removed member.
      d.exec(`
        CREATE TABLE IF NOT EXISTS artworks (
          id TEXT PRIMARY KEY,
          member_id TEXT,
          filename TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_artworks_member ON artworks(member_id, updated_at);
      `);
    },
  },
  {
    version: 11,
    name: '011_drive_times',
    up: (d: DatabaseSync) => {
      // Google Maps drive times from home, cached per destination address (not per event: synced
      // and feed events get rewritten, and many events share one address).
      d.exec(`
        CREATE TABLE IF NOT EXISTS drive_times (
          dest_key TEXT PRIMARY KEY,
          home_key TEXT NOT NULL,
          minutes INTEGER,
          distance_m INTEGER,
          error TEXT,
          computed_at TEXT NOT NULL
        );
      `);
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
