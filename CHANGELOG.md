# Changelog

Each release's notes on GitHub come from its section here. Before tagging `vX.Y.Z`, rename
`## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and start a fresh `## [Unreleased]` above it.
The release workflow stops if the tagged version has no section.

## [Unreleased]

## [0.2.0] - 2026-11-13

**Smoother on phones and on the wall.** The phone calendar is rebuilt as a list you can actually read, multi-day events are drawn once instead of on every day, and chores know when someone is away.

### Phone
- **Calendar list:** each day shows its date on the left and compact event rows on the right, with about a week on one screen. Trips show "Day 3 of 7" and later days collapse to a slim row. Dinner shows when one is planned.
- **Calendar month:** dots for each day's events; tap a day to see its events underneath.
- 5-Day, Week and People are wall-only now. A + button sits in the corner, a "Today" button appears when you've moved away, and Countdowns, Magic Import and the calendar filter live under the ⋯ button.
- **Chores:** pick one person at a time from a row of avatars, instead of side-scrolling columns.
- **Meals:** a list of days with Breakfast, Lunch and Dinner rows (they were hidden before), opening on today.
- **Lists:** aisle sections fold up, and checked-off items hide behind a "Completed" toggle.
- **Home:** the Today card is no longer squashed, and the top header is shorter.

### Wall display
- **Multi-day events** are one bar across the days in 5-Day, Week and Month, instead of repeating in every day.
- **Month view** never cuts an event in half: when a day is full it shows a "+N more" chip; tap the date to see everything that day.
- **Finished events fade** in every calendar view.
- **Filter menu:** show or hide birthdays, holidays, dinner plans and weather on the calendar. Week view shows how many events each day has.

### Everywhere
- **Swipe left or right** to change days on the calendar, chores and meals (or months in month view), with a quick slide.
- **Away from home:** when someone has a vacation or trip (all-day or multi-day, not at your home address), their chores move to **Up for grabs** so anyone can do them for the stars. Each event has an "Away from home" setting: Auto, Away or Not away. Family-wide events never send everyone away automatically.
- **Skip a chore** for one day: no stars, and it doesn't count as missed. Tap it again to undo.

## [0.1.2] - 2026-11-13

Fixes for using Lucarne on a phone.

### Fixed
- The bottom tab bar no longer hides behind the phone browser's address bar, so you can leave the calendar and switch tabs
- Moving back or forward in the 5-Day and Week calendar views now shows which days are on screen (for example "Nov 18 – 22") instead of only the month
- The calendar's day list jumps back to the first day when you change dates or views

### Changed
- The calendar's Today button is highlighted only when today is on screen

## [0.1.1] - 2026-11-10

**Lucarne now runs in Docker.** Images are published for regular PCs (amd64) and the Raspberry Pi (arm64):

```bash
mkdir lucarne && cd lucarne
curl -fsSL -O https://raw.githubusercontent.com/el-dud3rino/Lucarne/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/el-dud3rino/Lucarne/main/.env.example
nano .env                 # set TZ, for example TZ=America/Chicago
docker compose up -d      # then open http://localhost:3001
```

Your data is kept in the `lucarne-data` volume. See [Run with Docker](https://github.com/el-dud3rino/Lucarne#run-with-docker) for updates, backups and what isn't supported in Docker yet (Google Keep sync).

### Added
- A Docker image (`ghcr.io/el-dud3rino/lucarne`) and `docker-compose.yml`, with a health check, a non-root user and a persistent data volume
- Every change is now built and checked in Docker automatically before release

### Changed
- Release notes now come from this changelog
- `.env.example` documents the `TZ` setting

### Testers wanted
Lucarne has mostly been tested on Windows so far. If you run it on a Raspberry Pi, in Docker, or on a touchscreen, please [open an issue](https://github.com/el-dud3rino/Lucarne/issues) or post in [Discussions](https://github.com/el-dud3rino/Lucarne/discussions), whether it works or it doesn't.

## [0.1.0] - 2026-11-05

**Lucarne's first public release.** Lucarne is a self-hosted family hub for a wall touchscreen: a shared calendar, chores and rewards, meal planning, grocery lists and a photo frame. Everything runs on a Raspberry Pi or small PC in your home, your data is one SQLite file on that device, and there's no subscription.

![Lucarne Home screen on a 1080p wall display](https://raw.githubusercontent.com/el-dud3rino/Lucarne/main/docs/screenshots/home.jpg)

## What's in it

- **Home screen:** today's calendar, each person's chores, tonight's dinner, the weather and every list, all on one screen.
- **Calendar:** two-way Google Calendar sync for several accounts, `.ics` links (school, TeamSnap, iCloud, Outlook), birthdays and holidays, countdowns, and "leave in 12 min" alerts with drive times.
- **Chores, routines, habits and rewards:** kids earn stars, spend them on rewards, and have a picture-based **Kid Mode** for those who can't read yet.
- **Lists and groceries:** items sorted by store aisle, quantities merged, one-tap "usual items", and optional Google Keep sync ("Hey Google, add milk").
- **Meals:** a weekly planner, a recipe box, recipe import from a URL without the ads, a full-screen Cook Mode with timers, and ingredients sent to the grocery list.
- **Draw:** a crayon, marker and paint pad for little kids. Their drawings show up in the photo screensaver.
- **Photo screensaver:** Google Photos Picker, shared albums of any size, or your own uploads, stored locally.
- **Built for a wall:** an on-screen keyboard, large touch targets, offline mode, and automatic daily backups with one-tap restore.
- **Phone companion:** any phone on your home Wi-Fi gets the same app with a mobile layout.
- **Optional AI features** using your own Gemini key: Magic Import pulls events from a photo of a flyer, meal search finds real recipes, and Plan my week fills your dinners.

## Install

**Try it on your computer** (Node.js 22.5+):
```bash
git clone https://github.com/el-dud3rino/Lucarne.git
cd Lucarne && npm install && npm run build && npm start
```
Then open http://localhost:3001. It starts with a demo family you can rename or delete.

**On a Raspberry Pi:** download `lucarne-v0.1.0.tar.gz` below. It's prebuilt, so there's no build step. Then follow the [Raspberry Pi guide](https://github.com/el-dud3rino/Lucarne#installing-on-a-raspberry-pi-wall-display).

Recommended hardware: a Raspberry Pi 5 (4 GB) booting from an SSD, and a 15–24" 1920×1080 touchscreen.

## This is an early release, so feedback is welcome

Lucarne is new and has mostly been tested on Windows so far, so expect rough edges. Testers running it on a Raspberry Pi or in Docker are especially welcome.

- 🐛 Found a bug? [Open an issue](https://github.com/el-dud3rino/Lucarne/issues).
- 💬 Ideas, questions, or a photo of your setup? Post in [Discussions](https://github.com/el-dud3rino/Lucarne/discussions).
- ⭐ If it's useful to you, a star helps other families find it.

*Lucarne is an independent project and is not affiliated with or endorsed by Skylight.*
