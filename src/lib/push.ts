// Push notification registration helper.  Asks for permission, fetches the
// Expo push token, and uploads it to the Supabase `push_tokens` table.

import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return null;

  let tokenPayload;
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    tokenPayload = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
  } catch {
    return null;
  }

  const token = tokenPayload?.data ?? null;
  if (!token) return null;

  // Persist on the server so the web app's notification logic can target us.
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
}
