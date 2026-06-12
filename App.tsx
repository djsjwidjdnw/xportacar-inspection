import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as Updates from "expo-updates";

import { AuthProvider } from "./src/lib/auth";
import { I18nProvider } from "./src/lib/i18n";
import { RootNavigator } from "./src/navigation";
import { ErrorBoundary } from "./src/components/ErrorBoundary";

// Language + RTL are managed by I18nProvider (mirrors the buyer app). It
// reads the inspector's stored/profile locale on launch and applies the
// matching writing direction via I18nManager — applying it every cold
// start also self-corrects the global flag if another app in the same
// Expo Go process left it stuck (e.g. the buyer app running locale=ar).

export default function App() {
  // Apply a pending OTA update on launch. app.json sets
  // updates.fallbackToCacheTimeout=0, so a downloaded update otherwise only
  // takes effect on the NEXT cold launch — meaning a freshly-published OTA
  // (e.g. the bottom-tab nav) appears one relaunch late. Checking + reloading
  // here surfaces it within this session. Best-effort and guarded: skipped in
  // dev / Expo Go, only reloads when a newer update actually exists (so no
  // loop — after applying, the running bundle is current), and any failure is
  // swallowed so startup never blocks on the network.
  useEffect(() => {
    (async () => {
      try {
        if (__DEV__ || !Updates.isEnabled) return;
        const res = await Updates.checkForUpdateAsync();
        if (res.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch { /* run on the embedded/cached bundle */ }
    })();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <I18nProvider>
            <ErrorBoundary>
              <StatusBar style="dark" />
              <RootNavigator />
            </ErrorBoundary>
          </I18nProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
