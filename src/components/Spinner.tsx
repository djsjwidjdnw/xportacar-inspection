import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { theme } from "../lib/theme";

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" color={theme.colors.brand} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:  { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg },
  label: { marginTop: 12, fontSize: 13, color: theme.colors.textLight, fontWeight: "600" },
});
