# Taproom Signage

## Everyday controls

The app has three destinations: **TVs**, **Menus**, and **Posters**.

- **TVs:** open a named TV. **Choose what plays** selects menus, posters, order, and duration.
  **Screen setup** changes its name and orientation. Edit a menu or poster directly from its
  playback list; the editor has a back button to return to that TV.
- **Menus:** open a menu, search for an item, then tap its name or price. Name, price, availability,
  and visibility come first; drink details and images are optional. Choose **Reorder** to move items.
- **Posters:** add artwork or event text, choose TVs, review, and publish. Leave TVs unchecked to
  save for later. Finished artwork fits fully on screen.
- **Appearance:** inside a menu or poster, try a theme in the live preview, then **Save appearance**.
  TVs change only when saved. Includes Parisian Bistro, Coastal, Marquee, Fresh Market, and Stadium.
- **Show on TV:** inside an editor, add that content to selected TVs, alongside current playback
  or on its own. Editing shared content updates every TV that uses it. Playback and orientation
  choices only affect the TV being changed.
- **Venue:** the labelled header button opens the shared name, logo, and currency. Backups and
  saved rotations are under **App tools & backups**.

Orientation belongs to each TV and applies to every scene. Existing installations keep their
previous content orientation until a TV-specific choice is saved. Previews do not mark TVs online.
Publishing starts immediately when connected. Event dates are display text, not playback scheduling.
Remove expired posters with **TVs > open a TV > Choose what plays**.

### Automatic poster removal

