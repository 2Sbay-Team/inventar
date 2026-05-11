# What you need to use Inventar

Inventar runs entirely on your phone. There are no accounts, no servers,
no logins. But your phone and your browser need to meet a few requirements
for everything to work.

If something below is missing, the app may still open — but some features
(camera scanning, automatic backup, sharing invoices) will be silently
unavailable. This page exists so you know what to check.

---

## On Android

**Use Chrome.** Other Chromium-based browsers (Samsung Internet, Edge,
Brave, Opera) also work but Chrome is what we test against.

You need:

- **Chrome version 110 or newer.** Open Chrome → tap the menu (⋮) →
  *Settings* → *About Chrome*. If the number is below 110, update Chrome
  from the Play Store before installing Inventar. Below this version,
  Android shows an "unsafe app blocked" dialog when you try to install.
- **Android 8 or newer.** Older Android versions can't install modern
  PWAs reliably.
- **Camera permission.** When you first use scan-to-sell or scan-to-receive,
  Chrome asks for camera access. Tap *Allow* — without it, the in-app
  scanner won't work. You'd have to type each barcode by hand.
- **About 50 MB of free storage**, plus another ~200 KB per photo you add.

What works on Android:

| Feature | Works? |
|---|---|
| Install to home screen | yes, with one-tap install banner |
| Camera barcode scanner (EAN / QR) | yes |
| Auto-backup to a folder you pick | yes |
| Share invoice PDF (WhatsApp / email / Drive) | yes |
| Works offline after first load | yes |

---

## On iPhone / iPad

**Use Safari.** Chrome on iPhone uses Safari's engine under the hood, so
it has the same limits — but Safari is required for installing the app
to the home screen. Other browsers can't install PWAs on iOS.

You need:

- **iOS 15 or newer.** Older iPhones can't share files (so the
  invoice-share button falls back to a plain download), and several
  smaller features stop working.
- **iOS 16.4 or newer is recommended.** Earlier iOS versions don't send
  notifications to installed PWAs and have minor PWA quirks.
- **Camera permission.** Same as Android — without it, the in-app
  scanner can't read barcodes.
- **About 50 MB of free storage**, plus another ~200 KB per photo.

What works on iPhone:

| Feature | Works? |
|---|---|
| Install to home screen (via Safari Share → Add to Home Screen) | yes |
| Camera barcode scanner | **no** — Safari does not support the in-app barcode reader. You'll need to type the barcode in by hand, or use the manual EAN field. |
| Auto-backup to a folder | **no** — Safari does not support folder access. Use the manual *Settings → Export Data* button instead, ideally once a week. |
| Share invoice PDF | yes (iOS 15+) |
| Works offline after first load | yes |

If you only have an iPhone and your shop relies heavily on barcode
scanning, this is a real limitation. The app still works, but the
scan-and-sell flow becomes type-and-sell.

---

## On a desktop or laptop

The app is designed for phones, but it runs fine on a desktop browser
(Chrome, Edge, or Safari on a Mac) if you want to inspect data or do
data entry with a real keyboard. Same rules: Chrome 110+ for the auto-
backup folder feature, Safari for invoice sharing on a Mac.

Firefox is not supported. Some features (barcode scanner, auto-backup)
will be silently disabled.

---

## Internet connection

You only need internet **once** — the first time you open the app, to
download it. After that, Inventar works entirely offline. Sales, photos,
backups, invoices — all of it runs without a network.

When you do reconnect, Chrome may quietly fetch a newer version of the
app in the background. You'll see a small "Updated to v1.X" message the
next time you open it.

---

## Photos

- Maximum file size **25 MB per photo.** A normal phone-camera shot is
  3–5 MB, so you're well under the limit unless you use a 50-megapixel
  pro camera mode.
- The app automatically shrinks each photo to under 200 KB before
  storing it. You don't need to do anything.
- If you ever see "That photo is too big" — pick a smaller image, or
  retake it in normal photo mode (not RAW or pro).

---

## Storage and backups

Inventar stores everything on **your phone only**. If you lose the phone,
factory-reset it, or uninstall the app, the data goes with it. Nothing
is uploaded to any server — that's by design, for privacy.

This is why backups matter:

- **Android (Chrome):** Set up *Settings → Auto-backup folder* once.
  After that, the app writes a fresh backup file every time you make a
  change. Pick a folder that's synced by Google Drive or your phone's
  cloud backup, and you're covered.
- **iPhone (Safari):** Auto-backup isn't available on iOS. Open
  *Settings → Export Data* manually at least once a week. The export
  is a single JSON file you can email to yourself, save to Files, or
  drop into WhatsApp / iCloud Drive.

A weekly export is the minimum. If your shop is busy, daily is safer.

---

## If something is not working

1. Wait 10 seconds after opening the app. If it's stuck, a *Clear cache
   & reload* button appears.
2. Open *Settings → Maintenance*. The "Clear cached files" button
   refreshes the app code without touching your shop data.
3. If you can't open Settings, open your browser's *Site settings* and
   tap *Clear & reset* for `inventar.hoodhood.ai`. Your shop data lives
   in device storage and survives this — only the app code is being
   refreshed.
4. If the app still won't open, your data is **still there** in the
   device. Try opening Inventar in a different browser at the same URL
   to confirm.

---

## Quick check before you install

Tick all of these:

- [ ] Phone is Android 8+ with Chrome 110+, **or** iPhone with iOS 15+ (16.4+ recommended) and Safari.
- [ ] You have at least 50 MB of free storage.
- [ ] You can tap *Allow* on the camera permission prompt when it appears.
- [ ] You have a plan for backups: either a Drive-synced folder on Android, or a calendar reminder to export weekly on iPhone.

If all four are true, go to **https://inventar.hoodhood.ai** in your
browser and follow the install instructions on screen.
