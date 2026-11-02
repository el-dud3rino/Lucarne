# Lucarne

A fast, local-first, open-source family hub for a wall-mounted touchscreen: shared family calendar, chores, grocery lists, meal planning, and a photo screensaver. It's designed for a **1920×1080 landscape touchscreen** driven by a Raspberry Pi 5 or a small Linux PC, and phones on your home Wi-Fi get a companion app for free.

Inspired by the Skylight Calendar, but self-hosted: your family's data lives in one SQLite file on your own device. *Lucarne is an independent project and is not affiliated with or endorsed by Skylight.*

> **Status:** early and actively developed. Expect rough edges, and please report bugs through GitHub Issues.

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Hardware](#hardware)
- [Quick start (try it on your computer)](#quick-start-try-it-on-your-computer)
- [Google Calendar & Photos setup](#google-calendar--photos-setup)
- [Optional integrations](#optional-integrations)
- [Installing on a Raspberry Pi (wall display)](#installing-on-a-raspberry-pi-wall-display)
- [Phone companion](#phone-companion)
- [Updating, backups & troubleshooting](#updating-backups--troubleshooting)
- [Development & tests](#development--tests)
- [Privacy](#privacy)
- [Credits & acknowledgements](#credits--acknowledgements)
- [License](#license)

---

## Features

**Calendar**
- 5-day, week, month (5- or 6-week grid), and per-person column views, tuned for 1080p touch.
- Two-way Google Calendar sync for **multiple Google accounts** (for example, yours and your partner's). Changes arrive incrementally every 90 seconds, and an offline queue holds edits made while the internet is down.
- Each calendar can belong to **one or more people**. A "Twins" calendar, for example, shows on both twins' columns and filters.
- **10-day weather** on each day, plus tonight's dinner on the calendar.
- Recurring and multi-day events, and color-coded family members with tap-to-filter.

**Chores & stars**
- Morning, afternoon, evening, or anytime routines (daily, weekdays, weekends, specific days, or one-off).
- Assigned chores and "up for grabs" chores, with an internal star tracker for kids *and* parents. It's meant to pair with a physical star chart.

**Lists & groceries**
- Multiple lists, with groceries auto-sorted by store aisle and quantities merged ("2 cans" + "1 can").
- Live updates between the wall and phones.

**Meals**
- Weekly meal planner and a recipe library with a 1080p **Cook Mode**: big text, step timers, and the screen stays awake.
- Recipe import from a URL without the ads and life stories (schema.org data, with optional Gemini fallback).
- Send a week's ingredients to the grocery list, combining duplicates.
- Bulk import from a JSON file of meals.

**Photo screensaver**
- Pick photos with Google's official Photos Picker (up to 2,000 per pick), add **whole shared albums of any size** by link (they re-sync daily), or upload your own.
- Photos are stored locally, so links never expire and the frame works offline.
- Portrait photos are paired side by side, the order shuffles every time, and a night mode dims or shows just a clock.

**Built for a wall**
- Built-in on-screen keyboard, large touch targets, no loading spinners, and a tap-to-pick emoji picker.
- Optional **Google Keep** sync, so "Hey Google, add milk to my shopping list" shows up on the wall. Per-person chore lists can sync to Keep too.

## How it works

One Node.js process serves the API, the web app, and a live update stream, backed by a single SQLite database (`data/lucarne.db`). The wall display is just Chromium in kiosk mode pointed at it. Phones on the same network open the same app.

| Layer | Tech |
|---|---|
| Server | Node.js 24, [Hono](https://hono.dev), built-in `node:sqlite` (WAL), Server-Sent Events |
| Web app | React 19, Vite, Tailwind CSS v4, TanStack Query, lucide icons |
| Integrations | Google Calendar API, Google Photos Picker API, Open-Meteo weather, optional Gemini; optional Python helper for Google Keep |

Everything works offline except syncing with Google and the weather.

## Hardware

- **Computer:** a Raspberry Pi 5 (4 GB is plenty) **booting from an SSD** rather than a microSD card, or any small x86 mini PC (Intel N100-class) running Linux. Shared photo albums take roughly 0.5–1 GB per 2,000 photos.
- **Screen:** a 15–24" **1920×1080 touchscreen** in landscape. IPS panels look much better from an angle on a wall.
- Anything that runs Node.js 22.5+ works for trying it out, including Windows and macOS.

## Quick start (try it on your computer)

Requires **Node.js 22.5 or newer** (24 recommended) and git.

```bash
git clone https://github.com/el-dud3rino/Lucarne.git
cd Lucarne
npm install
cp .env.example .env      # optional for a first look; needed for Google features
npm run build
npm start
```

Open **http://localhost:3001**. On first start Lucarne creates `data/lucarne.db` with a small demo family you can rename or delete in **Settings**.

For development with hot reload, run `npm run dev` (web app on http://localhost:5173, API on :3001).

## Google Calendar & Photos setup

Each Lucarne install uses **its own** free Google Cloud project, so your data and API access stay yours. This takes about 10 minutes, once.

1. **Create a project** at https://console.cloud.google.com.
2. **Enable two APIs** (APIs & Services → Library): **Google Calendar API** and **Photos Picker API**.
3. **Set up the sign-in screen** (Google Auth Platform → Get started): choose app name "Lucarne", your email as support and developer contact, and **External** as the user type.
   - Don't upload a logo; that triggers Google's review process.
4. **Add Branding links.** Google requires a **home page** and **privacy policy** link before it will let you publish. Simplest option: fork this repo, enable GitHub Pages from the `/docs` folder (Settings → Pages), and use:
   - Home page: `https://<your-github-user>.github.io/Lucarne/`
   - Privacy policy: `https://<your-github-user>.github.io/Lucarne/privacy.html`
   - Authorized domain: `<your-github-user>.github.io`
5. **Publish the app** (Audience → Publish app). This matters: while the app is in **Testing**, Google expires sign-ins after **7 days**, and the wall calendar would quietly stop syncing every week. When signing in you'll see "Google hasn't verified this app". Click **Advanced → Go to Lucarne**; that's expected for a personal app.
6. **Create credentials** (Clients → Create client → **Web application**) with this authorized redirect URI:
   ```
   http://localhost:3001/api/google/callback
   ```
7. **Add them to `.env`:**
   ```ini
   GOOGLE_CLIENT_ID=1234567890-xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
   GOOGLE_REDIRECT_URI=http://localhost:3001/api/google/callback
   ```
8. Restart Lucarne, then open **Settings → Link Google Account**. On Google's permission screen, **make sure every checkbox is ticked**. Repeat for each family member's account, then tap the people each calendar belongs to.

> **Why localhost?** Google only allows plain `http://` sign-in redirects to `localhost`. Link accounts from a browser **on the Lucarne computer itself**, or from a laptop through an SSH tunnel to the Pi (see [below](#5-link-google-accounts-on-the-pi)).

## Optional integrations

### Recipe extraction & meal ideas (Gemini)
Add `GEMINI_API_KEY=...` to `.env`, or enter it in Settings. Without it, recipe import still works for any site that publishes standard recipe data (most do).

Lucarne automatically uses the newest stable Gemini Flash model and switches by itself when Google retires one. To pin a specific model, set `GEMINI_MODEL=...` in `.env`.

Some large recipe sites (for example Allrecipes and EatingWell) block automated downloads, so importing their URLs fails with "HTTP 403". For those, use JSON import below, or add the recipe by hand.

### Importing recipes from JSON
Bring an existing recipe collection in through **Meals → Import → JSON Meals Seed**, or from the command line:

```bash
npm run import:meals -- path/to/meals.json
```

See [`examples/meals.sample.json`](examples/meals.sample.json) for a complete example. The file can be a plain array of recipes or an object with a `meals`, `recipes` or `items` array. Recipes already in your library (same source URL, or same title when there's no URL) are skipped, so re-importing is safe.

| Field | Also accepted as | Notes |
|---|---|---|
| `title` | `name`, `meal` | **Required.** |
| `description` | `summary`, `notes` | |
| `ingredients` | `items` | A list of strings (`"2 cans black beans, drained"`, parsed automatically) or objects: `{ "name", "quantity", "unit", "notes", "category" }`. `name` may also be `item` or `ingredient`; `quantity` may be `amount`; `notes` may be `prep`. |
| `instructions` | `steps`, `directions` | A list of strings, a list of `{ "text": "…" }`, or one string with a step per line (leading "1." numbers are removed). |
| `prepMinutes` / `cookMinutes` | `prepTime`/`prep_time`, `cookTime`/`cook_time` | Minutes (`15`), ISO 8601 durations (`"PT1H30M"`), or text (`"20 min"`). |
| `servings` | `yield` | A number or text like `"6 servings"`. Defaults to 4. |
| `tags` | `category` | A list of strings, or a single `category` string. |
| `imageUrl` | `image`, `photo`, `thumbnail` | Image URL. |
| `sourceUrl` | `url`, `link` | Original recipe page. Also used to detect duplicates. |
| `favorite` | | `true` marks it as a favorite. |

Ingredient `category` must be one of: `Produce`, `Dairy & Eggs`, `Meat & Seafood`, `Bakery`, `Frozen`, `Pantry`, `Snacks & Drinks`, `Household`, `Other`. If it's left out, Lucarne picks the aisle automatically.

### Large shared Google Photos albums
The official picker is capped at 2,000 photos per pick. For bigger albums, open the album in Google Photos, tap **Share → Create link**, and paste the link in **Settings → Photo Screensaver Gallery → Shared albums**. Lucarne downloads every photo and re-checks the album daily.

- This reads Google's public share page, the same data the photos.google.com album viewer uses. It is **unofficial**: if Google changes that page, syncing pauses with an error, and photos already downloaded stay put.
- **Anyone with the link can view the album.**
- Photos are only ever removed locally after Lucarne has successfully read the *entire* album.

### Google Keep: voice shopping list & chore lists (unofficial)
Google Home and Gemini can only add voice items to **Google Keep**, and the official Keep API is limited to Google Workspace (business) accounts. Lucarne can two-way sync with Keep through a small, isolated Python helper (`keep-bridge/`) that uses the unofficial [`gkeepapi`](https://github.com/kiwiz/gkeepapi) library.

- **Lists:** link a Lucarne list (such as Groceries) to a Keep list. Items, quantities, check-offs, edits and deletes sync both ways, about every minute and within seconds of a change on the wall.
- **Chores:** link each person to a Keep list (Lucarne can create "Name's Chores" for you). It shows that person's chores due today; checking one off in Keep counts their stars. Lists reset at midnight.
- If Google changes something and the helper breaks, sync pauses (shown in Settings) and everything keeps working on the wall.

**Setup** (requires Python 3.10+; on Raspberry Pi OS: `sudo apt install python3-venv`):

```bash
npm run keep:setup   # creates keep-bridge/.venv and installs gkeepapi
npm run keep:login   # run in your own terminal; it asks for a secret token
```

`keep:login` needs a one-time `oauth_token`:
1. In a desktop browser, open https://accounts.google.com/EmbeddedSetup, sign in with the account that owns your Keep lists, and click **I agree**. The page may keep loading; that's fine.
2. Open DevTools (F12) → **Application → Cookies → accounts.google.com** and copy the value of `oauth_token`.
3. Paste it into the prompt right away; it's single-use and expires within minutes.

The resulting token is saved to `data/keep/credentials.json` (git-ignored). **It grants broad access to that Google account**, so keep the device secure; revoke it any time from your Google account's device list. Then choose lists in **Settings → Google Keep Lists**.

## Installing on a Raspberry Pi (wall display)

These steps target **Raspberry Pi OS (64-bit, Bookworm or newer)** and should work on any Debian-based distro. They assume Lucarne lives in `/opt/lucarne` and runs as a `lucarne` user.

### 1. Install system packages and Node.js 24
```bash
sudo apt update
sudo apt install -y git curl cage chromium fonts-noto-color-emoji python3-venv
# On Bookworm, if "chromium" isn't found: sudo apt install -y chromium-browser
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v24.x
```

### 2. Get Lucarne and build it
```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin lucarne
sudo git clone https://github.com/el-dud3rino/Lucarne.git /opt/lucarne
sudo chown -R lucarne:lucarne /opt/lucarne
cd /opt/lucarne
sudo -u lucarne npm ci
sudo -u lucarne npm run build
sudo -u lucarne cp .env.example .env
sudo -u lucarne nano .env        # add your Google client ID/secret (see above)
```

### 3. Run the server as a service
```bash
sudo cp deploy/lucarne.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lucarne
curl http://localhost:3001/api/health    # {"ok":true,...}
```
The service restarts automatically if it ever crashes, and starts on boot.

### 4. Start the kiosk on boot
The display runs Chromium full-screen under `cage`, a minimal Wayland kiosk compositor, on the console of your desktop user (here `pi`):

```bash
sudo raspi-config        # System Options → Boot / Auto Login → Console Autologin
sudo cp /opt/lucarne/deploy/kiosk-launch.sh /usr/local/bin/lucarne-kiosk
sudo chmod +x /usr/local/bin/lucarne-kiosk
echo '[ "$(tty)" = "/dev/tty1" ] && exec /usr/local/bin/lucarne-kiosk' >> ~/.bash_profile
sudo reboot
```

### 5. Link Google accounts on the Pi
Because Google only allows `localhost` sign-in redirects, link accounts in one of two ways:
- **From the wall itself:** use the touchscreen and on-screen keyboard to go to Settings → Link Google Account.
- **From a laptop (easier):** forward the port over SSH, then use the laptop's browser:
  ```bash
  ssh -L 3001:localhost:3001 pi@<pi-address>
  # then open http://localhost:3001 on the laptop → Settings
  ```

### 6. Optional: Google Keep on the Pi
```bash
cd /opt/lucarne
sudo -u lucarne npm run keep:setup
sudo -u lucarne npm run keep:login
```

## Phone companion

Any phone on your Wi-Fi can open `http://<lucarne-address>:3001`; the address is shown in **Settings**. Use **Add to Home Screen** for an app-like icon. Phones get a bottom tab bar and use their own keyboard. To use it away from home, put the device on a private network such as [Tailscale](https://tailscale.com) rather than exposing it to the internet.

## Updating, backups & troubleshooting

**Update:**
```bash
cd /opt/lucarne
sudo -u lucarne git pull
sudo -u lucarne npm ci
sudo -u lucarne npm run build
sudo systemctl restart lucarne
```
Database changes are applied automatically on start.

**Backups:** Lucarne snapshots the database daily into `data/backups/`, and you can trigger one in Settings. To move or restore an install, copy the whole `data/` folder; it holds the database, downloaded photos, and Keep credentials.

**Troubleshooting:**
- **Google errors** are shown in plain language in Settings, with a fix link and a Copy button.
- **"…API isn't enabled in your Google Cloud project"**: open the link in the message and click **Enable**, wait a few minutes, then retry.
- **Calendar stops syncing after about a week:** the Google app is still in **Testing**. Publish it (setup step 5), then reconnect the accounts.
- **Server logs:** `journalctl -u lucarne -f`.

## Development & tests

```bash
npm run dev            # hot-reload web app (5173) + API (3001)
npm run typecheck
npm test               # unit + integration + latency benchmarks
npm run test:e2e       # builds, then runs real-browser tests at 1920×1080 and phone size (uses Microsoft Edge via Playwright)
npm run import:meals -- ./meals.json
```

Tests never touch real Google services. They run against local mock servers (Google OAuth/Calendar/Photos, Gemini, Keep, and shared albums) and use a throwaway data folder, never your real `data/`.

Project layout: `src/server` (API, sync services, database migrations), `src/client` (React views and components), `src/shared` (types and logic shared by both), `keep-bridge/` (optional Python Keep helper), `deploy/` (systemd and kiosk files), `docs/` (GitHub Pages home and privacy pages), `tests/`.

## Privacy

There is no Lucarne cloud. Everything is stored on your own device, and data goes only to Google's own services (for the features you connect), Open-Meteo for weather, and Gemini if you add a key. See [`docs/privacy.html`](docs/privacy.html).

## Credits & acknowledgements

Lucarne stands on the shoulders of these projects. Thank you!

**Reverse-engineering references.** The protocol details for these unofficial integrations came from these projects; Lucarne's code is its own implementation.
- **Shared Google Photos albums:** the approach of reading public share pages via the web viewer's `snAcKc` request was learned from [Kedharnadh's pull request "photos: read public Google Photos albums"](https://github.com/ygelfand/libcountertop/pull/3) to [**ygelfand/libcountertop**](https://github.com/ygelfand/libcountertop) (AGPL-3.0), and from [**yumetodo/google-photos-album-image-url-fetch**](https://github.com/yumetodo/google-photos-album-image-url-fetch) (BSL-1.0).
- **Google Keep:** [**kiwiz/gkeepapi**](https://github.com/kiwiz/gkeepapi) (MIT), the unofficial Keep client used by `keep-bridge/`, and [**simon-weber/gpsoauth**](https://github.com/simon-weber/gpsoauth) (MIT) for the Google sign-in token exchange.

**Data & services**
- Weather data by [**Open-Meteo.com**](https://open-meteo.com/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Google Calendar API and Google Photos Picker API.

**Built with:** [Node.js](https://nodejs.org), [Hono](https://hono.dev), [React](https://react.dev), [Vite](https://vite.dev), [Tailwind CSS](https://tailwindcss.com), [TanStack Query](https://tanstack.com/query), [Lucide](https://lucide.dev) icons, [Cheerio](https://cheerio.js.org), [Google Gen AI SDK](https://github.com/googleapis/js-genai), and [Playwright](https://playwright.dev), plus [cage](https://github.com/cage-kiosk/cage) and Chromium for the kiosk.

**Inspiration:** the [Skylight Calendar](https://www.skylightframe.com/). Lucarne is not affiliated with Skylight.

All product names and trademarks belong to their owners. Lucarne's unofficial integrations are not endorsed by Google and may stop working if Google changes its services.

## License

[MIT](LICENSE) © 2026 el-dud3rino
