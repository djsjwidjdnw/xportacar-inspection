// Cross-platform dialogs. react-native-web's Alert is a no-op (no dialog, and
// button callbacks never fire), so on web we use the browser's blocking
// window.alert / window.confirm. On native we use Alert.

import { Alert, Platform } from "react-native";

export function notify(title: string, message?: string) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (typeof g.alert === "function") g.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

/** Resolves true if the user confirms, false otherwise. Works on web + native. */
export function confirmAsync(
  title: string,
  message?: string,
  confirmLabel = "Confirm",
  destructive = false,
): Promise<boolean> {
  if (Platform.OS === "web") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (typeof g.confirm === "function") {
      return Promise.resolve(!!g.confirm(message ? `${title}\n\n${message}` : title));
    }
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ]);
  });
}
