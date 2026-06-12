import { useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Icon } from "../components/Icon";

import { Spinner } from "../components/Spinner";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { notify } from "../lib/ui";
import { useTranslation, SUPPORTED, LANG_LABELS, type Locale } from "../lib/i18n";
import type { ProfileRow } from "../lib/types";

// The inspector Profile tab. Identity header + editable name/company/country/
// phone, plus the account actions that used to live in the Dashboard hero
// (change password, language, sign out, delete account). Mirrors the buyer
// ProfileScreen but uses the inspector's web-safe SVG Icon set and the
// inspector profiles columns (full_name, not first/last).
export function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { t, locale, setLocale, switchingLocale } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [fullName, setFullName] = useState("");
  const [company, setCompany]   = useState("");
  const [country, setCountry]   = useState("");
  const [phone, setPhone]       = useState("");
  const [saving, setSaving] = useState(false);

  // Delete-account modal (lifted from the Dashboard hero).
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Change-password modal (lifted from the Dashboard hero).
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwShowCurrent, setPwShowCurrent] = useState(false);
  const [pwShowNew, setPwShowNew] = useState(false);
  const [pwShowConfirm, setPwShowConfirm] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let active = true;
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (!active) return;
      const p = data as ProfileRow | null;
      setProfile(p);
      setFullName(p?.full_name ?? "");
      setCompany(p?.company_name ?? "");
      setCountry(p?.country ?? "");
      setPhone(p?.phone ?? "");
      setLoading(false);
    })();
    return () => { active = false; };
  }, [user]);

  const save = async () => {
    if (!user || saving) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim() || null, company_name: company.trim() || null, country: country.trim() || null, phone: phone.trim() || null })
      .eq("id", user.id);
    setSaving(false);
    notify(t("profile.section"), error ? t("pw.changeFailed") : t("profile.saved"));
  };

  const openChangePw = () => {
    setPwCurrent(""); setPwNew(""); setPwConfirm("");
    setPwShowCurrent(false); setPwShowNew(false); setPwShowConfirm(false);
    setPwOpen(true);
  };

  // Re-verify the current password (Supabase has no verify call → sign in
  // again with it), then update to the new one.
  const changePassword = async () => {
    if (pwSaving) return;
    if (pwNew.length < 8) { notify(t("pw.change"), t("pw.tooShort")); return; }
    if (pwNew !== pwConfirm) { notify(t("pw.change"), t("pw.noMatch")); return; }
    const email = user?.email;
    if (!email) { notify(t("pw.change"), t("pw.changeFailed")); return; }
    setPwSaving(true);
    try {
      const { error: verifyErr } = await supabase.auth.signInWithPassword({ email, password: pwCurrent });
      if (verifyErr) { notify(t("pw.change"), t("pw.currentWrong")); return; }
      const { error: updateErr } = await supabase.auth.updateUser({ password: pwNew });
      if (updateErr) { notify(t("pw.change"), t("pw.changeFailed")); return; }
      setPwOpen(false);
      notify(t("pw.change"), t("pw.changed"));
    } catch {
      notify(t("pw.change"), t("pw.changeFailed"));
    } finally {
      setPwSaving(false);
    }
  };

  // Permanently delete this inspector's account via the shared edge function,
  // then sign out. The confirmation word stays "DELETE" in every language.
  const deleteAccount = async () => {
    if (deleteConfirm !== "DELETE" || deleting) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-my-account", { body: {} });
      if (error || (data as { ok?: boolean } | null)?.ok === false) {
        notify(t("deleteAccount.title"), t("deleteAccount.failed"));
        return;
      }
      await signOut();
    } catch {
      notify(t("deleteAccount.title"), t("deleteAccount.failed"));
    } finally {
      setDeleting(false);
    }
  };

  if (!user) {
    return (
      <View style={styles.center}><Text style={styles.muted}>{t("profile.signin")}</Text></View>
    );
  }
  if (loading) return <Spinner label={t("dash.loading")} />;

  const displayName = fullName.trim() || (user.email?.split("@")[0] ?? "Inspector");
  const inits = makeInitials(fullName, user.email);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Identity card */}
        <LinearGradient
          colors={["#101828", theme.colors.brand]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.identityCard}
        >
          <View style={styles.avatarRow}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{inits}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.email} numberOfLines={1}>{user.email}</Text>
            </View>
          </View>
          <View style={styles.tagRow}>
            <View style={styles.roleTag}>
              <Icon name="person-outline" size={12} color={theme.colors.white} />
              <Text style={styles.roleTagText}>{profile?.role ?? "inspector"}</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Personal info */}
        <SectionHeader icon="create-outline" label={t("profile.section")} />
        <View style={styles.card}>
          <Field label={t("auth.fullName")}><TextInput value={fullName} onChangeText={setFullName} style={styles.input} placeholder="Ahmed Al Rashid" placeholderTextColor={theme.colors.textLight} /></Field>
          <Field label={t("auth.company")}><TextInput value={company} onChangeText={setCompany} style={styles.input} placeholder="XportACar" placeholderTextColor={theme.colors.textLight} /></Field>
          <Field label={t("auth.country")}><TextInput value={country} onChangeText={setCountry} style={styles.input} placeholder="UAE" placeholderTextColor={theme.colors.textLight} /></Field>
          <Field label={t("profile.phone")}><TextInput value={phone} onChangeText={setPhone} style={styles.input} keyboardType="phone-pad" placeholder="+971 50 …" placeholderTextColor={theme.colors.textLight} /></Field>
          <Pressable onPress={save} disabled={saving} style={({ pressed }) => [styles.saveBtnShadow, pressed && { opacity: 0.92 }]}>
            <LinearGradient
              colors={[theme.colors.brand, theme.colors.brandDark]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.saveBtn}
            >
              {saving && <ActivityIndicator size="small" color={theme.colors.white} />}
              <Icon name="checkmark" size={16} color={theme.colors.white} />
              <Text style={styles.saveBtnText}>{saving ? t("profile.saving") : t("profile.save")}</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {/* Security */}
        <SectionHeader icon="lock-closed-outline" label={t("profile.security")} />
        <Pressable onPress={openChangePw} style={({ pressed }) => [styles.rowBtn, pressed && { opacity: 0.92 }]}>
          <Icon name="key-outline" size={18} color={theme.colors.brand} />
          <Text style={styles.rowBtnText}>{t("pw.change")}</Text>
          <Icon name="chevron-forward" size={16} color={theme.colors.textLight} />
        </Pressable>

        {/* Preferences — language picker */}
        <SectionHeader icon="globe-outline" label={t("profile.language")} />
        <View style={styles.langCard}>
          {SUPPORTED.map((code: Locale) => {
            const info = LANG_LABELS[code];
            const active = locale === code;
            return (
              <Pressable
                key={code}
                onPress={() => void setLocale(code)}
                disabled={switchingLocale}
                style={({ pressed }) => [styles.langBtn, active && styles.langBtnActive, (pressed || switchingLocale) && { opacity: 0.92 }]}
                accessibilityRole="button"
                accessibilityLabel={info.label}
              >
                <Text style={styles.langFlag}>{info.flag}</Text>
                <Text style={[styles.langLabel, active && { color: theme.colors.brand }]}>{info.label}</Text>
                {active && <Icon name="checkmark-circle" size={16} color={theme.colors.brand} />}
              </Pressable>
            );
          })}
        </View>

        {/* Account — sign out + delete */}
        <SectionHeader icon="person-outline" label={t("profile.account")} />
        <Pressable onPress={() => void signOut()} style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.92 }]}>
          <Icon name="log-out-outline" size={18} color={theme.colors.error} />
          <Text style={styles.signOutText}>{t("nav.signOut")}</Text>
        </Pressable>
        <Pressable
          onPress={() => { setDeleteConfirm(""); setDeleteOpen(true); }}
          style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
        >
          <Icon name="trash-outline" size={16} color={theme.colors.error} />
          <Text style={styles.deleteBtnText}>{t("deleteAccount.button")}</Text>
        </Pressable>

        <Text style={styles.versionText}>XportACar Inspector · v1.0.0</Text>
      </ScrollView>

      {/* Delete account confirmation modal */}
      <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => { if (!deleting) setDeleteOpen(false); }}>
        <KeyboardAvoidingView style={styles.delBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.delSheet}>
            <View style={styles.delHeader}>
              <View style={styles.delIconWrap}>
                <Icon name="warning-outline" size={22} color={theme.colors.error} />
              </View>
              <Text style={styles.delTitle}>{t("deleteAccount.title")}</Text>
              <Pressable onPress={() => { if (!deleting) setDeleteOpen(false); }} hitSlop={10} disabled={deleting}>
                <Icon name="close" size={22} color={theme.colors.textMuted} />
              </Pressable>
            </View>

            <Text style={styles.delWarning}>{t("deleteAccount.warning")}</Text>
            <Text style={styles.delLoseIntro}>{t("deleteAccount.loseIntro")}</Text>
            <Bullet>{t("deleteAccount.loseBids")}</Bullet>
            <Bullet>{t("deleteAccount.loseInspections")}</Bullet>
            <Bullet>{t("deleteAccount.loseInvoices")}</Bullet>
            <Text style={styles.delCannotUndo}>{t("deleteAccount.cannotUndo")}</Text>

            <Text style={styles.delInputLabel}>{t("deleteAccount.typeToConfirm")}</Text>
            <TextInput
              value={deleteConfirm}
              onChangeText={setDeleteConfirm}
              placeholder="DELETE"
              placeholderTextColor={theme.colors.textLight}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleting}
              style={styles.delInput}
            />

            <Pressable
              onPress={deleteAccount}
              disabled={deleteConfirm !== "DELETE" || deleting}
              style={({ pressed }) => [styles.delConfirmBtn, (deleteConfirm !== "DELETE" || deleting) && { opacity: 0.5 }, pressed && { opacity: 0.9 }]}
            >
              {deleting && <ActivityIndicator size="small" color={theme.colors.white} />}
              <Text style={styles.delConfirmText}>{deleting ? t("deleteAccount.deleting") : t("deleteAccount.confirm")}</Text>
            </Pressable>
            <Pressable onPress={() => { if (!deleting) setDeleteOpen(false); }} disabled={deleting} style={({ pressed }) => [styles.delCancelBtn, pressed && { opacity: 0.7 }]}>
              <Text style={styles.delCancelText}>{t("deleteAccount.cancel")}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Change password modal */}
      <Modal visible={pwOpen} transparent animationType="fade" onRequestClose={() => { if (!pwSaving) setPwOpen(false); }}>
        <KeyboardAvoidingView style={styles.delBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.delSheet}>
            <View style={styles.delHeader}>
              <View style={styles.pwIconWrap}>
                <Icon name="key-outline" size={20} color={theme.colors.brand} />
              </View>
              <Text style={styles.delTitle}>{t("pw.change")}</Text>
              <Pressable onPress={() => { if (!pwSaving) setPwOpen(false); }} hitSlop={10} disabled={pwSaving}>
                <Icon name="close" size={22} color={theme.colors.textMuted} />
              </Pressable>
            </View>

            <PwField label={t("pw.current")} value={pwCurrent} onChangeText={setPwCurrent} show={pwShowCurrent} onToggleShow={() => setPwShowCurrent((v) => !v)} editable={!pwSaving} />
            <PwField label={t("pw.new")} value={pwNew} onChangeText={setPwNew} show={pwShowNew} onToggleShow={() => setPwShowNew((v) => !v)} editable={!pwSaving} />
            <Text style={styles.pwHint}>{t("pw.min8")}</Text>
            <PwField label={t("pw.confirm")} value={pwConfirm} onChangeText={setPwConfirm} show={pwShowConfirm} onToggleShow={() => setPwShowConfirm((v) => !v)} editable={!pwSaving} />

            <Pressable onPress={changePassword} disabled={pwSaving} style={({ pressed }) => [styles.pwSaveBtn, pwSaving && { opacity: 0.6 }, pressed && { opacity: 0.9 }]}>
              {pwSaving && <ActivityIndicator size="small" color={theme.colors.white} />}
              <Text style={styles.pwSaveText}>{t("pw.save")}</Text>
            </Pressable>
            <Pressable onPress={() => { if (!pwSaving) setPwOpen(false); }} disabled={pwSaving} style={({ pressed }) => [styles.delCancelBtn, pressed && { opacity: 0.7 }]}>
              <Text style={styles.delCancelText}>{t("pw.cancel")}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function SectionHeader({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Icon name={icon} size={14} color={theme.colors.textLight} />
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.delBullet}>
      <View style={styles.delBulletDot} />
      <Text style={styles.delBulletText}>{children}</Text>
    </View>
  );
}

