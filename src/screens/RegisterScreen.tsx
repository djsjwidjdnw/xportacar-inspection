import { useState } from "react";
import {
  Alert, Image, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import Constants from "expo-constants";
import { Icon } from "../components/Icon";
import { KeyboardAwareScroll } from "../components/KeyboardAwareScroll";

import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { useTranslation } from "../lib/i18n";

// Web origin for the admin notification webhook. Ships inside the OTA manifest
// (expo.extra), so it stays OTA-updatable without a native rebuild.
const WEB_URL =
  (Constants.expoConfig?.extra as { webUrl?: string } | undefined)?.webUrl ??
  "https://xportacar.com";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function RegisterScreen({
  navigation,
}: {
  navigation: { navigate: (s: string) => void; goBack: () => void };
}) {
  const { t } = useTranslation();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [experience, setExperience] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [confirmStandards, setConfirmStandards] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const pickPhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t("submit.cameraOff"), t("submit.cameraOffBody"));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsEditing: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setPhotoUri(result.assets[0].uri);
    } catch {
      /* best-effort — never block signup on the optional photo */
    }
  };

  const submit = async () => {
    if (loading) return;

    // a. Client-side validation.
    if (!fullName.trim() || !email.trim() || !password) {
      Alert.alert(t("isignup.errMissing"));
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      Alert.alert(t("isignup.errEmail"));
      return;
    }
    if (password.length < 8) {
      Alert.alert(t("isignup.errPwd"));
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert(t("isignup.errMatch"));
      return;
    }
    if (confirmStandards !== true) {
      Alert.alert(t("isignup.errConfirm"));
      return;
    }

    setLoading(true);

    // b. Create the auth user.
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName, country, role: "inspector" } },
    });
    if (error) {
      Alert.alert(t("isignup.failed"), error.message);
      setLoading(false);
      return;
    }

    if (data.user) {
      // c. Upsert the profile row (inspector, pending KYC).
      try {
        await supabase.from("profiles").upsert(
          {
            id: data.user.id,
            email: email.trim(),
            full_name: fullName,
            country: country || null,
            phone: phone || null,
            role: "inspector",
            kyc_status: "pending",
          },
          { onConflict: "id" },
        );
      } catch {
        /* best-effort — RLS or transient failures must not block signup */
      }

      // d. Optional ID photo upload (best-effort, never blocks).
      let idPhotoPath: string | null = null;
      if (photoUri) {
        try {
          // Read raw bytes — RN blobs from fetch can be 0-byte, so go via
          // arrayBuffer → Uint8Array which uploads reliably.
          const bytes = new Uint8Array(await (await fetch(photoUri)).arrayBuffer());
          const key = `${data.user.id}/idphoto-${Date.now()}.jpg`;
          await supabase.storage
            .from("inspector-docs")
            .upload(key, bytes, { contentType: "image/jpeg", upsert: false });
          idPhotoPath = key;
        } catch {
          idPhotoPath = null;
        }
      }

      // e. Record the inspector application (best-effort).
      try {
        await supabase.from("inspector_applications").insert({
          user_id: data.user.id,
          full_name: fullName,
          email: email.trim(),
          phone: phone || null,
          country: country || null,
          city: city || null,
          experience: experience || null,
          id_photo_path: idPhotoPath,
          confirmed_standards: true,
          status: "approved",
        });
      } catch {
        /* best-effort */
      }

      // f. Notify the web/admin side (best-effort, never blocks).
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          await fetch(`${WEB_URL}/api/notify/signup`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: "{}",
          });
        }
      } catch {
        /* best-effort */
      }
    }

    // g. Done. If a session exists the RootNavigator switches to the dashboard
    // automatically (user becomes set). Otherwise email confirmation is on.
    setLoading(false);
    if (!data.session) {
      Alert.alert("Check your email", "Confirm your email to finish signing up.");
      navigation.goBack();
    }
  };

  return (
    <KeyboardAwareScroll contentContainerStyle={styles.container}>
      <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backRow}>
        <Icon name="chevron-forward" size={16} color={theme.colors.brand} style={styles.backIcon} />
        <Text style={styles.backText}>{t("isignup.haveAccount")}</Text>
      </Pressable>

      <View style={styles.logoWrap}>
        <Image source={require("../../assets/logo.jpg")} style={styles.logo} resizeMode="contain" />
      </View>

      <Text style={styles.tagline}>{t("auth.portal")}</Text>
      <Text style={styles.title}>{t("isignup.title")}</Text>
      <Text style={styles.subtitle}>{t("isignup.subtitle")}</Text>

      <View style={styles.field}>
        <Text style={styles.label}>{t("isignup.fullName")}</Text>
        <View style={styles.inputWrap}>
          <Icon name="create-outline" size={16} color={theme.colors.textLight} style={styles.inputIcon} />
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            placeholderTextColor={theme.colors.textLight}
            style={styles.input}
            placeholder="Klaus Weber"
          />
        </View>
      </View>

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
            autoComplete="password-new"
            placeholderTextColor={theme.colors.textLight}
            style={styles.input}
            placeholder="••••••••"
          />
          <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8} style={styles.eyeBtn}>
            <Icon name={showPw ? "eye-off-outline" : "eye-outline"} size={18} color={theme.colors.textLight} />
          </Pressable>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("isignup.confirm")}</Text>
        <View style={styles.inputWrap}>
          <Icon name="lock-closed-outline" size={16} color={theme.colors.textLight} style={styles.inputIcon} />
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showPw}
            autoComplete="password-new"
            placeholderTextColor={theme.colors.textLight}
            style={styles.input}
            placeholder="••••••••"
          />
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("isignup.phone")} {t("isignup.optional")}</Text>
        <View style={styles.inputWrap}>
          <Icon name="document-text-outline" size={16} color={theme.colors.textLight} style={styles.inputIcon} />
          <TextInput
            value={phone}
            onChangeText={setPhone}
            autoCapitalize="none"
            keyboardType="phone-pad"
            placeholderTextColor={theme.colors.textLight}
            style={styles.input}
            placeholder="+971 50 123 4567"
          />
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("isignup.country")} {t("isignup.optional")}</Text>
        <View style={styles.inputWrap}>
          <Icon name="globe-outline" size={16} color={theme.colors.textLight} style={styles.inputIcon} />
          <TextInput
            value={country}
            onChangeText={setCountry}
            autoCapitalize="words"
            placeholderTextColor={theme.colors.textLight}
            style={styles.input}
            placeholder="United Arab Emirates"
          />
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("details.city")} {t("isignup.optional")}</Text>
        <View style={styles.inputWrap}>
          <Icon name="globe-outline" size={16} color={theme.colors.textLight} style={styles.inputIcon} />
          <TextInput
            value={city}
            onChangeText={setCity}
            autoCapitalize="words"
            placeholderTextColor={theme.colors.textLight}
            style={styles.input}
            placeholder="Dubai"
          />
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("isignup.experience")}</Text>
        <TextInput
          value={experience}
          onChangeText={setExperience}
          multiline
          maxLength={500}
          placeholder={t("isignup.experiencePh")}
          placeholderTextColor={theme.colors.textLight}
          style={[styles.input, styles.textArea]}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("isignup.photo")}</Text>
        <Pressable onPress={pickPhoto} style={({ pressed }) => [styles.photoBtn, pressed && { opacity: 0.92 }]}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
          ) : (
            <>
              <Icon name="cloud-upload-outline" size={20} color={theme.colors.brand} />
              <Text style={styles.photoBtnText}>{t("isignup.photoAdd")}</Text>
            </>
          )}
        </Pressable>
        {photoUri ? (
          <Pressable onPress={pickPhoto} hitSlop={8} style={styles.photoChange}>
            <Text style={styles.photoChangeText}>{t("isignup.photoChange")}</Text>
          </Pressable>
        ) : null}
      </View>

      <Pressable
        onPress={() => setConfirmStandards((v) => !v)}
        style={({ pressed }) => [styles.checkRow, pressed && { opacity: 0.85 }]}
      >
        <View style={[styles.checkbox, confirmStandards && styles.checkboxOn]}>
          {confirmStandards ? <Icon name="checkmark" size={14} color={theme.colors.white} /> : null}
        </View>
        <Text style={styles.checkText}>{t("isignup.confirmStandards")}</Text>
      </Pressable>

      <Pressable
        onPress={submit}
        disabled={loading}
        style={({ pressed }) => [styles.btnShadow, pressed && { opacity: 0.92 }]}
      >
        <LinearGradient
          colors={[theme.colors.brand, theme.colors.brandDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.btn}
        >
          <Icon name="log-in-outline" size={18} color={theme.colors.white} />
          <Text style={styles.btnText}>{loading ? t("isignup.creating") : t("isignup.submit")}</Text>
        </LinearGradient>
      </Pressable>
    </KeyboardAwareScroll>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: Platform.OS === "ios" ? 56 : 40, paddingBottom: 48, backgroundColor: theme.colors.bg },
  backRow:   { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  backIcon:  { transform: [{ rotate: "180deg" }] },
  backText:  { color: theme.colors.brand, fontSize: 13, fontWeight: "800", marginLeft: 4 },
  logoWrap:  { alignItems: "center", marginBottom: 16 },
  logo:      { width: 160, height: 80 },
  tagline:   { fontSize: 11, fontWeight: "800", color: theme.colors.brand, letterSpacing: 1.5, textAlign: "center", textTransform: "uppercase" },
  title:     { fontSize: 26, fontWeight: "800", color: theme.colors.text, textAlign: "center", marginTop: 6 },
  subtitle:  { color: theme.colors.textMuted, fontSize: 13, textAlign: "center", marginTop: 8, marginBottom: 28, lineHeight: 20, paddingHorizontal: 8 },
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
  textArea:  {
    height: 96, borderRadius: theme.radius.lg, borderWidth: 1,
    borderColor: theme.colors.border, backgroundColor: theme.colors.white,
    paddingHorizontal: 14, paddingTop: 12, textAlignVertical: "top",
  },
  eyeBtn:    { padding: 4 },
  photoBtn: {
    height: 96, borderRadius: theme.radius.lg, borderWidth: 1, borderStyle: "dashed",
    borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.white,
    alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8,
    overflow: "hidden",
  },
  photoBtnText: { color: theme.colors.brand, fontSize: 14, fontWeight: "800" },
  photoPreview: { width: "100%", height: "100%" },
  photoChange:  { alignSelf: "center", marginTop: 8 },
  photoChangeText: { color: theme.colors.brand, fontSize: 12, fontWeight: "800" },
  checkRow:  { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 6, marginBottom: 8 },
  checkbox:  {
    width: 22, height: 22, borderRadius: theme.radius.sm, borderWidth: 1.5,
    borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.white,
    alignItems: "center", justifyContent: "center", marginTop: 1,
  },
  checkboxOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  checkText: { flex: 1, fontSize: 13, color: theme.colors.textMuted, lineHeight: 19 },
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
  foot:      { fontSize: 12, color: theme.colors.textLight, textAlign: "center", marginTop: 20 },
});
