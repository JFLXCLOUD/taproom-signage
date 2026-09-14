# Trial run

Getting one Windows PC and one Fire TV Stick running a real menu, end to end.

Downloads: **[github.com/JFLXCLOUD/taproom-signage/releases](https://github.com/JFLXCLOUD/taproom-signage/releases)**

---

## 1. The server (Windows PC)

1. Download `TaproomSignage-win-x64.zip` and unzip it somewhere permanent —
   `C:\TaproomSignage` is fine. **Not** inside Downloads, and not inside a OneDrive
   folder: OneDrive syncing a live SQLite database will corrupt it.
2. Run `TaproomSignage.exe`. A tray icon appears near the clock.
3. **Windows Defender will ask whether to allow network access. Say yes, and make sure
   "Private networks" is ticked.** If you miss this prompt the PC works fine but no TV
   can reach it — it is the single most likely reason the trial appears broken.
4. Right-click the tray icon → **Settings**. Change `password=changeme` to something
   real. Save, then right-click → **Restart server**.
5. Right-click → tick **Start with Windows**.

If the prompt in step 3 was missed, open an **admin** PowerShell once:

```powershell
netsh advfirewall firewall add rule name="Taproom Signage" dir=in action=allow protocol=TCP localport=8099
netsh advfirewall firewall add rule name="Taproom Discovery" dir=in action=allow protocol=UDP localport=41234
```

Check it works: right-click the tray icon → **Open control app**. Sign in.

> The port is 8099 by default. If something else holds it the server steps to the next
> free one and the tray tells you — the TVs do not care, they discover the port.

## 2. Put a menu on it

In the control app: **Menu** → edit the seeded demo board, or delete it and build your
own. Set the venue name and upload a logo under **Settings**.

Worth doing before the screen goes up, because it is what people notice: **Design** →
pick a theme, set **Orientation** to match how the TV is mounted, and check the live
preview.

## 3. The Fire TV Stick

**Enable sideloading:** Settings → My Fire TV → Developer Options → **Apps from Unknown
Sources: ON**. (On newer sticks you may first have to click "About → Fire TV Stick"
seven times to reveal Developer Options.)

**Install the app.** Either route:

*From the stick, no PC:* install **Downloader** from the Amazon Appstore, open it, and
enter:

```
github.com/JFLXCLOUD/taproom-signage/releases/latest/download/TaproomSignage-firetv.apk
```

*From the PC, if you have adb:* Developer Options → ADB debugging ON, then

```
adb connect <stick-ip>:5555
adb install -r TaproomSignage-firetv.apk
```

**Then, on the stick:** Settings → Display & Sounds → Screensaver → **Start After:
Never**. Not optional — the screensaver will cover the menu otherwise.

Open **Menu** from the Fire TV home row. It searches for the server by itself; no
address to type. When it finds one it shows a pairing code and a QR.

## 4. Pair it

Point your phone camera at the QR on the TV. The control app opens with the code
already filled in — choose which board it should show, and tap **Pair screen**.

Then in the control app: **Settings → Add to Home Screen**, so the menu editor behaves
like an app on the phone.

## 5. The checks that matter

Do these before you trust it for a shift:

| Check | How | Expect |
| --- | --- | --- |
| Live edit | Mark a tap **Kicked** on your phone | The TV updates in about a second |
| Server reboot | Restart the PC, do not open anything | Tray icon returns, board comes back |
| Screen reboot | Unplug the stick, plug it back in | Board returns without touching the remote |
| Server offline | Quit from the tray for a minute | TV keeps showing the last menu, not a blank screen |
| Server moved | Reconnect the PC to wifi so its IP changes | TV re-finds it within a minute |

That last one is the point of the whole discovery design — nothing is pinned to an IP.

## 6. If something is wrong

| Symptom | Cause, usually |
| --- | --- |
| TV says "No menu server found" | Firewall (step 1.3), or stick and PC on different networks — a guest wifi or a 5GHz/2.4GHz split with client isolation |
| TV finds it but shows an error | PC asleep. Set the PC to never sleep: Settings → System → Power |
| Board is blank but the TV is on | Screensaver (step 3) |
| Menu looks cramped or clipped | **Design** → Orientation, Columns, Text size |
| Nothing at all after a reboot | Tray → **Start with Windows** was not ticked; Windows auto-login is also needed if nobody logs in |

The tray icon's **Log** shows everything the server printed. On the stick,
`adb logcat -s TaproomSignage` shows what the app is doing.

## Known rough edges for this trial

- **The Fire TV app has never run on real hardware.** It compiles in CI and the APK is
  signed and complete, but boot auto-start is the piece most likely to need adjusting —
  Android restricts starting an activity from the background, and the app targets an
  older API level specifically to dodge that. If it does not come back after a power
  cut, that is the first thing to look at.
- **The Windows package is not code-signed**, so SmartScreen will warn on first run
  ("More info" → "Run anyway"). Signing needs a certificate.
- **Running the server on a desktop PC is a trial arrangement.** For anything permanent
  see [HARDWARE.md](HARDWARE.md) — a Raspberry Pi that runs its own Wi-Fi removes the
  firewall, sleep and same-network problems in one go.
