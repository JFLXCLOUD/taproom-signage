# Hardware & deployment

Goal: ship a box to a venue where nobody technical is present, and have them running
in under ten minutes without typing an IP address.

> **Status:** the bill of materials and the design below are researched but **not yet
> validated on real hardware.** Prices are approximate US street prices and move around.
> Treat the provisioning steps as a build plan to test, not a verified runbook.

---

## The problem with IP addresses

The display has to find the server. The three ways to do that are not equal:

| Approach | Why it fails a novice |
| --- | --- |
| Type `http://192.168.1.214:8099` on the TV | Remote-control typing is miserable, and the address changes when the DHCP lease moves |
| `taproom.local` (mDNS) | Fine on phones; **Fire OS resolves `.local` unreliably**, so it fails on the one device that matters |
| DHCP reservation on the venue router | Needs router login, and breaks the day the venue swaps ISP kit |

**The fix: the Pi runs its own Wi-Fi network.** It is then the DHCP server *and* the DNS
server for that network, so it can resolve every hostname to itself. The TV opens
`http://menu` and it simply works — no lookup, no typing an address, and nothing the
venue's IT changes can break.

It also means the signage network is completely independent of venue Wi-Fi. When the
pub changes its router password, the boards keep running.

```
                venue router ──eth0── ┌─────────────────┐
                (optional, for            │  Raspberry Pi   │
                 internet + staff         │  • signage app  │
                 phones on venue          │  • Wi-Fi AP     │  SSID: "RCYC Signage"
                 wifi)                    │  • DNS: * -> me │
                                          └───┬──────┬──────┘
                                        wlan0 │      │ HDMI
                               ┌──────────────┘      └──────────┐
                          Fire TV Stick                    TV #1 directly
                          http://menu                    (no extra hardware)
```

The app is built for this: it has **no external dependencies at runtime**, and the one
thing that wants internet — Google Fonts — has a *Download fonts from Google* toggle in
**Design** that falls back to built-in fonts. So the whole system works with no internet
at all.

---

## Bill of materials

### Core — one per venue (the server)

| Item | Approx | Notes |
| --- | --- | --- |
| Raspberry Pi 4 Model B, 2GB | $45 | 2GB is plenty. 1GB is fine headless; 4GB is wasted money |
| Official USB-C PSU (5V 3A) | $8 | **Do not** use a random phone charger — undervolting causes SD corruption |
| microSD 32GB **high-endurance** | $10 | SanDisk High Endurance or similar. A cheap card is the #1 cause of dead signage |
| Case with heatsink | $8 | Passive is fine; it sits behind a TV |
| Ethernet cable | $5 | Optional — only for internet/venue-LAN access |
| **Core subtotal** | **~$76** | |

### Screen options

**(a) The Pi drives the first TV itself — $6**

| Item | Approx |
| --- | --- |
| micro-HDMI → HDMI cable | $6 |

Cheapest and by far the simplest: plug HDMI in, power on, the menu appears. No network
involved on the display side at all, because the server *is* the display. The trade-off
is that the Pi has to physically live at that TV.

**(b) Fire TV Stick — ~$25 per additional screen**

| Item | Approx | Notes |
| --- | --- | --- |
| Fire TV Stick HD | $25 | The cheapest model is fine — it renders one static page |

