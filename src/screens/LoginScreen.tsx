import { useState } from "react";
import {
  ActivityIndicator, Alert, Image, InteractionManager, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Icon } from "../components/Icon";

import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { registerForPush } from "../lib/push";
import { notify } from "../lib/ui";
import { useTranslation } from "../lib/i18n";

export function LoginScreen({ navigation }: { navigation: { navigate: (s: string) => void } }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  // Forgot-password modal. Supabase emails a reset link that opens the web
  // reset page; the inspector sets a new password there and comes back to sign in.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSending, setResetSending] = useState(false);

  const signIn = async () => {
    if (!email || !password) return Alert.alert(t("auth.missingInfo"), t("auth.missingBody"));
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      Alert.alert(t("auth.signInFailed"), error.message);
      return;
    }
    // Push is best-effort AND deferred off the login transition. The original
    // first-login crash was a native push-registration call firing during the
    // auth->app navigation swap on a build with no push entitlement.
    // registerForPush is already gated to a no-op (lib/push.ts), but we ALSO
    // wait for the navigation animation + initial render to settle before
    // calling it, so when push is eventually enabled nothing native ever runs
    // inside that fragile transition window. Belt-and-suspenders, OTA-safe.
    InteractionManager.runAfterInteractions(() => {
      try { void registerForPush().catch(() => {}); } catch { /* silent */ }
    });
  };

  const openReset = () => {
    setResetEmail(email.trim());
    setResetOpen(true);
  };

  const sendReset = async () => {
    const addr = resetEmail.trim();
    if (!addr) { notify(t("pw.resetTitle"), t("pw.emailRequired")); return; }
    setResetSending(true);
    try {
      await supabase.auth.resetPasswordForEmail(addr, {
        redirectTo: "https://xportacar.com/reset-password/callback",
      });
      // Always report success (don't leak whether an account exists).
      setResetOpen(false);
      notify(t("pw.resetTitle"), t("pw.sent"));
    } finally {
      setResetSending(false);
    }
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
          <Pressable onPress={openReset} hitSlop={8} style={styles.forgotLink}>
            <Text style={styles.forgotText}>{t("pw.forgot")}</Text>
          </Pressable>
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

        <Pressable onPress={() => navigation.navigate("Register")} hitSlop={8} style={styles.signUpLink}>
          <Text style={styles.signUpText}>{t("auth.signUpLink")}</Text>
        </Pressable>
      </ScrollView>

      {/* Forgot-password modal */}
      <Modal
        visible={resetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!resetSending) setResetOpen(false); }}
      >
        <KeyboardAvoidingView
          style={styles.mBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.mSheet}>
            <View style={styles.mHeader}>
              <View style={styles.mIconWrap}>
                <Icon name="key-outline" size={20} color={theme.colors.brand} />
              </View>
              <Text style={styles.mTitle}>{t("pw.resetTitle")}</Text>
              <Pressable onPress={() => { if (!resetSending) setResetOpen(false); }} hitSlop={10} disabled={resetSending}>
                <Icon name="close" size={22} color={theme.colors.textMuted} />
              </Pressable>
            </View>

            <Text style={styles.mBody}>{t("pw.resetBody")}</Text>

            <Text style={styles.mLabel}>{t("auth.email")}</Text>
            <View style={styles.inputWrap}>
              <Icon name="mail-outline" size={16} color={theme.colors.textLight} style={styles.inputIcon} />
              <TextInput
                value={resetEmail}
                onChangeText={setResetEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                editable={!resetSending}
                placeholderTextColor={theme.colors.textLight}
                style={styles.input}
                placeholder="inspector@xportacar.com"
              />
            </View>

            <Pressable
              onPress={sendReset}
              disabled={resetSending}
              style={({ pressed }) => [styles.mPrimaryBtn, resetSending && { opacity: 0.6 }, pressed && { opacity: 0.9 }]}
            >
              {resetSending && <ActivityIndicator size="small" color={theme.colors.white} />}
              <Text style={styles.mPrimaryText}>{t("pw.sendLink")}</Text>
            </Pressable>

            <Pressable
              onPress={() => { if (!resetSending) setResetOpen(false); }}
              disabled={resetSending}
              style={({ pressed }) => [styles.mCancelBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.mCancelText}>{t("pw.cancel")}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  signUpLink: { alignSelf: "center", marginTop: 12, paddingVertical: 4 },
  signUpText: { fontSize: 14, fontWeight: "800", color: theme.colors.brand, textAlign: "center" },

  // Forgot-password link (under the password field)
  forgotLink: { alignSelf: "flex-end", marginTop: 8, paddingVertical: 2 },
  forgotText: { fontSize: 12, fontWeight: "800", color: theme.colors.brand },

  // Forgot-password modal
  mBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  mSheet: { backgroundColor: theme.colors.white, borderRadius: 20, padding: 20, gap: 12 },
  mHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  mIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.brandLight, alignItems: "center", justifyContent: "center" },
  mTitle: { flex: 1, fontSize: 17, fontWeight: "800", color: theme.colors.text },
  mBody: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 19 },
  mLabel: { fontSize: 11, fontWeight: "800", color: theme.colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  mPrimaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 48, borderRadius: theme.radius.lg, backgroundColor: theme.colors.brand, marginTop: 4,
  },
  mPrimaryText: { color: theme.colors.white, fontWeight: "800", fontSize: 15 },
  mCancelBtn: { height: 44, alignItems: "center", justifyContent: "center" },
  mCancelText: { color: theme.colors.textMuted, fontWeight: "800", fontSize: 14 },
});
