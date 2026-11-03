# Lucarne

A fast, local-first, open-source family hub for a wall-mounted touchscreen: shared family calendar, chores, routines and rewards, grocery lists, meal planning, a drawing pad for the kids, and a photo screensaver. It's designed for a **1920×1080 landscape touchscreen** driven by a Raspberry Pi 5 or a small Linux PC, and phones on your home Wi-Fi get a companion app for free.

Inspired by the Skylight Calendar, but self-hosted: your family's data lives in one SQLite file on your own device. **No subscription:** features that other family displays put behind a yearly plan, like rewards, meal planning, the photo frame and AI import from photos, are all included. *Lucarne is an independent project and is not affiliated with or endorsed by Skylight.*

> **Status:** early and actively developed. Expect rough edges, and please report bugs through GitHub Issues.

![Lucarne Home screen on a 1080p wall display: today's calendar, chores per person, and lists](docs/screenshots/home.jpg)

<table>
  <tr>
    <td colspan="2"><img src="docs/screenshots/calendar-5day.jpg" alt="5-day family calendar"><br><sub><b>5-day calendar</b>: shared events get a diagonal band of each person's color, and drive times show when to leave</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/calendar-month.jpg" alt="Month view with birthdays and holidays"><br><sub><b>Month view</b>: birthdays 🎂 and holidays 🎉 in their own colors</sub></td>
    <td width="50%"><img src="docs/screenshots/chores.jpg" alt="Chores per person with stars"><br><sub><b>Chores</b>: per-person chores and stars</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/routines.jpg" alt="Morning and bedtime routines as checklists"><br><sub><b>Routines</b>: step-by-step morning and bedtime checklists</sub></td>
    <td><img src="docs/screenshots/kid-mode.jpg" alt="Kid mode with big tiles"><br><sub><b>Kid Mode</b>: one child's day with big, emoji-first tiles</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/rewards.jpg" alt="Star tracker with rewards"><br><sub><b>Rewards</b>: spend stars on rewards you set up together</sub></td>
    <td><img src="docs/screenshots/habits.jpg" alt="Habit tracking with streaks"><br><sub><b>Habits</b>: daily goals, a 7-day strip and streaks</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/magic-import.jpg" alt="Magic Import from a photo or email"><br><sub><b>Magic Import</b>: snap a flyer or paste an email, review, add</sub></td>
    <td><img src="docs/screenshots/groceries.jpg" alt="Grocery list sorted by aisle"><br><sub><b>Groceries</b>: sorted by aisle, with your family's usual items one tap away</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/meals.jpg" alt="Weekly meal planner"><br><sub><b>Meal planner</b>: send the week's ingredients to the list</sub></td>
    <td><img src="docs/screenshots/cook-mode.jpg" alt="Cook mode"><br><sub><b>Cook Mode</b>: big text, the screen stays awake</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/draw.jpg" alt="Drawing pad with crayons, markers and paint"><br><sub><b>Draw</b>: crayons, markers and paint for little kids, no reading needed</sub></td>
    <td width="50%"><img src="docs/screenshots/screensaver-art.jpg" alt="A child's drawing framed in the photo slideshow"><br><sub><b>Art in the slideshow</b>: saved drawings join the photo frame, about one per 10–15 photos</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/event-drive.jpg" alt="Event form with Google Maps place and automatic drive time"><br><sub><b>Drive times</b>: search a place, and Google Maps fills in the drive from home (your own choice always wins)</sub></td>
    <td width="50%"><img src="docs/screenshots/calendar-week.jpg" alt="Week view"><br><sub><b>Week view</b>: the whole family's week at a glance</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/screenshots/screensaver.jpg" alt="Photo screensaver with today's brief"><br><sub><b>Photo frame</b>: your photos with today's brief: when to leave, events, dinner, chores left, countdowns and a jacket/umbrella hint</sub></td>
  </tr>
</table>

<p>
  <img src="docs/screenshots/phone-calendar.jpg" alt="Phone companion: calendar" width="240">
  &nbsp;
  <img src="docs/screenshots/phone-groceries.jpg" alt="Phone companion: grocery list" width="240">
  <br><sub><b>Phone companion</b>: the same app on any phone on your Wi-Fi</sub>
</p>

<sub>Screenshots show a fictional demo household (<code>npm run demo:seed</code>).</sub>

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Hardware](#hardware)
- [Quick start (try it on your computer)](#quick-start-try-it-on-your-computer)
- [Google Calendar & Photos setup](#google-calendar--photos-setup)
- [Optional integrations](#optional-integrations)
- [Configuration reference](#configuration-reference)
- [Installing on a Raspberry Pi (wall display)](#installing-on-a-raspberry-pi-wall-display)
- [Phone companion](#phone-companion)
- [Updating, backups & troubleshooting](#updating-backups--troubleshooting)
- [Development & tests](#development--tests)
- [Privacy](#privacy)
- [Credits & acknowledgements](#credits--acknowledgements)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

**Home: today at a glance**
- The wall opens on **Home**: today's calendar on the left, with a "now" line, past events faded and what's on right now highlighted, plus the weather and tonight's dinner.
- On the right, **each person's chores** in their own color (swipe left/right for more people and "up for grabs"), with today's stars and progress bars. Tap to check one off.
- Below that, **every list** side by side: check items off, or add one right there. A checked item stays visible, crossed out, so a mis-tap is one tap to undo.
- Phones still open on the calendar; Home is one tap away in the bottom bar.

**Calendar**
- 5-day, week, month (5- or 6-week grid), and per-person column views, tuned for 1080p touch.
- Two-way Google Calendar sync for **multiple Google accounts** (for example, yours and your partner's). Changes arrive incrementally every 90 seconds, and an offline queue holds edits made while the internet is down.
- Each calendar can belong to **one or more people**. A "Twins" calendar, for example, shows on both twins' columns and filters.
- **Birthdays 🎂 and holidays 🎉** get their own colors, with toolbar toggles to show or hide them. Google's holiday and birthday calendars are recognized automatically, and a birthday that appears in two calendars shows once.
- **10-day weather** on each day, plus tonight's dinner on the calendar. Set the location by typing "City, State" in Settings, and Lucarne looks up its coordinates.
- Recurring and multi-day events, and color-coded family members with tap-to-filter.
- **Colors for shared events:** an event for several people is split into diagonal bands, one per person in their color, and a Family event shows everyone's, so you can tell at a glance who it's for.
- **Calendar links (read-only):** subscribe to any `.ics` / `webcal://` link, such as a school district calendar, TeamSnap or GameChanger schedule, or a family member's iCloud or Outlook calendar. Assign it to people, and it refreshes every 30 minutes.
- **Magic Import** (with a Gemini key): take a photo of a school flyer, sports schedule or invitation, or paste an email, and Lucarne finds the dates. You review and edit every event before anything is added.
- **Countdowns:** "🏖️ Lake House Weekend · 15 days" chips on the calendar, the photo frame and Kid Mode.
- **Leave-by alerts:** give an event a drive time and a driver. A banner then shows on every screen, e.g. "Leave in 12 min · Soccer at 5:30 · Dad driving".
- **Place search & automatic drive times** (with a Google Maps key): search places as you type in the event form. Every upcoming event with a full address, including ones synced from Google Calendar, gets a drive time from home with predicted traffic. Pick "No drive", a preset, or a **custom** time (up to 24 h, for road trips) to override it. See [setup](#place-search--drive-times-google-maps).
- **Sync Now** in Settings shows progress and the result, including exactly which calendar failed and why.

**Chores, routines, habits & rewards**
- Chores for morning, afternoon, evening or anytime (daily, weekdays, weekends, specific days, or one-off). Chores can be assigned or "up for grabs".
- **Routines:** ordered checklists like "School morning" or "Bedtime", one per child, with step emojis and ready-made templates. An optional star bonus is given when every step is done. The routine for the current time of day shows first.
- **Habits:** daily goals like water, reading minutes or piano, with a 7-day strip and a 🔥 streak.
- **Rewards:** set up rewards ("Pick the movie · 15 ⭐"), redeem them to spend stars, and see the history with undo. Stars come from chores and finished routines, for kids *and* parents.
- **Kid Mode:** a full-screen view of one child's day with big tiles: today's events, their routine, chores, habits, countdowns and star balance. It's made for kids who can't read yet.

**Lists & groceries**
- Multiple lists, with groceries auto-sorted by store aisle and quantities merged ("2 cans" + "1 can").
- Aisles are picked by the most specific match ("chicken broth" goes to Pantry, not Meat). If one is wrong, tap **⇄** on the item to move it, and Lucarne remembers that choice every time the item is added again.
- **Store order:** arrange the aisles in the order you walk your store.
- **Usual items:** one-tap tiles for what your family adds most often (learned from the list, and never from recipe ingredients). Items already on the list are hidden, and **Edit** removes a tile.
- Live updates between the wall and phones.

**Meals**
- Weekly meal planner and a recipe library with a 1080p **Cook Mode**: big text, step timers, and the screen stays awake.
- Recipe import from a URL without the ads and life stories (schema.org data, with optional Gemini fallback). The dish photo is saved locally.
- **Meal search** (with a Gemini key): describe what you want ("easy chicken tacos") and get **real recipes from real recipe sites**, with their own photos. Results come first from popular food blogs' own site search, and Gemini suggests more only when that finds too few. Nothing is invented: every result is a page Lucarne opened and verified.
- A **recipe preview** with servings, prep and cook time, and calories, protein, carbs and fat per serving, as published by the site.
- **Plan my week:** fills the empty dinner nights **only with recipes from your own Recipe Box**. With a Gemini key it picks for variety and follows notes like "quick on Tuesday, no fish". Without a key, or when Gemini is busy, it rotates your recipes, favorites and least-recently-cooked first. You can swap any night before saving.
- Send a week's ingredients to the grocery list, combining duplicates.
- Bulk import from a JSON file of meals.

**Draw**
- A drawing pad for little kids: tap who's drawing, then pick **crayons, markers or paint** (each with its own box of colors to swipe through) or the eraser. Everything uses pictures, so no reading is needed.
- Tap ✓ to save. A picture left alone for a minute saves itself. Saved pictures can be reopened later to keep drawing, and the trash can throws away an unsaved scribble.
- Every saved drawing joins the photo screensaver, framed with the artist's name: about one drawing for every 10–15 photos.

**Photo screensaver**
- Pick photos with Google's official Photos Picker (up to 2,000 per pick), add **whole shared albums of any size** by link (they re-sync daily), or upload your own.
- Photos are stored locally, so links never expire and the frame works offline.
- Portrait photos are paired side by side, the order shuffles every time, and a night mode dims or shows just a clock.
- **Today's brief** on the frame: when to leave, what's left today, dinner, who still has chores, countdowns, and a clothing hint from the forecast ("☔ Rain likely: grab rain jackets"). It can be turned off in Settings.

**Built for a wall**
- Built-in on-screen keyboard that appears when you tap a text box and closes when you submit, plus large touch targets, no loading spinners, and a tap-to-pick emoji picker.
- Errors are shown in plain language, can be selected and copied, and stay until dismissed.
- **Keeps working when the internet doesn't:** the wall runs on its own data. A small header chip says when you're looking at saved data ("Offline · saved data from 10:42", "Google sync paused · last 9:15"). The last forecast is kept on the device.
- **Automatic daily backups** (the last 14 are kept), with a one-tap **Restore** in Settings. A safety copy is taken first, so a restore can be undone.
- Optional **Google Keep** sync, so "Hey Google, add milk to my shopping list" shows up on the wall. Per-person chore lists can sync to Keep too.

## How it works

One Node.js process serves the API, the web app, and a live update stream, backed by a single SQLite database (`data/lucarne.db`). The wall display is just Chromium in kiosk mode pointed at it. Phones on the same network open the same app.

| Layer | Tech |
|---|---|
| Server | Node.js 24, [Hono](https://hono.dev), built-in `node:sqlite` (WAL), Server-Sent Events |
| Web app | React 19, Vite, Tailwind CSS v4, TanStack Query, lucide icons |
| Integrations | Google Calendar API, Google Photos Picker API, Open-Meteo weather and place lookup, optional Google Maps (Places API (New) + Routes API), optional Gemini; optional Python helper for Google Keep |

Everything works offline except syncing with Google and calendar links, the weather, and the Gemini features (Magic Import, meal search, AI week planning).

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

### Meal search & recipe cleanup (Gemini)
Get a free API key at [Google AI Studio](https://aistudio.google.com/apikey), then add `GEMINI_API_KEY=...` to `.env` or enter it in Settings. Without a key, recipe import still works for any site that publishes standard recipe data (most do); meal search needs the key.

**How meal search works:**
1. Gemini suggests recipe pages that match your search. It uses Google Search when your key allows it, otherwise its own knowledge.
2. Lucarne opens every suggested page and keeps only real recipe pages it can read. Made-up links, non-recipe pages and sites that block downloads are dropped, so a search may return fewer than three results rather than padded ones.
3. Results show the site's own photo, ingredients, steps and nutrition. The photo is saved locally when you tap **Save Recipe**.

**Models and free-tier limits:** Lucarne picks Gemini models automatically and switches when Google retires one. It uses full **Flash** models for searching and reading recipe pages, and lighter **Flash-Lite** models for small jobs like tidying ingredient lists. The free tier is tight: each Flash model allows about **5 requests a minute and 20 a day**, and Flash-Lite allows 15 a minute and 500 a day (limits are per model; check yours at [ai.dev/rate-limit](https://ai.dev/rate-limit)). Lucarne counts its own requests and skips a model at its limit. If Google is busy, it quickly tries another model. If everything is used up, the message says when it resets (midnight Pacific).

- `GEMINI_MODEL=...` pins one specific model.
- `GEMINI_PAID_TIER=1` turns off Lucarne's own free-tier limits if your key has billing enabled.

Some large recipe sites (for example Allrecipes, EatingWell, Budget Bytes and Simply Recipes) block automated downloads, so importing their URLs fails with "HTTP 403", and meal search skips them. For those, use JSON import below, or add the recipe by hand.

### Magic Import & Plan my week (Gemini)
Both use the same Gemini key as meal search. **Magic Import** (Calendar → ✨ Magic Import) sends the photo or text to Gemini. It returns draft events for you to check, and nothing is saved until you tap **Add**. Photos are shrunk to 2,000 px before upload. **Plan my week** (Meals) sends only your recipe titles and tags, never invents a recipe, and falls back to a simple rotation if Gemini is unavailable.

### Place search & drive times (Google Maps)
With a Maps key, the event form's location box searches places as you type ("bright smiles" → the dentist's full address). Every upcoming event with a full address, including events synced from Google Calendar, gets a drive time from home with predicted traffic. That feeds the "Leave in 10 min" banner. A drive time you pick on an event ("No drive", "15 min drive", …) always wins; **Auto** uses Google's estimate.

1. In the [Google Cloud console](https://console.cloud.google.com/) (the same project as Calendar is fine), turn on **billing**. Google requires it even inside the free monthly allowance, which a household stays well within.
2. **APIs & Services → Library:** enable **Places API (New)** and **Routes API**.
3. **APIs & Services → Credentials → Create credentials → API key.** Edit the key and, under **API restrictions**, allow only Places API (New) and Routes API. The key is used only by the Lucarne server, never in the browser.
4. Recommended: **Billing → Budgets & alerts**, create a $1 budget with email alerts. Optionally, under **APIs & Services → Quotas**, cap each API's requests per day.
5. In Lucarne, open **Settings → Maps & drive times**, paste the key, save your home address, and use **Test** to check it works.

Drive times are cached per address and refreshed weekly, plus once in the hours before an event to reflect that day's traffic. Without a key, the location box is plain text and drive times are picked by hand, as before.

### Calendar links (school, sports, iCloud, Outlook)
In **Settings → Calendar Links**, paste a subscribe link (`https://…ics` or `webcal://…`), choose whose events they are, and optionally mark it as a birthday or holiday calendar. The events are read-only on the wall; change them at the source. Lucarne checks each link every 30 minutes. If a download fails, the last good copy stays on the calendar and the error appears in Settings. Where to find links:
- **School / district:** usually a "Subscribe" or "iCal" button on the calendar page.
- **TeamSnap, GameChanger, SportsEngine:** schedule → Export/Sync calendar.
- **iCloud:** Calendar app → share a calendar → **Public Calendar** → copy the link.
- **Outlook.com:** Settings → Calendar → Shared calendars → **Publish a calendar** → ICS link.

### Importing recipes from JSON
Bring an existing recipe collection in through **Meals → Import → JSON Meals Seed**, or from the command line:

```bash
npm run import:meals -- path/to/meals.json
```

See [`examples/meals.sample.json`](examples/meals.sample.json) for a complete example. The file can be a plain array of recipes or an object with a `meals`, `recipes` or `items` array. Recipes already in your library (same source URL, or same title when there's no URL) are skipped, so re-importing is safe. If a skipped recipe has no photo yet and the file includes one, the photo is added. Image links are downloaded and stored locally.

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
| `nutrition` | | Per serving: `{ "calories", "proteinG", "carbsG", "fatG" }` as numbers, or the schema.org form recipe sites use (`"calories": "350 kcal"`, `"proteinContent": "25 g"`, …). |

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

## Configuration reference

Settings live in `.env` (copy `.env.example`). Google and Gemini keys can also be entered in **Settings** instead.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3001` | Web/API port. |
| `DATA_DIR` | `./data` | Where the database, downloaded photos, backups and Keep credentials are stored. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Your Google Cloud OAuth client (see setup above). |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3001/api/google/callback` | Must match the redirect URI in Google Cloud. |
| `GEMINI_API_KEY` | — | Enables meal search and AI recipe cleanup. |
| `GOOGLE_MAPS_API_KEY` | — | Place search and automatic drive times (or paste the key in Settings). |
| `GEMINI_MODEL` | automatic | Pin one Gemini model instead of automatic selection. |
| `GEMINI_PAID_TIER` | off | Set to `1` to disable Lucarne's free-tier request limits (billing-enabled keys). |
| `KEEP_PYTHON` | `python3` (`python` on Windows) | Python used to create the Keep helper's environment, if not the default. |
| `TZ` | system time zone | Time zone for repeating events and "today" (for example `America/Denver`). Normally just set the device's time zone instead. |

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
timedatectl              # check the time zone; fix with: sudo raspi-config → Localisation → Timezone
```
The device's time zone matters: repeating events and "today" (chores, meals) use it.

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

**Backups:** Lucarne snapshots the database every day into `data/backups/` and keeps the last 14. You can also take one with **Settings → Backup Now**. **Restore** restores any of them in place, with no restart; a safety copy of the current data is saved first, so a restore can be undone the same way. For an off-device copy, copy `data/backups/` (or the whole `data/` folder, which also holds downloaded photos and Keep credentials) to a USB stick or NAS now and then.

**Troubleshooting:**
- **Google errors** are shown in plain language in Settings, with a fix link and a Copy button.
- **"…API isn't enabled in your Google Cloud project"**: open the link in the message and click **Enable**, wait a few minutes, then retry.
- **Calendar stops syncing after about a week:** the Google app is still in **Testing**. Publish it (setup step 5), then reconnect the accounts.
- **"Gemini's free daily limit is used up"** or **"Gemini is busy right now":** the free tier allows only about 20 requests a day per Flash model, and Google is sometimes overloaded. Wait for the reset time shown, or add billing to the key and set `GEMINI_PAID_TIER=1`.
- **Meal search finds nothing:** try simpler words ("chicken tacos"), or paste a recipe link into **Strip Recipe Website URL**. Some sites block downloads and are skipped.
- **An item is in the wrong grocery aisle:** tap **⇄** on it and pick the right aisle. Lucarne remembers that choice.
- **A calendar link stopped updating:** Settings → Calendar Links shows the error. Common causes are a link that is no longer shared, or a school that changed its calendar URL. The last good copy stays on the calendar meanwhile.
- **"Leave in…" banner never shows:** it needs a drive time on the event (Edit event → Getting there).
- **Server logs:** `journalctl -u lucarne -f`.

## Development & tests

```bash
npm run dev            # hot-reload web app (5173) + API (3001)
npm run typecheck
npm test               # unit + integration + latency benchmarks
npm run test:e2e       # builds, then runs real-browser tests at 1920×1080 and phone size (uses Microsoft Edge via Playwright)
npm run import:meals -- ./meals.json

# Fictional demo household + README screenshots (never touches your real data/)
npm run demo:seed -- --fresh   # builds ./demo-data (git-ignored); dates are relative to today
npm run build && npm run demo:screenshots   # writes docs/screenshots/*.jpg
DATA_DIR=./demo-data PORT=3002 npm start     # browse the demo yourself
```

Tests never touch real Google services or recipe sites. They run against local mock servers (Google OAuth/Calendar/Photos, Gemini, Keep, shared albums, recipe pages) and use a throwaway data folder, never your real `data/`.

Project layout: `src/server` (API, sync services, database migrations), `src/client` (React views and components), `src/shared` (types and logic shared by both), `keep-bridge/` (optional Python Keep helper), `deploy/` (systemd and kiosk files), `docs/` (GitHub Pages home and privacy pages), `tests/`.

## Privacy

There is no Lucarne cloud. Everything is stored on your own device. Data goes only to:
- Google's own services, for the features you connect;
- Open-Meteo, for weather at the location you set (and to look up that place's coordinates when you type it);
- Google Maps, if you add a Maps key: what you type in the place search, your home address, and the addresses of upcoming events (including synced ones) to work out drive times;
- Gemini, if you add a key: your meal-search words; for pages without structured recipe data, the page text; the photo or text you give **Magic Import**; and your recipe titles and planning notes for **Plan my week**;
- the calendar-link (.ics) addresses you add, which Lucarne downloads every 30 minutes;
- the recipe websites whose pages you import or that meal search checks (Lucarne downloads those pages and photos like a browser would). Meal search also sends your search words to a list of food blogs' own site search.

See [`docs/privacy.html`](docs/privacy.html).

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

## Roadmap

Backlogged: a Home Assistant / webhook integration. Ideas and requests are welcome in GitHub Issues.

## License

[MIT](LICENSE) © 2026 el-dud3rino