// Labelled password input with a show/hide eye — used three times.
function PwField({
  label, value, onChangeText, show, onToggleShow, editable,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  show: boolean; onToggleShow: () => void; editable: boolean;
}) {
  return (
    <View>
      <Text style={styles.pwLabel}>{label}</Text>
      <View style={styles.pwInputWrap}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          editable={editable}
          placeholderTextColor={theme.colors.textLight}
          style={styles.pwInput}
          placeholder="••••••••"
        />
        <Pressable onPress={onToggleShow} hitSlop={8} style={styles.pwEyeBtn}>
          <Icon name={show ? "eye-off-outline" : "eye-outline"} size={18} color={theme.colors.textLight} />
        </Pressable>
      </View>
    </View>
  );
}

function makeInitials(name?: string | null, email?: string | null): string {
  const source = (name && name.trim()) || (email && email.split("@")[0]) || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  muted: { color: theme.colors.textLight, textAlign: "center" },

  // Identity card
  identityCard: {
    margin: 16, padding: 20, borderRadius: 20,
    shadowColor: theme.colors.brand, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
  avatarCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "rgba(255,255,255,0.25)",
  },
  avatarText: { color: theme.colors.white, fontSize: 22, fontWeight: "800", letterSpacing: 0.5 },
  name:  { color: theme.colors.white, fontSize: 18, fontWeight: "800" },
  email: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  roleTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.full, backgroundColor: "rgba(255,255,255,0.18)" },
  roleTagText: { fontSize: 11, fontWeight: "800", color: theme.colors.white, textTransform: "capitalize" },

  // Section headers
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 10 },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: theme.colors.textLight, textTransform: "uppercase", letterSpacing: 0.6 },

  // Card
  card: {
    marginHorizontal: 16,
    backgroundColor: theme.colors.white,
    borderRadius: theme.radius.xl, padding: 16,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  fieldLabel: { fontSize: 11, fontWeight: "800", color: theme.colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  input: { height: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 14, color: theme.colors.text, fontSize: 14, backgroundColor: theme.colors.white },
  saveBtnShadow: { marginTop: 8, borderRadius: theme.radius.lg, shadowColor: theme.colors.brand, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  saveBtn: { height: 48, borderRadius: theme.radius.lg, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  saveBtnText: { color: theme.colors.white, fontWeight: "800", fontSize: 14 },

  // Single-row button (change password)
  rowBtn: {
    marginHorizontal: 16,
    flexDirection: "row", alignItems: "center", gap: 10,
    height: 52, borderRadius: theme.radius.lg, paddingHorizontal: 16,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white,
  },
  rowBtnText: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: "800" },

  // Language card
  langCard: {
    marginHorizontal: 16,
    backgroundColor: theme.colors.white, borderRadius: theme.radius.xl, padding: 8,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  langBtn: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: theme.radius.md },
  langBtnActive: { backgroundColor: theme.colors.brandLight },
  langFlag: { fontSize: 20 },
  langLabel: { flex: 1, fontSize: 14, fontWeight: "700", color: theme.colors.text },

  // Sign out (destructive, outlined red)
  signOutBtn: {
    marginHorizontal: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 50, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: "#fda29b", backgroundColor: theme.colors.errorBg,
  },
  signOutText: { color: theme.colors.error, fontSize: 14, fontWeight: "800" },

  // Delete account (text-style destructive link)
  deleteBtn: { marginHorizontal: 16, marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44 },
  deleteBtnText: { color: theme.colors.error, fontSize: 13, fontWeight: "800" },

  versionText: { textAlign: "center", marginTop: 18, fontSize: 11, color: theme.colors.textLight, fontWeight: "600" },

  // Change-password modal extras
  pwIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.brandLight, alignItems: "center", justifyContent: "center" },
  pwLabel: { fontSize: 11, fontWeight: "800", color: theme.colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  pwInputWrap: {
    flexDirection: "row", alignItems: "center",
    height: 48, borderRadius: theme.radius.md, borderWidth: 1,
    borderColor: theme.colors.border, backgroundColor: theme.colors.white, paddingHorizontal: 14,
  },
  pwInput: { flex: 1, fontSize: 15, color: theme.colors.text },
  pwEyeBtn: { padding: 4 },
  pwHint: { fontSize: 11, color: theme.colors.textLight, fontWeight: "600", marginTop: -4 },
  pwSaveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 48, borderRadius: theme.radius.lg, backgroundColor: theme.colors.brand, marginTop: 4,
  },
  pwSaveText: { color: theme.colors.white, fontWeight: "800", fontSize: 15 },

  // Delete-account modal
  delBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  delSheet: { backgroundColor: theme.colors.white, borderRadius: 20, padding: 20, gap: 12 },
  delHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  delIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.errorBg, alignItems: "center", justifyContent: "center" },
  delTitle: { flex: 1, fontSize: 17, fontWeight: "800", color: theme.colors.text },
  delWarning: { fontSize: 13, color: theme.colors.textMuted, lineHeight: 19 },
  delLoseIntro: { fontSize: 13, fontWeight: "800", color: theme.colors.text, marginTop: 2 },
  delBullet: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 4 },
  delBulletDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.colors.textMuted },
  delBulletText: { flex: 1, fontSize: 13, color: theme.colors.textMuted },
  delCannotUndo: { fontSize: 13, fontWeight: "800", color: theme.colors.error, marginTop: 4 },
  delInputLabel: { fontSize: 11, fontWeight: "800", color: theme.colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  delInput: { height: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 14, color: theme.colors.text, fontSize: 14, backgroundColor: theme.colors.white },
  delConfirmBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 48, borderRadius: theme.radius.lg, backgroundColor: theme.colors.error, marginTop: 4,
  },
  delConfirmText: { color: theme.colors.white, fontWeight: "800", fontSize: 15 },
  delCancelBtn: { height: 44, alignItems: "center", justifyContent: "center" },
  delCancelText: { color: theme.colors.textMuted, fontWeight: "800", fontSize: 14 },
});
