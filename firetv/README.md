# Taproom Signage — Fire TV app

**[Download the latest APK](https://github.com/JFLXCLOUD/taproom-signage/releases/latest/download/TaproomSignage-firetv.apk)** — this address stays the same across updates.
[Downloader short-code instructions](../docs/firetv-downloader.md).

A full-screen kiosk for a Fire TV Stick. It finds the signage server on the LAN by
itself, remembers it, shows the board, and comes back after a power cut.

Automatic discovery works on the local subnet. For another Wi-Fi/VLAN, press
**MENU > Enter address** and enter the server URL including its port. Manual
addresses stay pinned across outages; **Search again** explicitly clears them.
The router must allow TCP traffic from the TV subnet to the server.

GitHub Actions compiles the APK. Reboot behavior and animation performance still
need verification on physical Fire TV hardware. APKs currently use debug signing;
if Android reports a signature mismatch when upgrading an older build, uninstall
the older app first, then reinstall and pair the TV again.

---

## What it does

| | |
| --- | --- |
| **Finds the server** | Remembered address → UDP broadcast → sweep of the local /24 |
| **Survives a move** | Auto-discovered addresses can be rediscovered; manually entered addresses stay saved |
| **Survives an outage** | The board caches its last menu, so the screen keeps showing it |
| **Starts on boot** | `BOOT_COMPLETED` receiver relaunches it after a power cut |
| **Stays on** | `FLAG_KEEP_SCREEN_ON`, immersive fullscreen, BACK is swallowed |
| **Has an escape hatch** | MENU on the remote → search again / type an address / reload |

## Discovery

Strategies in order, first hit wins:

1. **Remembered address** — `GET /api/health`, which must answer
   `{"app":"taproom-signage"}`. That identity check is what stops the sweep latching
   onto some unrelated web server.
2. **UDP broadcast** — sends `TAPROOM-DISCOVER/1` to `255.255.255.255:41234` and each
   interface's directed broadcast. The server replies with `{"proto":"taproom/1","port":N}`.

   The reply carries **no address on purpose**: the app takes the host from the reply
   packet's *source IP*. A multi-homed server — the Pi has ethernet, its own access
   point and Tailscale — therefore never has to guess which of its addresses the TV
   can actually reach.
3. **Subnet sweep** — for networks that filter broadcast. Probes every host on the
   local /24 across ports 8080, 80, 8099, 48 threads, ~25s ceiling.

`scripts/check-firetv.mjs` asserts the probe string, protocol tag, port and health
identity all still match `src/discovery.js`, so the two halves cannot drift apart.

## Building

Needs JDK 17 and the Android SDK (Android Studio installs both).

```bash
cd firetv
gradle assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

There are **no dependencies** — plain `android.app.Activity` and
`android.webkit.WebView`, nothing from AndroidX — so a fresh machine has no
resolution surprises.

## Installing on a stick

```bash
# Fire TV: Settings -> My Fire TV -> Developer Options -> ADB debugging: ON
adb connect 192.168.1.50:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -s TaproomSignage          # everything the app logs
```

Then on the stick: **Settings → Display & Sounds → Screensaver → Start After: Never.**
The app holds `FLAG_KEEP_SCREEN_ON`, but the Fire TV screensaver overrides it.

The app appears on the Fire TV home row (it declares `LEANBACK_LAUNCHER`).

## Two things that will need a device to settle

**Auto-start on boot.** Android 10+ restricts starting an activity from the
background, which is exactly what `BootReceiver` does. The app targets **SDK 28**
specifically to stay on the permissive side of that; it is sideloaded, so Play Store
target-API rules do not apply. If a stick still refuses, the fallbacks are a foreground
service that launches the activity, or a third-party auto-start helper.

**WebView version.** The board's CSS uses flexbox `gap`, which needs Chromium 84+.
Recent sticks are far past that, but an old Fire OS 5 device may not be — Amazon
WebView updates through the Appstore. If the board renders as one long unspaced
column, that is what happened.

## Changing what a screen shows

Nothing in the app. It loads `/display`, which registers the screen and shows a
pairing code and QR — scan it with a phone and assign a board or a rotation from the
control app. The app never needs to know which board it is showing.
