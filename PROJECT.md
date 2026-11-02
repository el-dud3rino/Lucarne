# Project: Lucarne

## Architecture
Lucarne is a local-first, appliance-grade family hub designed for a `1920×1080` landscape wall touchscreen and mobile LAN companion phones (`<768px`).
- **Client**: React 19, TypeScript, Tailwind v4, Vite 6, TanStack Query v5.
- **Server**: Node.js v22.5+ with Hono (`@hono/node-server`), built-in `node:sqlite` (DatabaseSync in WAL mode), Server-Sent Events (`/api/stream`) live synchronization bus.
- **Data Flow**: Optimistic client mutations -> REST API endpoints -> SQLite WAL transactions -> in-memory SSE invalidation broadcast -> instant multi-client UI updates (<1000ms).
- **External Integrations**: Google OAuth 2.0, Google Calendar v3 with incremental `syncToken` and offline outbox, Google Photos Picker 2025+, Cheerio recipe scraping, Gemini API recipe normalization.

## Code Layout
- `src/server/`
  - `index.ts`: Server startup, middleware, static file serving, port binding.
  - `sse.ts`: Server-Sent Events connection pool and broadcast invalidation bus.
  - `db/`
    - `connection.ts`: Database connection, pragmas, WAL mode, point-in-time backup snapshots.
    - `schema.ts`: DDL table definitions and versioned migration runner.
    - `seed.ts`: Default family members, events, chores, lists, recipes, photos.
  - `routes/`: Hono routers for `events`, `chores`, `lists`, `meals`, `photos`, `settings`.
  - `services/`: `google.ts` (OAuth, Calendar sync, Photos Picker), `recipes.ts` (scraping, Gemini normalization).
- `src/client/`
  - `App.tsx`: Top-level kiosk shell, navigation, family member filter header.
  - `views/`: `CalendarView.tsx`, `ChoresView.tsx`, `ListsView.tsx`, `MealsView.tsx`, `CookModeView.tsx`, `ScreensaverOverlay.tsx`, `SettingsView.tsx`.
  - `components/`: `OnScreenKeyboard.tsx`, `WeatherWidget.tsx`, touch modals.
- `src/shared/`
  - `types.ts`: Shared domain interfaces.
  - `ingredientAggregator.ts`: Smart ingredient deduplication and quantity summation.
  - `groceryClassifier.ts`: Automatic grocery aisle classification.
  - `dates.ts`: Date utilities.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Database Versioned Migrations & Backups | `PRAGMA user_version` migrations, `VACUUM INTO` point-in-time backups, empty boot seeding | M1 | R4, R5, Acceptance Criteria |
