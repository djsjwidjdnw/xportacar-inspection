// Push-notification registration helper.
//
// Important:  Expo Go in SDK 53+ no longer supports
// `Notifications.getExpoPushTokenAsync()` (FCM moved out of Expo Go).
// Trying to call it there throws a hard error and crashes the host app.
// We therefore short-circuit when running inside Expo Go or anywhere else
// where push isn't supported, and wrap the rest in a single try/catch so
// it can never crash the calling screen.  Push is best-effort, never
// blocking — the app should run identically whether registration
// succeeds or not.
//
// Once we move to development / production builds (EAS Build) the early
// return falls through and the full registration flow runs unchanged.

import { supabase } from "./supabase";

export async function registerForPush(): Promise<string | null> {
  // Push is intentionally DISABLED until the native builds are configured for
  // it. The shipped iOS build has NO Push Notifications capability (no
  // `expo-notifications` config plugin / `aps-environment` entitlement in
  // app.json), so calling getExpoPushTokenAsync() below drives native
  // remote-notification registration the binary isn't entitled for — which can
  // crash the app right after auth (same root cause fixed in the buyer app). A
  // JS try/catch cannot intercept that native failure, so we don't make the call.
  //
  // TO ENABLE PUSH LATER (requires a NATIVE REBUILD, not an OTA): add
  // "expo-notifications" to app.json `plugins`, add the iOS `aps-environment`
  // entitlement + `UIBackgroundModes: ["remote-notification"]`, run `eas build`,
  // and set PUSH_NOTIFICATIONS_ENABLED = true IN THAT SAME BUILD (never OTA this
  // flag onto an older binary that lacks the entitlement).
  const PUSH_NOTIFICATIONS_ENABLED = false;
  if (!PUSH_NOTIFICATIONS_ENABLED) return null;

  try {
    // Lazy-import the Expo modules so a missing native module on web /
    // unsupported runtime doesn't blow up the JS bundle import graph.
    const Device       = await import("expo-device");
    const Notifications = await import("expo-notifications");
    const Constants    = (await import("expo-constants")).default;
    const { Platform } = await import("react-native");

    // 1. Physical device only — emulators/simulators don't have push.
    if (!Device.isDevice) return null;

    // 2. Skip when running inside Expo Go.  Expo SDK 53 removed support
    //    for getExpoPushTokenAsync() in the Go client, so calling it
    //    throws.  Detect either of the modern signals.
    const isExpoGo =
      Constants.appOwnership === "expo" ||
      Constants.executionEnvironment === "storeClient";
    if (isExpoGo) {
      return null;
    }

    // Configure the foreground notification behaviour (safe in dev builds).
    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });
    } catch { /* harmless */ }

    // 3. Request permission.
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return null;

    // 4. Get the Expo push token (requires a dev/production build with
    //    the expo-notifications config plugin).
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      // deno-lint-ignore no-explicit-any
      (Constants as any).easConfig?.projectId;

    const tokenPayload = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenPayload?.data ?? null;
    if (!token) return null;

    // 5. Persist on the server so the web app can target this device.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("push_tokens").upsert({
        user_id:     user.id,
        token,
        platform:    Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web",
        device_name: Device.modelName ?? null,
        last_seen:   new Date().toISOString(),
      }, { onConflict: "user_id,token" });
    }

    return token;
  } catch (err) {
    // Best-effort — log once for diagnosis but never propagate.
    console.warn("[push] registration failed:", (err as Error)?.message ?? err);
    return null;
  }
}
