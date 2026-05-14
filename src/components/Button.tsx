import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type ViewStyle,
} from "react-native";
import { theme } from "../lib/theme";

interface ButtonProps extends Omit<PressableProps, "style"> {
  label: string;
  variant?: "primary" | "outline" | "ghost";
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  variant = "primary",
  loading = false,
  fullWidth,
  style,
  disabled,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const palette = {
    primary: { bg: theme.colors.brand,   fg: theme.colors.white, border: theme.colors.brand },
    outline: { bg: theme.colors.white,   fg: theme.colors.text,  border: theme.colors.borderStrong },
    ghost:   { bg: "transparent",        fg: theme.colors.brand, border: "transparent" },
  }[variant];

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: palette.bg,
          borderColor:     palette.border,
          opacity:         isDisabled ? 0.55 : pressed ? 0.85 : 1,
          width:           fullWidth ? "100%" : undefined,
        },
        style,
      ]}
    >
      <View style={styles.row}>
        {loading && <ActivityIndicator size="small" color={palette.fg} />}
        <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 16, fontWeight: "700" },
});