| 2 | Recurring Events Engine | Recurrence schema, rule expansion in backend, multi-member associations | M1 | R2, Acceptance Criteria |
| 3 | Smart Ingredient Aggregation Backend | Duplicate ingredient normalization and quantity summing for `send-to-groceries` | M1 | R3, Acceptance Criteria |
| 4 | Grocery Quantity Parsing & Merging | Freeform quantity extraction (`parseItemInput`) and list item deduplication | M1 | R2 |
| 5 | Deterministic Google Base URL Overrides | Environment variable base URLs for offline mock testing | M1 | R5 |
| 6 | Outbox Queue Resilience | Retry backoff and offline mutation preservation without 5-attempt abandonment | M1 | R4, Acceptance Criteria |
| 7 | On-Screen Touch Keyboard Ergonomics | Suppressed `<768px`, active `768px-1920px`, backspace repeat debounce, auto-scroll non-obscuring | M2 | R1, Acceptance Criteria |
| 8 | 40×40px Minimum Touch Target Compliance | Enlarge all 15+ undersized interactive controls to >= 40×40px CSS | M2 | R1, Acceptance Criteria |
| 9 | 1920×1080 Touchscreen & Zero Overflow | Zero horizontal scroll overflow (`scrollWidth <= clientWidth`), crisp 1080p kiosk layout | M2 | R1, Acceptance Criteria |
| 10 | Mobile Companion Layout (<768px) | Bottom navigation, vertical day column scroll, quantity input visible on mobile lists | M2 | R1 |
| 11 | Calendar Multi-Day & Recurring UI | `endDateStr` input for multi-day events, recurrence frequency selector, 5-day, per-person, week, month, dinner strip | M3 | R2, Acceptance Criteria |
| 12 | Chores Frequencies & Star Ledger | Weekly days-of-week picker, one-off date picker, routines, shared chore claiming, star ledger | M3 | R2, Acceptance Criteria |
| 13 | Grocery Lists & Real-time Live Sync | Multiple lists, aisle grouping, quick staples, quantity handling, SSE live sync | M3 | R2, Acceptance Criteria |
| 14 | Meal Planner, Recipe Library & Cook Mode | Weekly planner, recipe search, 1920×1080 Cook Mode, ingredient aggregation modal | M3 | R3, Acceptance Criteria |
| 15 | Recipe Web Import & Meal Seed Import | Schema.org JSON-LD extraction, ad/prose stripping, Gemini fallback, JSON seed import | M3 | R3, Acceptance Criteria |
| 16 | Photo Screensaver & Pairing | 1920×1080 screensaver, vertical portrait 16:9 pairing, night dimming/clock | M4 | R4, Acceptance Criteria |
| 17 | Comprehensive Settings UI | Night mode schedule, weather config, photo gallery/deletion, Google disconnect, member profile editing | M4 | R4 |
| 18 | Local Deterministic Mock Servers | MockGoogleServer (OAuth, Calendar v3, 410 Gone, 503 offline, Photos Picker), MockGemini, HTML/JSON fixtures | Test Track | R5, Acceptance Criteria |
| 19 | Latency Benchmarks & Sync Latency Suite | Automated latency benchmarks (<25ms median), multi-client live sync propagation (<1000ms) | Test Track | Acceptance Criteria |
| 20 | Headless Browser Playwright E2E Suite | 1920×1080 zero overflow, 40×40 targets, full user flows, Cook Mode, on-screen keyboard kiosk/mobile | Test Track | Acceptance Criteria |
| 21 | Final E2E Test Suite Pass (Tiers 1-4) | 100% pass of all automated test suites | M5 (Phase 1) | Acceptance Criteria |
| 22 | Adversarial Coverage Hardening (Tier 5) | White-box adversarial testing, edge case stress-testing | M5 (Phase 2) | Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Mock servers, test fixtures, benchmark suite, Playwright E2E suite, publish TEST_READY.md | none | DONE |
| M1 | Backend Architecture & Core Engine | Migration runner, recurrence schema & expansion, ingredient aggregator, list parser, Google base URLs, outbox resilience | none | DONE |
| M2 | Kiosk UX, Touch Keyboard & Mobile Companion | Keyboard suppression <768px, backspace debounce, auto-scroll non-obscuring, 40×40 touch targets, zero overflow | none | DONE |
| M3 | Feature Views: Calendar, Chores, Lists & Meals | Recurring/multi-day UI, chore frequency pickers, ingredient aggregation modal, cook mode, seed import | M1, M2 | DONE |
| M4 | Screensaver, Settings UI & Integrations Polish | Night mode controls, weather settings, photo gallery/deletion, Google disconnect, member editing | M1, M2 | DONE |
| M5 | Final Milestone (E2E Verification & Hardening) | Phase 1: Pass 100% E2E test suite (Tiers 1-4); Phase 2: Adversarial coverage hardening (Tier 5) | M1, M2, M3, M4, E2E | DONE |

## Interface Contracts
### `src/shared/ingredientAggregator.ts`
- `export interface AggregatedIngredient { name: string; quantity: string; category: string; notes?: string; sourceMeals: string[]; }`
- `export function aggregateIngredients(rawIngredients: Array<{ text: string; category?: string; mealName?: string; }>): AggregatedIngredient[]`
- Aggregates matching names (case-insensitive, normalized singulars), parses and sums numeric quantities with compatible units (e.g. `2 cups` + `1 cup` = `3 cups`), combines notes, assigns grocery aisle category.

### Recurrence Contract
- Schema: `recurrence_rule TEXT` in `events` table (format: `'daily' | 'weekly' | 'biweekly' | 'monthly' | null`).
- API: `GET /api/events?start=<iso>&end=<iso>` automatically projects and returns virtual event instances within the requested window with `id: "${originalId}_${occurrenceDate}"`, `isRecurringInstance: true`, `originalEventId: originalId`.

### List Quantity Contract
- `export function parseItemInput(rawText: string): { text: string; quantity: string; category: string; }`
- Parses strings like "2 gallons milk" -> text: "milk", quantity: "2 gallons", category: "Dairy & Refrigerated".
