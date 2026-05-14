// Supabase client + SecureStore-backed session persistence for the
// XportACar buyer mobile app.

import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseAnonKey?: string };
const SUPABASE_URL =
  extra.supabaseUrl ?? "https://klettmjnnttajdyajafn.supabase.co";
const SUPABASE_ANON_KEY =
  extra.supabaseAnonKey ?? "sb_publishable_rawIwWZv12q9_VxVuaMOWQ_A2oXTEJ_";

// SecureStore on iOS/Android; localStorage shim on web.
const memoryFallback: Record<string, string> = {};
const SecureStoreAdapter = {
  getItem: async (key: string) => {
    if (Platform.OS === "web") {
      try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return memoryFallback[key] ?? null; }
    }
    return (await SecureStore.getItemAsync(key)) ?? null;
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS === "web") {
      try { globalThis.localStorage?.setItem(key, value); } catch { memoryFallback[key] = value; }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key: string) => {
    if (Platform.OS === "web") {
      try { globalThis.localStorage?.removeItem(key); } catch { delete memoryFallback[key]; }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
