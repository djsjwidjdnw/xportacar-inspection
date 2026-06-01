import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Icon } from "../components/Icon";
import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Button } from "../components/Button";
import { Spinner } from "../components/Spinner";
import { EmptyState } from "../components/EmptyState";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { theme, formatKm } from "../lib/theme";
import { confirmAsync, notify } from "../lib/ui";
import { useTranslation, SUPPORTED, LANG_LABELS, type Locale } from "../lib/i18n";
import type { VehicleRow } from "../lib/types";

type TFunc = (key: string, values?: Record<string, string | number>) => string;
import {
  INSPECTION_AUTOSAVE_PREFIX, type AutosavePayload,
} from "./InspectionWizardScreen";

interface DraftRow {
  key: string;            // AsyncStorage key
  vehicleId: string | null; // null = the __new__ slot
  summary: string;        // "2023 BMW X5" or "Untitled draft"
  step: number;
  ts: number;
}

interface AssignedVehicle extends VehicleRow {
  inspector_id: string | null;
  inspection_date: string | null;
}
interface CompletedVehicle extends AssignedVehicle {
  photo_count: number;
}

type Section = { section: "drafts" } | { section: "changes" } | { section: "assigned" } | { section: "completed" };

export function DashboardScreen({ navigation }: { navigation: { navigate: (s: string, p?: object) => void } }) {
  const { user, signOut } = useAuth();
  const { t, locale, setLocale, switchingLocale } = useTranslation();
  const [assigned, setAssigned] = useState<AssignedVehicle[]>([]);
  const [changesRequested, setChangesRequested] = useState<AssignedVehicle[]>([]);
  const [completed, setCompleted] = useState<CompletedVehicle[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Pull every saved draft out of AsyncStorage. We scan all keys with
  // the `xpc_inspection_draft:` prefix, parse them, and surface them
  // sorted newest-first.
  const loadDrafts = useCallback(async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const draftKeys = keys.filter((k) => k.startsWith(INSPECTION_AUTOSAVE_PREFIX));
      if (draftKeys.length === 0) { setDrafts([]); return; }
      const pairs = await AsyncStorage.multiGet(draftKeys);
      const rows: DraftRow[] = [];
      for (const [key, raw] of pairs) {
        if (!raw) continue;
        try {
          const data = JSON.parse(raw) as AutosavePayload;
          if (data.v !== 1) continue;
          // Only show drafts from this inspector (or pre-auth drafts).
          if (data.inspectorId && user?.id && data.inspectorId !== user.id) continue;
          // Skip empty drafts so a stale __new__ key doesn't appear.
          if (!data.vin && !data.make && !data.model) continue;
          rows.push({
            key,
            vehicleId: data.vehicleId,
            summary: data.vehicleSummary
              ?? (data.year && data.make && data.model ? `${data.year} ${data.make} ${data.model}` : t("dash.untitledDraft")),
            step: data.step,
            ts: data.ts,
          });
        } catch { /* corrupt — skip */ }
      }
      rows.sort((a, b) => b.ts - a.ts);
      setDrafts(rows);
    } catch { setDrafts([]); }
  }, [user]);

  const discardDraft = async (key: string) => {
    await AsyncStorage.removeItem(key);
    await loadDrafts();
  };

  // Delete a draft with a (web-safe) confirm. "This cannot be undone."
  const deleteDraft = async (key: string) => {
    const ok = await confirmAsync(t("dash.deleteDraftQ"), t("dash.deleteDraftBody"), t("common.delete"), true);
    if (ok) await discardDraft(key);
  };

  // Submit an already-inspected vehicle to the admin team for review/listing.
  const submitForListing = async (vehicleId: string, summary: string) => {
    const ok = await confirmAsync(t("dash.submitQ"), t("dash.submitBody", { summary }), t("common.submit"));
    if (!ok) return;
    const { error } = await supabase.from("vehicles").update({ status: "pending_review" }).eq("id", vehicleId);
    if (error) { notify(t("dash.submitErr"), error.message); return; }
    // Best-effort: notify the admins that a vehicle is ready for review.
    try {
      const { data: admins } = await supabase.from("profiles").select("id").in("role", ["admin", "superadmin"]);
      const rows = (admins ?? []) as { id: string }[];
      if (rows.length) {
        await supabase.from("notifications").insert(rows.map((a) => ({
          user_id: a.id, type: "status_update",
          title: "Vehicle ready for listing", body: `${summary} was submitted for listing.`,
          data: { vehicle_id: vehicleId },
        })));
      }
    } catch { /* notifications are best-effort */ }
    notify(t("dash.submitOk"), t("dash.submitOkBody"));
    await load();
  };

  const load = useCallback(async () => {
    if (!user) return;

    // Vehicles assigned to me, awaiting inspection.
    const { data: pending } = await supabase
      .from("vehicles")
      .select("*")
      .eq("inspector_id", user.id)
      .in("status", ["inspection_scheduled", "draft"])
      .order("created_at", { ascending: false });

    // Vehicles the admin sent back with change requests.
    const { data: changes } = await supabase
      .from("vehicles")
      .select("*")
      .eq("inspector_id", user.id)
      .eq("status", "changes_requested")
      .order("updated_at", { ascending: false });

    // Vehicles I've already inspected/submitted — pull photo count alongside
    // via the PostgREST aggregate (`vehicle_photos(count)`).
    const { data: done } = await supabase
      .from("vehicles")
      .select("*, vehicle_photos(count)")
      .eq("inspector_id", user.id)
      .in("status", ["inspected", "pending_review", "listed", "in_auction", "sold"])
      .order("inspection_date", { ascending: false })
      .limit(20);

    setAssigned((pending as AssignedVehicle[]) ?? []);
    setChangesRequested((changes as AssignedVehicle[]) ?? []);
    setCompleted(((done ?? []) as (AssignedVehicle & { vehicle_photos: { count: number }[] })[]).map((v) => ({
      ...v,
      photo_count: Array.isArray(v.vehicle_photos) ? (v.vehicle_photos[0]?.count ?? 0) : 0,
    })));

    await loadDrafts();
  }, [user, loadDrafts]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  // Refresh drafts every time the dashboard regains focus — the wizard
  // writes the autosave key on every keystroke, so coming back here
  // should always show the freshest state.
  useFocusEffect(useCallback(() => { void loadDrafts(); }, [loadDrafts]));

  // Drafts + changes-requested sections only appear when they have content.
  const sections: Section[] = [
    ...(drafts.length > 0 ? [{ section: "drafts" as const }] : []),
    ...(changesRequested.length > 0 ? [{ section: "changes" as const }] : []),
    { section: "assigned" as const },
    { section: "completed" as const },
  ];

  if (loading) return <Spinner label={t("dash.loading")} />;

  const formatDate = (iso: string | null | undefined): string =>
    iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <FlatList
        data={sections}
        keyExtractor={(s) => s.section}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={theme.colors.brand}
            colors={[theme.colors.brand]}
          />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ListHeaderComponent={
          <View>
            {/* Hero with stat cards */}
            <LinearGradient
              colors={["#101828", theme.colors.brand]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.hero}
            >
              <View style={styles.heroTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroEyebrow}>{t("dash.portal")}</Text>
                  <Text style={styles.heroTitle}>{t(greetingKey())}</Text>
                  <Text style={styles.heroSub}>{user?.email}</Text>
                </View>
                <Pressable onPress={signOut} hitSlop={8} style={styles.signOutBtn}>
                  <Icon name="log-out-outline" size={18} color={theme.colors.white} />
                </Pressable>
              </View>

              <View style={styles.statsRow}>
                <Stat label={t("dash.assigned")} value={assigned.length} icon="clipboard-outline" />
                <View style={styles.statDivider} />
                <Stat label={t("dash.completed")} value={completed.length} icon="checkmark-done-outline" />
              </View>
            </LinearGradient>

            {/* Language switcher — mirrors the buyer app's flag+label picker.
                The inspector app has no settings screen, so it lives in the
                dashboard header where it's always reachable. */}
            <View style={styles.langRow}>
              <Icon name="globe-outline" size={13} color={theme.colors.textLight} />
              <Text style={styles.langRowLabel}>{t("dash.language")}</Text>
              <View style={{ flex: 1 }} />
              {switchingLocale && (
                <ActivityIndicator size="small" color={theme.colors.brand} style={{ marginRight: 6 }} />
              )}
              <View style={styles.langBtns}>
                {SUPPORTED.map((code: Locale) => {
                  const active = locale === code;
                  return (
                    <Pressable
                      key={code}
                      onPress={() => void setLocale(code)}
                      disabled={switchingLocale}
                      style={({ pressed }) => [styles.langBtn, active && styles.langBtnActive, (pressed || switchingLocale) && { opacity: 0.9 }]}
                      accessibilityRole="button"
                      accessibilityLabel={LANG_LABELS[code].label}
                    >
                      <Text style={styles.langFlag}>{LANG_LABELS[code].flag}</Text>
                      <Text style={[styles.langCode, active && { color: theme.colors.brand }]}>{code.toUpperCase()}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* New inspection CTA */}
            <Pressable
              onPress={() => navigation.navigate("Inspect", { vehicleId: null })}
              style={({ pressed }) => [styles.ctaShadow, pressed && { opacity: 0.92 }]}
            >
              <LinearGradient
                colors={[theme.colors.brand, theme.colors.brandDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cta}
              >
                <View style={styles.ctaIcon}>
                  <Icon name="add-circle-outline" size={22} color={theme.colors.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ctaTitle}>{t("dash.newTitle")}</Text>
                  <Text style={styles.ctaSub}>{t("dash.newSub")}</Text>
                </View>
                <Icon name="chevron-forward" size={20} color={theme.colors.white} />
              </LinearGradient>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ marginBottom: 24 }}>
            <View style={styles.sectionHeader}>
              <Icon
                name={
                  item.section === "drafts"     ? "cloud-outline"
                  : item.section === "changes"  ? "alert-circle-outline"
                  : item.section === "assigned" ? "clipboard-outline"
                  : "checkmark-done-outline"
                }
                size={14}
                color={theme.colors.textLight}
              />
              <Text style={styles.sectionTitle}>
                {item.section === "drafts"     ? t("dash.sectionDrafts")
                  : item.section === "changes"  ? t("dash.sectionChanges")
                  : item.section === "assigned" ? t("dash.sectionAssigned")
                  : t("dash.sectionCompleted")}
              </Text>
              <View style={styles.countPill}>
                <Text style={styles.countPillText}>
                  {item.section === "drafts" ? drafts.length
                    : item.section === "changes" ? changesRequested.length
                    : item.section === "assigned" ? assigned.length
                    : completed.length}
                </Text>
              </View>
            </View>

            {item.section === "drafts" ? (
              drafts.length === 0 ? null /* hide the empty drafts header */ : (
                drafts.map((d) => (
                  <Pressable
                    key={d.key}
                    style={({ pressed }) => [styles.card, pressed && { opacity: 0.96, transform: [{ scale: 0.99 }] }]}
                    onPress={() => navigation.navigate("Inspect", { vehicleId: d.vehicleId })}
                  >
                    <View style={[styles.cardIconWrap, { backgroundColor: theme.colors.warningBg }]}>
                      <Icon name="document-text-outline" size={20} color={theme.colors.warning} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{d.summary}</Text>
                      <View style={styles.cardMeta}>
                        <Meta icon="time-outline">{t("dash.lastEdited", { when: formatRelative(d.ts, t) })}</Meta>
                        <Meta icon="layers-outline">{t("dash.stepN", { n: d.step })}</Meta>
                      </View>
                    </View>
                    <Pressable
                      hitSlop={8}
                      onPress={(e) => { e.stopPropagation(); void deleteDraft(d.key); }}
                      style={({ pressed }) => [styles.deleteDraftBtn, pressed && { opacity: 0.85 }]}
                    >
                      <Icon name="trash-outline" size={13} color={theme.colors.white} />
                      <Text style={styles.deleteDraftText}>{t("dash.deleteDraft")}</Text>
                    </Pressable>
                  </Pressable>
                ))
              )
            ) : item.section === "changes" ? (
              changesRequested.map((v) => (
                <Pressable
                  key={v.id}
                  style={({ pressed }) => [styles.changesCard, pressed && { opacity: 0.96 }]}
                  onPress={() => navigation.navigate("Inspect", { vehicleId: v.id })}
                >
                  <View style={styles.changesTop}>
                    <View style={[styles.cardIconWrap, { backgroundColor: theme.colors.warningBg }]}>
                      <Icon name="alert-circle-outline" size={20} color={theme.colors.warning} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{v.year} {v.make} {v.model}</Text>
                      <Text style={styles.changesCta}>{t("dash.changesCta")}</Text>
                    </View>
                  </View>
                  <View style={styles.changesBanner}>
                    <Icon name="warning-outline" size={14} color={theme.colors.warning} />
                    <Text style={styles.changesNotes}>{v.review_notes?.trim() || t("dash.changesDefault")}</Text>
                  </View>
                </Pressable>
              ))
            ) : item.section === "assigned" ? (
              assigned.length === 0 ? (
                <EmptyState
                  icon="clipboard-outline"
                  title={t("dash.noAssignedTitle")}
                  body={t("dash.noAssignedBody")}
                />
              ) : (
                assigned.map((v) => (
                  <Pressable
                    key={v.id}
                    style={({ pressed }) => [styles.card, pressed && { opacity: 0.96, transform: [{ scale: 0.99 }] }]}
                    onPress={() => navigation.navigate("Inspect", { vehicleId: v.id })}
                  >
                    <View style={styles.cardIconWrap}>
                      <Icon name="car-sport-outline" size={20} color={theme.colors.brand} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{v.year} {v.make} {v.model}</Text>
                      <View style={styles.cardMeta}>
                        <Meta icon="barcode-outline">{v.vin}</Meta>
                        <Meta icon="speedometer-outline">{formatKm(v.mileage_km)}</Meta>
                      </View>
                      <View style={styles.cardMeta}>
                        <Meta icon="location-outline">{v.location_city}</Meta>
                      </View>
                    </View>
                    <View style={styles.scheduledTag}>
                      <Text style={styles.scheduledTagText}>{t("dash.scheduled")}</Text>
                    </View>
                  </Pressable>
                ))
              )
            ) : completed.length === 0 ? (
              <EmptyState
                icon="checkmark-done-outline"
                title={t("dash.noCompletedTitle")}
                body={t("dash.noCompletedBody")}
              />
            ) : (
              completed.map((v) => {
                const isInspected = v.status === "inspected";
                const inReview = v.status === "pending_review";
                return (
                  <View key={v.id}>
                    <Pressable
                      style={({ pressed }) => [styles.card, isInspected && { marginBottom: 8 }, pressed && { opacity: 0.96, transform: [{ scale: 0.99 }] }]}
                      // viewMode: open read-only with an Edit button so the
                      // inspector can review before any accidental changes.
                      onPress={() => navigation.navigate("Inspect", { vehicleId: v.id, viewMode: true })}
                    >
                      <View style={[styles.cardIconWrap, { backgroundColor: isInspected ? theme.colors.brandLight : theme.colors.successBg }]}>
                        <Icon name={isInspected ? "cloud-upload-outline" : "checkmark"} size={20} color={isInspected ? theme.colors.brand : theme.colors.success} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>{v.year} {v.make} {v.model}</Text>
                        <View style={styles.cardMeta}>
                          <Meta icon="image-outline">{t("dash.photosCount", { count: v.photo_count })}</Meta>
                          <Meta icon="calendar-outline">{formatDate(v.inspection_date)}</Meta>
                        </View>
                      </View>
                      <View style={inReview ? styles.reviewTag : styles.doneTag}>
                        <Text style={inReview ? styles.reviewTagText : styles.doneTagText}>
                          {inReview ? t("dash.inReview") : v.status.replace(/_/g, " ")}
                        </Text>
                      </View>
                    </Pressable>
                    {isInspected && (
                      <Button
                        label={t("dash.submitForListing")}
                        onPress={() => submitForListing(v.id, `${v.year} ${v.make} ${v.model}`)}
                        fullWidth
                        style={{ marginBottom: 10 }}
                      />
                    )}
                  </View>
                );
              })
            )}

            {item.section === "assigned" && assigned.length > 0 && (
              <Button
                label={t("dash.newTitle")}
                variant="outline"
                onPress={() => navigation.navigate("Inspect", { vehicleId: null })}
                fullWidth
                style={{ marginTop: 8 }}
              />
            )}
          </View>
        )}
      />
    </View>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <View style={styles.statItem}>
      <Icon name={icon} size={16} color="rgba(255,255,255,0.85)" />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Meta({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <View style={styles.metaPill}>
      <Icon name={icon} size={11} color={theme.colors.textMuted} />
      <Text style={styles.metaText}>{children}</Text>
    </View>
  );
}

function greetingKey(): string {
  const h = new Date().getHours();
  if (h < 12) return "dash.greetingMorning";
  if (h < 18) return "dash.greetingAfternoon";
  return "dash.greetingEvening";
}

// "5m ago", "2h ago", "yesterday", or absolute date for older entries —
// localised through the passed-in t().
function formatRelative(ts: number, t: TFunc): string {
  const ms = Date.now() - ts;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t("dash.justNow");
  if (min < 60) return t("dash.minAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("dash.hourAgo", { n: hr });
  const days = Math.floor(hr / 24);
  if (days === 1) return t("dash.yesterday");
  if (days < 7) return t("dash.daysAgo", { n: days });
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const styles = StyleSheet.create({
  hero: {
    padding: 20, borderRadius: 20, marginBottom: 14,
    shadowColor: theme.colors.brand, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  heroTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 18 },
  heroEyebrow: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  heroTitle: { color: theme.colors.white, fontSize: 24, fontWeight: "800", marginTop: 4, textTransform: "capitalize" },
  heroSub: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 4 },
  signOutBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  statsRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 14, padding: 14,
  },
  statItem: { flex: 1, alignItems: "flex-start" },
  statValue: { color: theme.colors.white, fontSize: 22, fontWeight: "800", marginTop: 4 },
  statLabel: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 },
  statDivider: { width: 1, height: 36, backgroundColor: "rgba(255,255,255,0.2)", marginHorizontal: 8 },

  ctaShadow: {
    marginBottom: 20,
    borderRadius: 16,
    shadowColor: theme.colors.brand, shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  cta: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 16, borderRadius: 16,
  },
  ctaIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  ctaTitle: { color: theme.colors.white, fontSize: 14, fontWeight: "800" },
  ctaSub: { color: "rgba(255,255,255,0.8)", fontSize: 11, marginTop: 2 },

  // Language switcher (flag + code pills) — matches the buyer app's pattern.
  langRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 18, paddingHorizontal: 2 },
  langRowLabel: { fontSize: 11, fontWeight: "800", color: theme.colors.textLight, textTransform: "uppercase", letterSpacing: 0.6 },
  langBtns: { flexDirection: "row", gap: 6 },
  langBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: theme.radius.full,
    backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border,
  },
  langBtnActive: { borderColor: theme.colors.brand, backgroundColor: theme.colors.brandLight },
  langFlag: { fontSize: 13 },
  langCode: { fontSize: 11, fontWeight: "800", color: theme.colors.textMuted, letterSpacing: 0.3 },

  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 11, fontWeight: "800", color: theme.colors.textLight, textTransform: "uppercase", letterSpacing: 0.6 },
  countPill: { backgroundColor: theme.colors.bgAlt, paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.full, marginLeft: 4 },
  countPillText: { fontSize: 11, fontWeight: "800", color: theme.colors.textMuted },

  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: theme.colors.white,
    borderRadius: theme.radius.xl, padding: 14,
    marginBottom: 10,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.colors.brandLight,
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 11, color: theme.colors.textMuted, fontWeight: "600" },

  scheduledTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: theme.radius.full, backgroundColor: theme.colors.warningBg },
  scheduledTagText: { fontSize: 10, fontWeight: "800", color: theme.colors.warning, textTransform: "uppercase", letterSpacing: 0.4 },
  doneTag:  { paddingHorizontal: 8, paddingVertical: 4, borderRadius: theme.radius.full, backgroundColor: theme.colors.successBg },
  doneTagText: { fontSize: 10, fontWeight: "800", color: theme.colors.success, textTransform: "uppercase", letterSpacing: 0.4 },

  // Draft card delete button (prominent, red, web-safe confirm)
  deleteDraftBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: theme.radius.full,
    backgroundColor: theme.colors.error,
  },
  deleteDraftText: { color: theme.colors.white, fontSize: 11, fontWeight: "800" },

  // Changes-requested card (admin sent it back with notes)
  changesCard: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.radius.xl, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: "#fedf89",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  changesTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  changesCta: { fontSize: 11, color: theme.colors.warning, fontWeight: "700", marginTop: 4 },
  changesBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    marginTop: 12, padding: 10, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.warningBg,
  },
  changesNotes: { flex: 1, fontSize: 12, color: theme.colors.warning, fontWeight: "600", lineHeight: 17 },

  // "In review" tag (pending_review)
  reviewTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: theme.radius.full, backgroundColor: theme.colors.brandLight },
  reviewTagText: { fontSize: 10, fontWeight: "800", color: theme.colors.brand, textTransform: "uppercase", letterSpacing: 0.4 },
});
