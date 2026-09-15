# TV-first control app

## Latest previews

Screenshots use an isolated demo database.

- [TVs on a phone](workspace-tvs-mobile.png)
- [TVs on desktop](workspace-tvs-desktop.png)
- [TV playback workspace](workspace-tv-detail.png)
- [Orientation controls](workspace-orientation.png)
- [Menu editing](workspace-menu.png)

Older `home-*.png` images show the first draft, before this rebuild.

## Changes

Three destinations: TVs, Menus, Posters. Venue details have a labelled header button. Named
editors contain Items & prices (or Artwork & text) and Appearance, with a back button to the
TV or library. Playback controls come before previews on phones. Search, clickable prices,
explicit availability, and short item forms simplify everyday editing; reordering is opt-in.

Appearance has a local draft preview and an explicit save. Live updates preserve unfinished
appearance, poster, and venue forms. Navigation asks before discarding those drafts. Hash routes
preserve context on browser back and reload. New menus create a named initial section in the
same request. Show on TV assigns existing content transactionally to selected TVs.

The nullable devices.orientation column preserves existing behavior until a TV-specific setting
is saved. Device payloads override orientation for every scene without changing shared themes.
The read-only device preview endpoint neither registers a new TV nor updates last_seen.
PWA cache v14 includes the workspace, navigation, poster expiry, and all six transition modules. No runtime packages were added.

## Verification

`npm run verify:workflows` uses a temporary database. Set PLAYWRIGHT_MODULE to an installed
Playwright index.mjs to include browser checks. These cover:

- Sign-in, three-tab navigation, named editor context, and browser back.
- Per-TV orientation, mixed menu/poster payloads, isolation, and read-only previews.
- Search, price and availability editing, new menu/section/item, and Show on TV.
- Poster text, image upload, publish, save for later, and QR pairing through sign-in.
- Appearance previews, explicit saves, navigation cancellation, and live-update draft protection.
- TV, library, editor, appearance, and venue views at 320, 390, 768, and 1440 pixels.
- All five themes and beer animation coverage, timing, cancellation, portrait, reduced motion,
  direction gating, and the PWA animation preview.

## Beer transition

Open a menu > Appearance > When this menu changes to a poster > Beer fill & drain, then save.

[Filling](beer-filling.png) / [Full screen](beer-full.png) / [Revealed](beer-revealed.png).

## Real-device follow-up

The transition catalogue now includes Smoke reveal, Whiskey swirl, and Champagne
fizz. `node scripts/verify-beer.mjs --transitions` covers all five non-beer effects
through saved selection, actual menu/poster playback, opaque swaps, full poster
duration, mobile/desktop preview and replay, both portrait directions, cancellation,
and reduced motion. The beer-specific harness continues to cover the original effect.
Compact preview controls are checked at 320, 390, 768, and 1440 pixels, with
keyboard activation and descriptive accessible names. Touchscreens keep 44px targets.

Smoke and whiskey textures are generated once and reused. Champagne uses prepared
bubble sprites. All run under the shared canvas resolution/frame-rate cap and need
no new downloaded media. These are stylized simulations, not recorded footage.

Browser tests do not establish physical phone or Fire TV coverage. Check orientation on the
mounted TV and animation performance on the intended hardware. Poster dates remain display
text; scheduled start dates are not implemented. The separate Remove from TVs on field sets
an automatic midnight cutoff in the server timezone. Posters remain editable in the library.

Expiry tests cover date validation, exact midnight cutoff, mixed and expired-only playback,
preserved pairing, clearing the cutoff, creation/editing through the PWA, and expiry during
cached playback without a server connection. Accurate TV clock settings are required for
offline expiry. An expired sole poster shows No active content; it does not restore content
that was previously replaced.
