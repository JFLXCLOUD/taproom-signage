# Taproom Signage

Self-hosted digital signage for a bar or restaurant menu. A TV (Fire TV Stick, old laptop,
Raspberry Pi — anything with a browser) shows the board; you update it from an installable
phone app. Changes appear on every screen in well under a second.

- **Zero npm dependencies.** Node's built-in `node:sqlite` and HTTP server do everything.
  Nothing to `npm install`, no native builds, no supply chain.
- **Works on the venue LAN.** No cloud account, no monthly fee. If your internet drops, the
  boards keep working. If the *server* drops, each screen keeps showing its last menu.
- **Landscape or portrait.** A Fire TV always outputs a landscape picture, so portrait is done
  by rotating the board in CSS — a vertically mounted TV reads upright.

---

## Quick start

```bash
node src/server.js
```

Then open:

| What | Where |
| --- | --- |
| Control app (the PWA) | <http://localhost:8080/> |
| Display, paired | <http://localhost:8080/display> |
| Display, direct | <http://localhost:8080/d/main> |
| Display, rotation | <http://localhost:8080/p/evening-loop> |

Default password is `changeme`. The app warns you until you change it.

The first run seeds a demo board (10 taps, cocktails, a food section) so there is something
real on screen. Set `SEED_DEMO=0` to start empty.

### Docker

```bash
docker compose up -d --build
```

Edit `ADMIN_PASSWORD` and `TZ` in `docker-compose.yml` first. Data (SQLite + uploaded images)
lives in the `signage-data` volume — back it up, or use the in-app JSON export.

---

## How it fits together

```
                    ┌──────────────────────┐
  phone / laptop    │   Control PWA  /     │
  (the PWA)         │   installable, dark  │
                    └──────────┬───────────┘
                               │  REST (cookie session)
                    ┌──────────▼───────────┐
                    │  Node HTTP server    │  SQLite (node:sqlite, WAL)
                    │  + SSE event bus     │  uploads on disk
                    └──────────┬───────────┘
                               │  Server-Sent Events: "revision changed"
              ┌────────────────┼────────────────┐
     ┌────────▼──────┐ ┌───────▼───────┐ ┌──────▼────────┐
     │ Fire TV  /d/… │ │ Fire TV  /d/… │ │ paired screen │
     └───────────────┘ └───────────────┘ └───────────────┘
```

Every write bumps a revision counter and pushes it over SSE. Displays refetch and repaint.
A 60-second poll runs alongside as a safety net, because Silk quietly drops idle sockets.

### Boards, posters and rotations

There are two kinds of board and one way to sequence them:

- **Menu board** — sections and items, the dense tap-list layout.
- **Poster** — full-screen artwork with an eyebrow, headline, sub-headline and body. Use it for
  an event, a special, or a "kitchen closes at 10" notice. It is still a board, so it inherits
  your theme, works on a direct link, and can be pinned to a screen on its own.
- **Rotation** — an ordered list of boards with a duration each. Menu for two minutes, event
  poster for twenty seconds, back to the menu. Build it under *Screens → Rotations*, then point
  a screen at it (or open `/p/<slug>` directly).

A screen shows **either** one board or one rotation — picking one clears the other, so a screen
can never be in two minds about what it is displaying.

A long menu keeps flipping its own pages *inside* its rotation slot, so give it a slot long
enough to get through them: roughly `pages x page-flip-seconds`.

### Data model

```
settings (venue name, tagline, logo, currency, global theme)
├── boards          one screen layout; slug, theme overrides, ticker
│   ├── layout 'grid'    → sections and items
│   │   └── sections     "On Draft", "Cocktails", "Kitchen" …
│   │       └── items    name, tap #, style, producer, origin, ABV, IBU,
│   │           │        colour, image, badge, status, description
│   │           └── prices   several sizes (10 oz / 16 oz / pitcher)
│   └── layout 'poster'  → content: artwork, eyebrow, headline, subhead, body
└── playlists       a rotation
    └── playlist_items   board + how many seconds it stays up

devices (a paired screen) point at exactly one board OR one playlist.
```

---

## Putting it on a Fire TV Stick

