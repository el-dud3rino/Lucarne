# Lucarne

A fast, local-first, open-source family hub inspired by Skylight Calendar — built specifically for a **1920×1080 landscape touchscreen** (Raspberry Pi 5 or Linux Mini PC) with an automatic **Mobile Companion PWA** for phones on your home Wi-Fi.

## Highlights

- **Zero-Spinner Local-First Speed**: Built on Node 24's native `node:sqlite` in `WAL` mode + optimistic React updates (<1ms local reads/writes, zero native C++ `node-gyp` build issues).
- **Multi-Account Google Calendar Sync**: Connect multiple Google accounts (e.g., yours + your spouse's) and map individual sub-calendars to color-coded family profiles with incremental `syncToken` background sync and an offline outbox queue.
- **Chores & Household Star Tracker**: Daily/weekday/weekend Morning, Afternoon, Evening, and Shared chores with instant check-offs and an internal Star Tracker for both kids and parents (designed to pair with a physical tactile star chart).
- **Smart Grocery Lists**: Automatic grocery aisle grouping (`Produce`, `Dairy & Eggs`, `Meat & Seafood`, `Bakery`, `Pantry`, `Frozen`, etc.), 1-tap staple chips, and instant SSE sync to phones at the store.
- **Meal Planner, Cook Mode & Ad-Free Recipe Importer**:
  - **Strip Recipe URLs**: Extracts clean ingredients, steps, and locally cached dish photos via `schema.org/Recipe` JSON-LD + `@google/genai` fallback (zero life stories or ads).
  - **JSON Meals Seed Importer**: Upload via UI (`Meals → Import → JSON Meals Seed`) or CLI (`npm run import:meals -- ./meals.json`).
  - **1080p Cook Mode**: Split-screen distraction-free cooking view with Screen WakeLock and 1-tap **Send Week's Meals to Groceries**.
- **Built-in 1080p On-Screen Touch Keyboard**: Smooth bottom-sheet QWERTY/number keyboard on the wall display that automatically stays hidden on mobile phones.
- **Google Photos Picker Screensaver**: Uses Google's 2025+ `photospicker` API + local SSD caching (never hits expiring 60-minute URLs) with side-by-side portrait photo pairing and Night Mode dimming.

## Quick Start (Development)

Requires **Node.js 22.5+ (Node 24 recommended)**.

```bash
npm install
npm run dev
```

- **1080p Wall / Dev UI**: `http://localhost:5173`
- **Local API & SSE Server**: `http://localhost:3001`

## Production Build (Single Process)

```bash
npm run build
npm start
```

Serves both the compiled SPA and SQLite API on `http://0.0.0.0:3001` (accessible from any phone on your LAN). See [`deploy/`](./deploy) for Raspberry Pi 5 / Linux Wayland (`cage` + Chromium) kiosk scripts.
