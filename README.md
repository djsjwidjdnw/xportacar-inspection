# XportACar — Inspector mobile app

Field-team companion to XportACar.  Inspectors log into the app, see the
vehicles assigned to them, and run a five-step inspection wizard that
uploads everything (photos, damage report, documents) to the shared
Supabase project and flips the vehicle status to `inspected`.

**Stack:** Expo 54 · React Native 0.81 · TypeScript · Supabase JS ·
React Navigation native-stack · expo-camera · expo-image-picker ·
expo-image · expo-secure-store · expo-notifications.

## Workflow

1. **Login** — Supabase email/password.  Use any account with
   `profiles.role = 'inspector'` (e.g. `inspector@xportacar.com` / `Demo!1234`).
2. **Dashboard** — lists vehicles where `inspector_id = me` and
   `status in ('inspection_scheduled','draft')`, plus a recent-completed
   section.  Tap a row (or "Start a new inspection") to open the wizard.
3. **5-step wizard** — see below.

## Inspection wizard

1. **Vehicle details** — VIN, make, model, year, mileage, colour, city,
   seller contact.  Auto-populates if a vehicle row already exists.
2. **Photos** — 12 required angles (front/rear/left/right + 4 three-quarter
   shots + interior front/rear + engine + trunk).  Tap a tile to launch
   the device camera; the image is uploaded to Supabase Storage
   (`vehicle-photos/photos/{user_id}/{ts}-{slot}.jpg`).  Green ✓ when done.
3. **Damage report** — 12 standard body panels.  Tap to open a severity
   picker (none / cosmetic / minor / moderate / major) + description.
4. **Documents** — registration, service book, insurance — captured the
   same way as photos and stored under `vehicle-photos/documents/...`.
5. **Review & submit** — summary of photos / damages / documents.  Submit
   inserts/updates the `vehicles` row (status → `inspected`,
   `inspection_date = now()`, `inspector_id` = current user), inserts the
   photo + damage rows, and returns to the dashboard.

## Getting started

```bash
npm install
npx expo start
```

The `extra.supabaseUrl` / `extra.supabaseAnonKey` in `app.json` already point
at the shared XportACar Supabase project.

To assign vehicles to your inspector account, sign into the web app's
admin dashboard at `/admin/dashboard` and use the **Assign inspector**
dropdown on the Kanban "Scheduled" column.  The assigned inspector is
notified in-app and (if their push token is registered) via Expo Push.

### Build for stores

```bash
eas build -p ios     --profile production
eas build -p android --profile production
```

`bundleIdentifier` / `package`: `com.xportacar.inspector`.

## Permissions

- Camera (`NSCameraUsageDescription` / `android.permission.CAMERA`) — used
  for every photo and document capture.
- Notifications — optional; if granted, the inspector receives push
  notifications when a new vehicle is assigned to them.

## Notes

- Photo uploads are sequential; the wizard surfaces an inline spinner
  per tile so the inspector knows when each capture is safely persisted.
- The `vehicle-photos` Storage bucket is created on demand by the
  wizard the first time it uploads.
- Submission writes everything in a single round-trip per table to keep
  the inspector on the road and off WiFi when possible.
- Access is gated to staff: `RootNavigator` only shows the Dashboard/Wizard when
  the signed-in user's `profiles.role` is `inspector`/`admin`/`superadmin`
  (a non-staff account sees an "Inspectors only" screen). RLS also blocks any
  non-staff writes at the database as a second layer.

## Operations & deployment

### Where credentials / keys live
- Supabase URL + **publishable** anon key live in `app.json` → `expo.extra`
  (public by design; read at runtime via `expo-constants`).
- EAS / Apple signing credentials are managed by EAS — `credentials.json` and
  `credentials/` are gitignored. Inspect with `eas credentials`.
- ⚠️ **Security follow-up:** the auto.dev API key used for VIN decode + market
  valuation was previously hardcoded in `src/lib/valuation.ts`. It must be
  rotated and moved server-side — see the web repo's
  `docs/SECURITY_autodev_key.md`.

### Build & submit (EAS)
```bash
eas build  -p ios     --profile production
eas build  -p android --profile production
eas submit -p ios     --latest
eas submit -p android --latest
```
bundle id / package: `com.xportacar.inspector`. **Status:** flagged 3.2 by
Apple — staying on **TestFlight** for now, not publicly released.

### OTA updates (when to OTA vs rebuild)
Full guide in [`docs/OTA_UPDATES.md`](docs/OTA_UPDATES.md). JS/asset changes →
OTA; native/`app.json`/permission/`expo.version` changes → rebuild. Recent
JS-only fixes (top-level error boundary, inspector role gate, console cleanup,
double-submit guard on "Submit for listing") are OTA-compatible but not in the
current TestFlight build.

### Links
- Supabase project `klettmjnnttajdyajafn`
- App Store Connect — inspector app (TestFlight, 3.2 review)
- Web platform repo: [`xportacar`](https://github.com/djsjwidjdnw/xportacar)