1. **Install a browser.** Amazon Silk works. [Fully Kiosk Browser](https://www.fully-kiosk.com/)
   is much better for signage — sideload it with `adb install`.
2. **Open the display.** Either `http://<server>:8080/display` (shows a 6-character pairing
   code — type it into the PWA's *Screens* tab) or go straight to `http://<server>:8080/d/main`.
   Pairing is worth it: you can then change which board a TV shows from your phone, without
   touching the remote again.
3. **Stop the screensaver.** Settings → Display & Sounds → Screensaver → *Start After: Never*.
   This matters — the app asks for a wake lock, but Silk ignores it.
4. **In Fully Kiosk**, turn on *Keep Screen On*, *Start on Boot* and *Restore Last URL*, so the
   board comes back by itself after a power cut.

**Give the server a fixed address.** A DHCP lease change is the usual reason a board goes
blank overnight. Reserve its IP on your router, or use a hostname.

### Portrait mounting

Set *Design → Orientation* to **Portrait — rotate right** (or left, depending which way the TV
is turned). The stick still sends 1920×1080; the board is rotated inside that picture. Set
*Columns* to 1 or Auto at the same time.

---

## Using it behind the bar

The *Menu* tab is built for one-handed use mid-shift:

- **Tap the status pill** to cycle Pouring → Almost gone → Kicked → Coming soon. This is the
  thing you do most, so it is one tap and no dialog.
- **Tap an item** to edit everything: prices per size, ABV, IBU, badge ("Rare", "Cask"), colour.
- **▲▼** reorders taps.
- Kicked items stay visible with a strikethrough. Hide them entirely with *Hide from display*.

The *Design* tab has a live preview and edits **the current board**. "Copy this design to all
other boards" pushes it everywhere. Prices are printed verbatim if they are not plain numbers,
so `MKT` or `8/12` work as typed.

---

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `ADMIN_PASSWORD` | `changeme` | Single shared password. Sessions last 30 days. |
| `PORT` | `8080` | |
| `DATA_DIR` | `./data` | SQLite db + uploaded images. |
| `SEED_DEMO` | `1` | `0` starts with no boards. |
| `TZ` | system | Affects the on-screen clock. |

Display endpoints (`/d/:slug`, `/p/:slug`, `/api/board/:slug`, `/api/playlist/:slug`,
`/api/device/:id`) are **unauthenticated** —
a TV cannot hold a login. Everything that writes requires the session cookie. Keep the app on
your LAN, or behind Tailscale / a Cloudflare Tunnel if the venue is off-site.

---

## Things worth knowing

- **Pagination is measured against the live DOM.** Rows are appended one at a time and the
  browser is asked whether the column still fits. Measuring a detached clone is faster but
  lies: row heights *and* the usable stage height both shift when webfonts swap in. This way
  the board never clips and never leaves a column half empty.
- **Columns are created before anything is measured.** `.col` is `flex: 1 1 0`, so a lone column
  stretches to the full page width: measure a row in it and you get a figure that is wrong the
  moment the next column appears and halves the width.
- **Pages are balanced, not crammed.** Greedy packing leaves a single lonely item alone on the
  last page, holding a whole screen for its full rotation. So the board packs once to learn the
  page count and each block's real height, then binary-searches the shortest column height that
  still fits in that many pages. The search runs on measured numbers in plain JS, so only one
  extra pack ever touches the DOM. A board that does not fill its columns is centred vertically
  rather than left hanging from the top.
- **A section spilling across a column repeats its heading** marked "(cont.)", and a heading is
  never stranded alone at the foot of a column.
- **`1rem` = 1% of the panel's short edge**, in portrait too, so one design fits 720p, 1080p and
  4K with no media queries and rotating a screen does not magnify the text. The *Text size*
  slider scales that unit.
- **Icons are inline SVG** on a 24x24 grid, stroked in `currentColor` (`public/admin/icons.js`).
  No icon font, no CDN: the PWA has to work on venue wifi with no internet.
- **Images are downscaled in the browser** before upload, so a 12MP phone photo never reaches
  a Firestick. SVG upload is refused on purpose — it executes script when served same-origin.
- **A rotation is sent as one payload**, with every scene fully resolved. A screen never goes
  blank waiting on the next scene, and it keeps playing the whole loop if the server goes away.
  An edit mid-rotation re-sends everything, and the player stays on the scene already on screen
  instead of snapping back to the first one.
- **The service worker never caches `/api/`.** A bartender marking a keg kicked has to see the
  truth, not a cached copy.

## Backup

*Settings → Download backup* gives you a JSON file with every board, section, item and price.
Restoring can either merge or replace. Images are not included — they live in `DATA_DIR/uploads`.
