import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthProvider } from "./src/lib/auth";
import { I18nProvider } from "./src/lib/i18n";
import { RootNavigator } from "./src/navigation";

// Language + RTL are managed by I18nProvider (mirrors the buyer app). It
// reads the inspector's stored/profile locale on launch and applies the
// matching writing direction via I18nManager — applying it every cold
// start also self-corrects the global flag if another app in the same
// Expo Go process left it stuck (e.g. the buyer app running locale=ar).

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <I18nProvider>
            <StatusBar style="dark" />
            <RootNavigator />
          </I18nProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
