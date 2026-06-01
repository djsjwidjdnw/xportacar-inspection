import { useState } from "react";
import {
  Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Icon } from "../components/Icon";

import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { registerForPush } from "../lib/push";
import { useTranslation } from "../lib/i18n";

export function LoginScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const signIn = async () => {
    if (!email || !password) return Alert.alert(t("auth.missingInfo"), t("auth.missingBody"));
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      Alert.alert(t("auth.signInFailed"), error.message);
      return;
    }
    // Push is best-effort — Expo Go SDK 53+ removed push token support so
    // wrap defensively so a sync throw can't take the app down.
    try { void registerForPush().catch(() => {}); } catch { /* silent */ }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.logoWrap}>
          <Image source={require("../../assets/logo.jpg")} style={styles.logo} resizeMode="contain" />
        </View>

        <Text style={styles.tagline}>{t("auth.portal")}</Text>
        <Text style={styles.title}>{t("auth.signIn")}</Text>
        <Text style={styles.subtitle}>{t("auth.signInBlurb")}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>{t("auth.email")}</Text>
          <View style={styles.inputWrap}>
            <Icon name="mail-outline" size={16} color={theme.colors.textLight} style={styles.inputIcon} />
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholderTextColor={theme.colors.textLight}
              style={styles.input}
              placeholder="inspector@xportacar.com"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t("auth.password")}</Text>
          <View style={styles.inputWrap}>
            <Icon name="lock-closed-outline" size={16} color={theme.colors.textLight} style={styles.inputIcon} />
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoComplete="password"
              placeholderTextColor={theme.colors.textLight}
              style={styles.input}
              placeholder="••••••••"
            />
            <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8} style={styles.eyeBtn}>
              <Icon name={showPw ? "eye-off-outline" : "eye-outline"} size={18} color={theme.colors.textLight} />
            </Pressable>
          </View>
        </View>

        <Pressable onPress={signIn} disabled={loading} style={({ pressed }) => [styles.btnShadow, pressed && { opacity: 0.92 }]}>
          <LinearGradient
            colors={[theme.colors.brand, theme.colors.brandDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.btn}
          >
            <Icon name="log-in-outline" size={18} color={theme.colors.white} />
            <Text style={styles.btnText}>{loading ? t("auth.signingIn") : t("auth.signIn")}</Text>
          </LinearGradient>
        </Pressable>

        <Text style={styles.foot}>{t("auth.foot")}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 56, paddingBottom: 48 },
  logoWrap:  { alignItems: "center", marginBottom: 24 },
  logo:      { width: 180, height: 90 },
  tagline:   { fontSize: 11, fontWeight: "800", color: theme.colors.brand, letterSpacing: 1.5, textAlign: "center", textTransform: "uppercase" },
  title:     { fontSize: 28, fontWeight: "800", color: theme.colors.text, textAlign: "center", marginTop: 6 },
  subtitle:  { color: theme.colors.textMuted, fontSize: 13, textAlign: "center", marginTop: 8, marginBottom: 32, lineHeight: 20, paddingHorizontal: 8 },
  field:     { marginBottom: 14 },
  label:     { fontSize: 11, fontWeight: "800", color: theme.colors.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    height: 50, borderRadius: theme.radius.lg, borderWidth: 1,
    borderColor: theme.colors.border, backgroundColor: theme.colors.white,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input:     { flex: 1, fontSize: 15, color: theme.colors.text },
  eyeBtn:    { padding: 4 },
  btnShadow: {
    marginTop: 8,
    borderRadius: theme.radius.lg,
    shadowColor: theme.colors.brand,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  btn:       {
    height: 52, borderRadius: theme.radius.lg, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8,
  },
  btnText:   { color: theme.colors.white, fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  foot:      { fontSize: 12, color: theme.colors.textLight, textAlign: "center", marginTop: 24 },
});
