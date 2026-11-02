# E2E Test Infra: Lucarne

## Test Philosophy
- Opaque-box, requirement-driven. No dependency on implementation design.
- Local deterministic mock servers and fixtures for all external dependencies (Google Calendar, Photos Picker 2025+, Gemini API, Recipe web pages).
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing.

## Feature Inventory & Test Mapping
| # | Feature | Source (Requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|----------------------|:------:|:------:|:------:|
| 1 | 1920×1080 Kiosk Zero Overflow & Layout | R1 | 5 | 5 | ✓ |
| 2 | Mobile Companion Viewport (<768px) | R1 | 5 | 5 | ✓ |
| 3 | On-Screen Touch Keyboard (Kiosk & Mobile) | R1 | 5 | 5 | ✓ |
| 4 | Primary Control Sizes (>= 40×40px CSS) | R1 | 5 | 5 | ✓ |
| 5 | Calendar Views (4-day, per-person, week, month) | R2 | 5 | 5 | ✓ |
| 6 | Recurring & Multi-Day Events | R2 | 5 | 5 | ✓ |
| 7 | Chores Routines & Star Ledger | R2 | 5 | 5 | ✓ |
| 8 | Shared Chores & Attribution | R2 | 5 | 5 | ✓ |
| 9 | Grocery Lists & Automatic Aisle Grouping | R2 | 5 | 5 | ✓ |
| 10 | Real-Time Live Sync (<1000ms) | R2 | 5 | 5 | ✓ |
| 11 | Weekly Meal Planner & Cook Mode | R3 | 5 | 5 | ✓ |
| 12 | Smart Ingredient Aggregation onto Groceries | R3 | 5 | 5 | ✓ |
| 13 | Recipe Web Scraping & Seed Import | R3 | 5 | 5 | ✓ |
| 14 | Multi-Account Google Calendar Sync & 410 Recovery | R4 | 5 | 5 | ✓ |
| 15 | Offline Outbox Queue Resilience | R4 | 5 | 5 | ✓ |
| 16 | Google Photos Picker 2025+ & Screensaver | R4 | 5 | 5 | ✓ |
| 17 | Database Seeding, Boot & Backup Snapshots | R4, R5 | 5 | 5 | ✓ |
| 18 | API Benchmark Latencies (<25ms Median) | R5 | 5 | 5 | ✓ |

## Test Architecture
- **Test Runners**:
  - `node --import tsx --test` or `vitest` for unit, API, deterministic mock integration, and benchmark suites.
  - Playwright (`@playwright/test`) for headless browser E2E tests at `1920×1080` (kiosk) and `390×844` (mobile companion).
- **Deterministic Mock Servers (`tests/mocks/`)**:
  - `MockGoogleServer`: Local HTTP server implementing Google OAuth token exchange, Google Calendar v3 events/syncToken with HTTP 410 Gone simulation and HTTP 503 offline simulation, Google Photos Picker 2025+ sessions/polling/media download.
  - `MockGemini`: Local deterministic response dispatcher for recipe normalization and meal discovery.
  - `Fixtures`: Local HTML recipe fixtures (`schema.org/Recipe` JSON-LD with ads/prose and unstructured HTML) and varied JSON meal seed files.
- **Benchmark Suite (`tests/benchmarks/`)**:
  - Automated measurement of median response latency across calendar queries, chore toggles, grocery additions/toggles, meal plan updates (<25ms threshold).
  - Multi-client live sync latency measurement (<1000ms threshold).

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Full Household Morning Routine | Chores, Calendar, Star Ledger, Live Sync across 2 clients | High |
| 2 | Weekly Meal Planning to Grocery Run | Meal Planner, Recipe Library, Smart Ingredient Aggregation, Groceries Aisle Grouping | High |
| 3 | Calendar Scheduling & Google Sync Recovery | Multi-day & recurring events, Google account sync, 410 Gone token recovery, offline outbox flush | High |
| 4 | Kiosk 1920×1080 Cook Mode & Screensaver | Recipe Cook Mode full-screen, idle photo screensaver with paired portraits, night mode dimming | Medium |
| 5 | Cross-Device Companion & Touch Keyboard | Kiosk virtual keyboard typing without obscuring input vs mobile companion phone keyboard suppression | High |

## Coverage Thresholds
- Tier 1: >= 5 per feature (>= 90 test cases)
- Tier 2: >= 5 per feature (>= 90 boundary & corner test cases)
- Tier 3: Pairwise coverage across major feature interactions (>= 18 tests)
- Tier 4: >= 5 comprehensive end-to-end real-world workload scenarios
- **Total Minimum Target**: >= 203 automated test cases
