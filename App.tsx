import { I18nManager } from "react-native";

// HARD LTR for the inspector app. The native I18nManager flag persists
// across reloads in Expo Go and can be stuck to RTL by another app that
// previously ran in the same process (e.g. the buyer app with locale=ar).
// Forcing both flags here, BEFORE any component imports, guarantees a
// clean LTR baseline on every cold start. The inspector UI is English-
// only, so we never need RTL.
I18nManager.allowRTL(false);
I18nManager.forceRTL(false);

import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthProvider } from "./src/lib/auth";
import { RootNavigator } from "./src/navigation";

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
