# TEST_READY: Lucarne Family Hub Test Suite Catalog

This document provides a comprehensive catalog of the automated test suites, deterministic local mock servers, test fixtures, benchmark performance results, and browser E2E verification for the **Lucarne** local-first wall-mounted family hub dashboard.

---

## 1. Test Suite Architecture & Directory Structure

All tests reside under `tests/` in isolated, self-contained suites using native Node.js test runner (`node:test`, `node:assert/strict`) and Playwright for headless browser automation.

```
tests/
├── benchmarks/
│   ├── apiLatency.test.ts            # Median REST API latency benchmarks across 100 samples/endpoint
│   └── liveSyncLatency.test.ts       # Multi-client SSE mutation broadcast latency (< 1000ms threshold)
├── e2e/
│   ├── kioskLayout.spec.ts           # 1920x1080 zero horizontal overflow & >=40x40px touch target sizes
│   ├── mobileCompanion.spec.ts       # 390x844 iPhone companion PWA layout, bottom tabs & overflow check
│   ├── testServer.ts                 # Production server lifecycle manager for isolated E2E tests
│   ├── touchKeyboard.spec.ts         # 1080p OnScreenKeyboard touch interactions & mobile suppression
│   └── userFlows.spec.ts             # Complete multi-view flows (Calendar, Chores, Groceries, Cook Mode)
├── fixtures/
│   ├── meals_seed_format1.json       # Array schema meal import seed
│   ├── meals_seed_format2.json       # Nested object schema meal import seed
│   ├── recipe_jsonld_ads.html        # Cluttered 30KB+ food blog with ads, cookies & Recipe JSON-LD
│   ├── recipe_unstructured.html      # HTML recipe without JSON-LD with .ad blocks
│   ├── sample_landscape.jpg          # Valid JPEG binary for Google Photos screensaver testing
│   └── sample_portrait.jpg           # Valid JPEG portrait binary
├── integration/
│   ├── calendar.test.ts              # Range queries, multi-member associations, recurring events expansion
│   ├── chores.test.ts                # Daily/weekday routines, assigned vs shared, star ledger calculation
│   ├── dbLifecycle.test.ts           # Boot seeding, schema idempotency, VACUUM INTO snapshots & integrity
│   ├── googleSync.test.ts            # OAuth token refresh, 410 Gone recovery, Photos Picker & outbox queue
│   ├── lists.test.ts                 # Freeform parsing, aisle categorization, quantity merge & completion
│   └── recipeExtraction.test.ts      # JSON-LD ad-stripping, cheerio fallback, and JSON format parsers
├── mocks/
│   ├── googleMockServer.test.ts      # Unit verification of the deterministic Google mock server
│   ├── googleMockServer.ts           # Deterministic HTTP server (OAuth, Calendar v3, Photos Picker 2025+)
│   └── mockGemini.ts                 # Deterministic ingredient parsing & normalization dispatcher
└── unit/
    ├── dates.test.ts                 # Date arithmetic, local noon normalization, week/month grids
    ├── groceryClassifier.test.ts     # Aisle categorization (Produce, Dairy, Frozen priority, etc.)
    └── ingredientAggregator.test.ts  # Fractions, culinary singularization, duplicate quantity merging
```

---

## 2. Test Execution Commands

The following npm scripts are defined in `package.json`:

| Command | Target | Scope |
|---|---|---|
| `npm run test` | All Non-E2E Tests | Executes `test:unit`, `test:integration`, and `test:benchmarks` |
| `npm run test:unit` | Unit Tests | Fast in-memory algorithmic & domain logic tests (17 tests, ~120ms) |
| `npm run test:integration` | Integration Tests | Database, domain services, Google sync, and recipe extraction |
| `npm run test:benchmarks` | Benchmarks | API latency distribution and SSE live sync propagation speed |
| `npm run test:e2e` | End-to-End Tests | Playwright browser tests (Kiosk 1080p, touch keyboard, mobile) |
| `npm run test:all` | Complete Suite | Runs `test` followed by `test:e2e` |

### Standalone Runner Commands:
```bash
# Run unit tests
node --import tsx --test tests/unit/*.test.ts

# Run a specific integration test
node --import tsx --test tests/integration/calendar.test.ts

# Run API latency benchmarks
node --import tsx --test tests/benchmarks/apiLatency.test.ts

# Run kiosk layout E2E test
node --import tsx --test tests/e2e/kioskLayout.spec.ts
```

*(Note for Windows environments: Ephemeral network port binding and browser automation may require elevated sandbox permissions).*

---

## 3. Test Coverage Matrix