When creating or editing a poster, optionally set **Remove from TVs on** to the day after the
event. It stops showing at midnight at the start of that date, in the timezone shown beside
the field (the server's timezone). The poster stays in the Posters library with an expired
label. Change or clear its removal date to use it again.

Rotations skip expired posters, including during cached offline playback. If nothing active
remains, the TV shows a neutral **No active content** message and stays paired. Date removal
does not restore content previously replaced by a poster; add a menu alongside it if you want
that menu to remain after the event.

### Menu-to-poster transitions

Open a menu > **Appearance > When this menu changes to a poster**, choose an effect,
then **Save appearance**. Each effect has a preview button that does not save changes.

- **Beer fill & drain:** photographic beer, foam and splashes fill the panel, then drain (about 6 seconds).
- **Ice-cold glass:** condensation fogs the screen, droplets slide down, then a clearing sweep reveals the poster (about 4.7 seconds).
- **Stage curtain:** shaded red velvet curtains close, pause, then open onto the poster (about 4.3 seconds).

Effects run only from menu to poster and preserve the poster's full display duration.
Both portrait directions work. Reduced-motion preferences skip automatic transitions;
explicit preview requests still play. TV-context previews use that TV's orientation.
The effects are local Canvas animations with no remote assets required for ice or curtains.
Physical TV smoothness still needs hardware testing.

[Screenshots and validation notes](docs/ui-review/README.md).

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

**Running a trial?** [TRIAL.md](TRIAL.md) is the step-by-step for one Windows PC and one
Fire TV Stick, including the firewall prompt that otherwise makes it look broken.

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

Default password is `changeme`. The server log notes when the default password is in use.

The first run seeds a demo board (10 taps, cocktails, a food section) so there is something
real on screen. Set `SEED_DEMO=0` to start empty.

### Windows server installer

Download **TaproomSignage-Setup-win-x64.exe** from the
[Releases page](https://github.com/JFLXCLOUD/taproom-signage/releases). Setup installs
an automatic Windows service, configures the firewall for local and routed private
networks, and asks for your control password and fixed port. The server runs before
sign-in. The desktop shortcut shows connection addresses for your phone and TVs.

For TVs on another Wi-Fi/VLAN, press **MENU > Enter address** on the Fire TV remote.
Your router must allow access to the server's TCP port (default **8099**).
[Installation, supported Windows versions, network rules, migration, and troubleshooting](docs/windows-install.md).

The portable ZIP is still available for trials: extract the whole folder and run
`TaproomSignage.exe`. Its tray startup is **at sign-in** and does not configure the
firewall. Build with `node scripts/build-windows.mjs --setup --release-only` to
produce both downloads without modifying a running portable installation.

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
  poster for twenty seconds, back to the menu. Build it under *Venue > App tools & backups > Saved rotations*, then point
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
   code — type it into the PWA's *TVs* tab) or go straight to `http://<server>:8080/d/main`.
   Pairing is worth it: you can then change which board a TV shows from your phone, without
   touching the remote again.
3. **Stop the screensaver.** Settings → Display & Sounds → Screensaver → *Start After: Never*.
   This matters — the app asks for a wake lock, but Silk ignores it.
4. **In Fully Kiosk**, turn on *Keep Screen On*, *Start on Boot* and *Restore Last URL*, so the
   board comes back by itself after a power cut.

**Give the server a fixed address.** A DHCP lease change is the usual reason a board goes
blank overnight. Reserve its IP on your router, or use a hostname.

### Portrait mounting

Open **TVs > your TV > Screen setup**. Choose **Tall / rotated right** if the TV was physically
turned clockwise, or **Tall / rotated left** for counter-clockwise. Save and look at the screen;
if it is upside down, choose the other direction. Every menu and poster on this TV follows that
setting, even when the same content also plays on a landscape TV.

If the player already outputs portrait, expand **Already rotated by the TV or player?** and
let the player handle orientation.

### Updating a menu

Open **Menus**, choose a named menu, search for an item, then tap its name or price. Save the edit.
Availability choices are Available, Running low, Sold out, and Coming soon. Hidden items remain
editable in the app. Themes and display fields are in that menu's **Appearance** tab, with an
explicit save. Prices such as `MKT` or `8/12` display as typed.

---

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `ADMIN_PASSWORD` | `changeme` | Single shared password. Sessions last 30 days. |
| `PORT` | `8080` | |
| `DATA_DIR` | `./data` | SQLite db + uploaded images. |
| `SEED_DEMO` | `1` | `0` starts with no boards. |
| `TZ` | system | Affects the on-screen clock. |
| `DISCOVERY` | `1` | `0` switches off the UDP discovery responder the Fire TV app uses. |
| `CAPTIVE_PORTAL` | `0` | `1` redirects OS connectivity probes to the admin app. Only for the Pi-as-access-point build — see [HARDWARE.md](HARDWARE.md). |

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
- **The venue name is never truncated.** It wraps to two lines, and if it still does not fit,
  `fitHeading()` binary-searches the largest font size that does. Line boxes are counted with
  Range rects, not `scrollHeight / lineHeight` - a big condensed uppercase face paints outside
  its line box, so that ratio reports a phantom extra line and shrinks the name for no reason.
  Poster headlines use the same fitter (up to three lines).
- **The pairing screen shows a QR code.** Scanning it opens the control app with the
  pairing code already filled in, so nobody reads an address off a TV and types it on a
  phone. The QR encoder is written into the app (`public/shared/qr.js`) because there is
  no CDN to reach on a venue network; `npm run verify:qr` checks it against python-qrcode
  and round-trips every symbol through OpenCV's decoder.
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

## Fire TV app

**[Download the latest Fire TV APK](https://github.com/JFLXCLOUD/taproom-signage/releases/latest/download/TaproomSignage-firetv.apk)**.
This permanent address can be used for a reusable Downloader code;
see [Downloader setup](docs/firetv-downloader.md).

**Downloader code: `8897966`** — enter it in Downloader on the Fire TV and select **Go**.

[`firetv/`](firetv/) holds a native Fire TV kiosk app: it finds this server on the LAN
by itself, remembers it, and restarts on boot — no address is ever typed into a TV.
`npm run find` runs the same discovery handshake from your laptop, and
`npm run check:firetv` asserts the app and server halves of the protocol still agree.

GitHub Actions builds the APK; physical Fire TV testing is still needed. See its README.

## Backup

*Settings → Download backup* gives you a JSON file with every board, section, item and price.
Restoring can either merge or replace. Images are not included — they live in `DATA_DIR/uploads`.
