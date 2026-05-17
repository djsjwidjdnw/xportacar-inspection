import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "../lib/theme";

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={28} color={theme.colors.brand} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 24, alignItems: "center" },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: theme.colors.brandLight,
    alignItems: "center", justifyContent: "center",
    marginBottom: 12,
  },
  title: { fontSize: 15, fontWeight: "800", color: theme.colors.text, textAlign: "center", marginBottom: 4 },
  body:  { fontSize: 12, color: theme.colors.textLight, textAlign: "center", lineHeight: 18, maxWidth: 280 },
});