### 3.1 Unit Testing (`tests/unit/`)
- **`dates.test.ts` (7 tests)**:
  - `toDateStr`: formats `Date` to `YYYY-MM-DD` without UTC day-slipping.
  - `parseLocalDate`: constructs local noon Date preventing daylight-savings day shift.
  - `addDays`: handles day addition/subtraction across month boundaries and leap years.
  - `startOfWeek`: anchors to Sunday or custom week start.
  - `startOfMonthGrid`: calculates starting Sunday for month grid display.
  - `isSameDay`: verifies day equality ignoring hours/minutes.
  - `eventOccursOnDay`: evaluates single-day, multi-day, all-day, and timed occurrences.
- **`ingredientAggregator.test.ts` (8 tests)**:
  - `parseFractionNumber`: parses integers, decimals, simple fractions (`1/2`), mixed numbers (`1 1/2`), and vulgar Unicode fractions (`½`, `¼`, `¾`, `⅓`, `⅔`, `⅛`, `⅜`, `⅝`, `⅞`).
  - `formatQuantityNumber`: converts numbers to culinary fraction string representations.
  - `formatQuantityWithUnit`: applies singular vs plural unit display rules.
  - `normalizeIngredientName`: strips plurals while respecting culinary invariant nouns (`asparagus`, `hummus`, `molasses`, `couscous`, `citrus`, `swiss chard`).
  - `normalizeUnit`: canonicalizes volume (`tbsp`, `tsp`, `cup`), weight (`oz`, `lb`), and count aliases (`can`, `clove`, `head`).
  - `parseItemInput`: extracts quantities, units, ingredient names, and auto-assigns grocery aisle.
  - `mergeQuantities`: combines matching units and flags incompatible unit combinations cleanly.
  - `aggregateIngredients`: merges duplicate ingredients across meals into consolidated grocery entries.
- **`groceryClassifier.test.ts` (2 tests)**:
  - Verifies classification across all 9 aisles: `Produce`, `Dairy & Eggs`, `Meat & Seafood`, `Bakery`, `Frozen`, `Pantry`, `Snacks & Drinks`, `Household`, and `Other`.
  - Verifies Frozen priority precedence over base ingredients (e.g. `frozen peas` -> `Frozen`).

### 3.2 Integration Testing (`tests/integration/`)
- **`dbLifecycle.test.ts`**:
  - Clean boot initialization and automatic migration.
  - Seeding 5 default family members (Dad, Mom, Leo, Maya, Whole Family).
  - Reboot idempotency: restarting against existing DB preserves all state without re-seeding duplicates.
  - Point-in-time SQLite snapshot backup via `VACUUM INTO` and verification with `PRAGMA integrity_check = 'ok'`.
- **`calendar.test.ts`**:
  - Date-window range queries.
  - Association of events with multiple family member IDs.
  - Synthetic expansion of recurring events across date windows.
  - Event update and deletion lifecycle.
- **`chores.test.ts`**:
  - Morning, afternoon, evening, and anytime routine grouping.
  - Daily, weekday, weekend, and specific-date chore recurrence.
  - Completion toggle and kid vs. parent star ledger calculations.
- **`lists.test.ts`**:
  - Freeform grocery input parsing and aisle categorization.
  - Duplicate item quantity accumulation (e.g., adding `2 jars` to existing `1 jar` becomes `3 jars`).
  - Item completion toggling and clearing checked items.
- **`recipeExtraction.test.ts`**:
  - Extraction of schema.org/Recipe JSON-LD from 30KB+ food blog HTML with tracker scripts and ads in <50ms.
  - Stripping of intrusive `.ad`, `.advertisement`, and tracker DOM elements.
  - Fallback unstructured recipe extraction via Cheerio.
  - Import parsing of seed recipe formats (array schema and nested object schema).
- **`googleSync.test.ts`**:
  - OAuth 2.0 token exchange and refresh.
  - Multi-account calendar discovery and sub-calendar to family member mapping.
  - Incremental `syncToken` delta synchronization.
  - Automatic full re-sync recovery on `410 Gone`.
  - Outbox mutation queuing when Google API is offline (503) and automatic flush when reconnected.
  - Google Photos Picker 2025+ session polling and local JPEG caching.

### 3.3 Benchmark Testing (`tests/benchmarks/`)
- **`apiLatency.test.ts`**:
  - 100 consecutive requests measured per core endpoint.
  - Target requirement: Median response latency < 25ms.
  - Measured results:
    - `GET /api/events` (Calendar query): Median **0.14 ms**, p95 **0.30 ms**
    - `POST /api/chores/:id/toggle` (Chore toggle): Median **0.16 ms**, p95 **0.30 ms**
    - `POST /api/lists/:id/items` (Grocery item add): Median **0.25 ms**, p95 **0.37 ms**
    - `PUT /api/lists/items/:id` (Item check toggle): Median **0.10 ms**, p95 **0.55 ms**
    - `POST /api/meals/plan` (Meal plan update): Median **0.05 ms**, p95 **0.11 ms**
