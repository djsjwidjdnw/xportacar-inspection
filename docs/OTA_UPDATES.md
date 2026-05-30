# OTA updates (EAS Update) — XportACar Inspector

Future JavaScript-only bug fixes can be shipped to installed apps **without a
new TestFlight/App Store build** via EAS Update.

## How it works
- App config (`app.json` → `expo.updates`) points at this project's update URL
  on `u.expo.dev`. The Expo project id is `aa330a36-df38-452f-9cb8-4c02c780701f`.
- `runtimeVersion.policy = "appVersion"` — a build's runtime version is its
  `expo.version` (currently **1.0.0**). Updates only ship to builds whose
  runtime version matches the update's runtime version. Changing the app
  version requires a new native build (see below).
- Builds carry a **channel** (set in `eas.json`): `production` builds pull
  from the `production` branch; `preview` builds pull from `preview`.
- `fallbackToCacheTimeout: 0` — the app does not block startup waiting for an
  update; it uses whatever JS bundle is cached and pulls a new one for the
  next launch.

## Publish a JS-only update
```bash
# from the repo root
eas update --branch production --message "Short description of the fix"

# preview/internal testers
eas update --branch preview --message "Test build of fix XYZ"
```
The command builds the JS bundle, uploads it to EAS, and points the named
branch at it. All installed `production`-channel builds at the matching
runtime version pick it up on next launch.

## What can be OTA'd, what needs a rebuild
**Can ship OTA** (JS/asset-only):
- React / TypeScript code changes
- Styling, copy, i18n string changes
- New images/fonts bundled with the JS
- Behaviour changes inside existing screens / components (e.g. inspection
  wizard tweaks, validation rules, paint-thickness UI polish)

**Needs a new native build** (`eas build --platform ios --profile production`):
- Adding/removing/upgrading any native module (anything that adds files to
  `node_modules` with native iOS code) — e.g. `expo-image-picker`,
  `expo-image-manipulator`, `expo-camera`, `expo-updates` itself, `react-native-*`
  packages with native deps.
- Changes to `app.json` `ios.infoPlist`, `ios.privacyManifests`,
  `ios.bundleIdentifier`, `permissions`, or any other config that affects the
  built binary.
- Bumping `expo.version` (because `runtimeVersion.policy = "appVersion"`).
- Upgrading the Expo SDK.

Rule of thumb: if it changes the bundled binary or its declared capabilities,
rebuild and resubmit. Otherwise, OTA.

## Test an update before promoting
1. Publish to `preview` and install a `preview` build on a tester device.
2. Verify the change.
3. Re-publish the same change to `production`:
   ```bash
   eas update --branch production --message "…"
   ```

## Roll back a bad update
List recent updates on a branch and re-point it at an earlier one:
```bash
eas update:list --branch production
eas update:rollback --branch production           # interactive
# or, point the branch at a specific older update id:
eas update --branch production --message "Rollback" --republish --group <update-group-id>
```
Devices fetch the rolled-back JS on the next launch.

## Limitations
- **Existing TestFlight builds cannot receive OTA updates.** They were built
  before `expo-updates` was added, so they have no updater. Only **future**
  builds (the next `eas build` after this commit) include the updater and can
  receive OTA.
- Updates only ship to builds whose **runtime version** matches. Today that's
  `1.0.0`. Once you bump `expo.version`, those older builds will be left on
  the last update published to their runtime version.