Runs the app in [`firetv/`](firetv/), which finds the server on the LAN by itself and
starts on boot — nothing to configure on the TV. Requires an Amazon account on the
device to enable ADB for the one-time sideload. [Fully Kiosk
Browser](https://www.fully-kiosk.com/) remains a no-build alternative if you would
rather not compile anything.

**(c) Raspberry Pi Zero 2 W as a dedicated player — ~$30 per screen**

| Item | Approx |
| --- | --- |
| Pi Zero 2 W | $15 |
| PSU + microSD + mini-HDMI cable | $15 |

Worth considering over the Fire TV Stick: no Amazon account, no sideloading, no OS
update that can silently break kiosk mode, and it is the same OS you already manage.
**Needs testing** — 512MB RAM running Chromium at 1080p is the marginal case here. The
board's DOM is light (a few dozen rows), so it will probably be fine, but confirm before
committing to it.

### Worked examples

| Venue | Hardware | Approx |
| --- | --- | --- |
| One TV | Core + HDMI cable | **~$82** |
| Two TVs | Core + HDMI + 1 Fire TV Stick | **~$107** |
| Four TVs | Core + HDMI + 3 Fire TV Sticks | **~$157** |

---

## What the venue actually does

This is the whole setup card. No addresses, no passwords to invent, no router access.

> 1. Plug the **grey box** into power. Wait two minutes.
> 2. Plug its HDMI cable into the TV. Switch the TV to that HDMI input.
>    *The menu appears.*
> 3. To edit the menu, on your phone join the Wi-Fi network **`RCYC Signage`**
>    (password on the sticker). Your phone will open the menu editor by itself.
>    *Or just point your phone camera at the QR code on the TV.*
> 4. Sign in with the password on the sticker. Tap **Add to Home Screen**.
>
> *Extra TVs:* plug in the black stick, join the same Wi-Fi, open the **Menu** app.
> It finds the menu by itself and shows a code to pair from your phone.

Step 3 works because of a captive portal: phones and tablets probe a known URL when they
join a network, and the Pi answers that probe with a redirect to the admin app. Same
mechanism as a hotel Wi-Fi login page.

---

## Provisioning (you do this once, before shipping)

### Server image

1. Raspberry Pi OS **Lite** (64-bit) for a headless server; **Desktop** if this Pi also
   drives a TV.
2. Install Node 24 and copy the app to `/opt/taproom`.
3. `systemd` unit so it starts on boot and restarts on failure:

```ini
# /etc/systemd/system/taproom.service
[Unit]
Description=Taproom Signage
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/taproom/src/server.js
Environment=PORT=80
Environment=DATA_DIR=/var/lib/taproom
Environment=ADMIN_PASSWORD=<printed on the sticker>
Environment=CAPTIVE_PORTAL=1
Restart=always
RestartSec=3
User=taproom
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

`PORT=80` matters: it is what lets the TV open `http://menu` instead of
`http://menu:8080`. `AmbientCapabilities` lets a non-root user bind port 80.

### Access point + wildcard DNS

Pi OS Bookworm uses NetworkManager, which can run an AP directly:

```bash
nmcli device wifi hotspot ifname wlan0 ssid "RCYC Signage" password "<sticker>"
```

Then point every hostname at the Pi. With `dnsmasq`:

```
# /etc/dnsmasq.d/taproom.conf
address=/#/10.42.0.1          # every name resolves to the Pi
```

So `http://menu`, `http://taproom`, anything — all reach the board. Give the Pi a fixed
address on its own AP subnet so this never drifts.

**Captive portal:** set `CAPTIVE_PORTAL=1` in the systemd unit. The server then answers
the Android, Apple, Windows and Firefox connectivity-probe URLs with a 302 to the admin
app; the wildcard DNS above is what routes those probes to the Pi in the first place.
Verified against all four probe paths.

Leave it **off** if you enable internet passthrough below — hijacking the probes would
make every device on the network believe it has no internet.

**Internet passthrough (optional):** if `eth0` is plugged into the venue router, enable
IP forwarding and NAT from `wlan0` to `eth0`, and the Fire TV Sticks get internet too.

> One radio cannot reliably be an access point and a Wi-Fi client at the same time. Use
> **ethernet** for the uplink, or accept that the signage network has no internet — the
> app does not need it.

### Remote support with Tailscale

Without this, a misbehaving venue is a drive. With it, it is a five-minute fix.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up   --authkey tskey-auth-XXXX   --hostname rcyc-signage   --advertise-tags=tag:signage   --advertise-routes=10.42.0.0/24   --ssh
```

- **Use a reusable, pre-authorised auth key with a tag.** That is what makes it
  unattended — nobody at the venue ever logs in to anything. Tagged nodes also have
  key expiry disabled by default, so the box does not silently drop off your tailnet
  in ninety days.
- **MagicDNS** then gets you `http://rcyc-signage` from any of your own devices.
- `--ssh` gives you Tailscale SSH for shell access without opening port 22.
- `--advertise-routes=10.42.0.0/24` (accept it in the admin console) puts the Pi's own
  Wi-Fi subnet on your tailnet, so you can reach the Fire TV Sticks too — worth it when
  a stick has wandered off and you want to see what it is showing.

**It needs the ethernet uplink.** Tailscale rides the venue's internet; on an AP-only
box with no uplink there is no remote support. That is a reason to plug in the cable
even when you do not need internet passthrough.

**Do not enable Tailscale Funnel.** Funnel publishes the box on the public internet,
which is exactly what this design avoids. Tailscale alone keeps it private to your
tailnet.

> Once the box is reachable from your tailnet, `ADMIN_PASSWORD` is the only thing
> between a tailnet user and the menu. Set a real one per venue, and use ACLs so the
> `tag:signage` nodes cannot reach each other.

### Fire TV Stick image

Per stick, once, before it ships:

1. Sign in to Amazon, connect to the `RCYC Signage` network.
2. Settings → My Fire TV → Developer Options → **ADB debugging on**.
3. Build and install the app:
   ```bash
   cd firetv && ./gradlew assembleDebug
   adb connect <stick ip>
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```
4. Settings → Display & Sounds → Screensaver → **Start After: Never**. Not optional —
   the app holds a screen-on flag but the Fire TV screensaver overrides it.

That is the whole stick setup. **No URL is entered anywhere**: the app broadcasts for
the server, and a server that moves is re-found automatically. See
[`firetv/README.md`](firetv/README.md) for the discovery protocol and the two items
that still need a device to settle (boot auto-start, WebView version).

Because discovery is a UDP broadcast, the stick and the Pi must share a broadcast
domain — which they do on the Pi's own access point. If you put them on separate VLANs
instead, the app falls back to sweeping the local /24, and if that is also blocked you
can type an address once via the MENU button.

**No-build alternative:** sideload Fully Kiosk Browser instead and set **Start URL**
`http://menu`, **Kiosk Mode**, **Start on Boot**, **Keep Screen On**, and **Reload on
connection error**. That relies on the Pi's wildcard DNS rather than discovery.

---

## Operational notes

- **The board survives the server going away.** Each display caches its last payload in
  `localStorage`, so a Pi reboot mid-service leaves the menu on screen rather than
  blanking it.
- **Back up `DATA_DIR`.** It holds the SQLite database and uploaded images. The in-app
  *Settings → Download backup* covers the menu data but **not** images.
- **SD cards die.** High-endurance card, clean shutdowns where possible, and keep a
  flashed spare card with the venue. The app's writes are small, but cards still wear.
- **Changing the admin password** means editing the systemd unit and
  `systemctl restart taproom` — worth a small script before this ships to anyone.

---

## Open questions to settle before shipping

1. **Pi Zero 2 W as a player** — does Chromium hold 1080p acceptably on 512MB? Untested.
2. **Fire TV alternatives** — an Android TV box with a preinstalled kiosk browser avoids
   the Amazon account entirely and may be cheaper in volume.