- **`liveSyncLatency.test.ts`**:
  - Concurrent multi-client mutation propagation speed over Server-Sent Events (SSE).
  - Target requirement: Propagation latency < 1000ms.
  - Measured results:
    - Grocery list mutation broadcast: **11.78 ms**
    - Chore completion broadcast: **0.37 ms**
    - Calendar event mutation broadcast: **0.37 ms**

### 3.4 Headless Browser E2E Testing (`tests/e2e/`)
- **`kioskLayout.spec.ts`**:
  - Evaluates 1920x1080 kiosk viewport across all 7 views: Calendar (Schedule, People, Week, Month sub-views), Chores View, Lists View, Meals View, Cook Mode, Settings View, and Photo Screensaver Overlay.
  - Zero horizontal overflow assertion: `scrollWidth <= clientWidth` across all views.
  - Primary interactive control target size assertion: verifies navigation rail buttons, add buttons, and screen controls satisfy `>= 40x40px` touch target requirements.
- **`touchKeyboard.spec.ts`**:
  - Kiosk 1920x1080: Focuses text inputs, verifies `<OnScreenKeyboard>` appears at bottom with preview bar and quick chips (`Bread`, `Milk`, etc.).
  - Types letters with auto-capitalization (Shift), tests Backspace, Shift toggle, Number mode (`123 / #`), Quick-Tap chips, and Hide button.
  - Mobile Companion 390x844: Verifies virtual on-screen keyboard is completely suppressed on mobile screens (<900px) so the native OS keyboard can handle input.
- **`userFlows.spec.ts`**:
  - End-to-end user operations: creating multi-member calendar events, editing and deleting events; claiming and completing chores with star tracking; adding grocery items with automatic aisle classification and checking off items; planning meals, launching Cook Mode, and sending recipe ingredients to groceries.
- **`mobileCompanion.spec.ts`**:
  - Evaluates iPhone viewport (390x844).
  - Verifies desktop sidebar is hidden and mobile bottom tab navigation bar is rendered with 5 tabs.
  - Confirms tab switching and zero horizontal overflow across mobile views.

---

## 4. Deterministic Mock Infrastructure

- **`GoogleMockServer` (`tests/mocks/googleMockServer.ts`)**:
  - Local HTTP server supporting OAuth token exchange (`/token`), token refresh, userinfo (`/oauth2/v2/userinfo`), Calendar v3 calendar list (`/users/me/calendarList`), and events with incremental delta sync (`/calendars/:calendarId/events`).
  - Supports configurable fault injection:
    - `syncTokenExpired = true`: triggers HTTP 410 Gone to test client full-resync recovery.
    - `offline = true`: returns HTTP 503 to test outbox mutation queueing.
  - Google Photos Picker 2025+ simulation: creates sessions (`/v1/sessions`), tracks state (`mediaItemsSet`), and serves sample JPEG buffers.
- **`MockGemini` (`tests/mocks/mockGemini.ts`)**:
  - Deterministic response dispatcher for `@google/genai` calls.
  - Normalizes recipe ingredient quantities and units offline without requiring active internet connectivity or API keys.

---

## 5. Implementation Defects Discovered & Escalated

During test suite development and verification, the following implementation issue was identified and documented for escalation:

### Defect: Single-Word Plural Classification in `src/shared/groceryClassifier.ts`
- **Location**: `src/shared/groceryClassifier.ts`, line 72:
  ```ts
  const isMatch =
    lower === kw ||
    lower.startsWith(`${kw} `) ||
    lower.endsWith(` ${kw}`) ||
    lower.endsWith(` ${kw}s`) ||
    lower.includes(` ${kw} `);
  ```
- **Observed Behavior**:
  The condition checks `lower.endsWith(" " + kw + "s")` for multi-word phrases (e.g. `"yellow bananas"`), but omits `lower === kw + "s"`. Consequently, single-word plural inputs such as `"Avocados"`, `"Pretzels"`, or `"Bagels"` fail exact category matching and fall through to `"Other"`, unless pre-singularized by `ingredientAggregator.ts`.
- **Recommended Fix**:
  Add `lower === `${kw}s`` to the keyword match boolean expression:
  ```ts
  const isMatch =
    lower === kw ||
    lower === `${kw}s` ||
    lower.startsWith(`${kw} `) ||
    lower.endsWith(` ${kw}`) ||
    lower.endsWith(` ${kw}s`) ||
    lower.includes(` ${kw} `);
  ```
