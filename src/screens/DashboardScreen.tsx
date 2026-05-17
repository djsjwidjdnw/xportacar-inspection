import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { Button } from "../components/Button";
import { Spinner } from "../components/Spinner";
import { EmptyState } from "../components/EmptyState";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { theme, formatKm } from "../lib/theme";
import type { VehicleRow } from "../lib/types";

interface AssignedVehicle extends VehicleRow {
  inspector_id: string | null;
  inspection_date: string | null;
}
interface CompletedVehicle extends AssignedVehicle {
  photo_count: number;
}

type Section = { section: "assigned" } | { section: "completed" };
const SECTIONS: Section[] = [{ section: "assigned" }, { section: "completed" }];

export function DashboardScreen({ navigation }: { navigation: { navigate: (s: string, p?: object) => void } }) {
  const { user, signOut } = useAuth();
  const [assigned, setAssigned] = useState<AssignedVehicle[]>([]);
  const [completed, setCompleted] = useState<CompletedVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;

    // Vehicles assigned to me, awaiting inspection.
    const { data: pending } = await supabase
      .from("vehicles")
      .select("*")
      .eq("inspector_id", user.id)
      .in("status", ["inspection_scheduled", "draft"])
      .order("created_at", { ascending: false });

    // Vehicles I've already inspected — pull photo count alongside via the
    // PostgREST aggregate (`vehicle_photos(count)`).
    const { data: done } = await supabase
      .from("vehicles")
      .select("*, vehicle_photos(count)")
      .eq("inspector_id", user.id)
      .in("status", ["inspected", "listed", "in_auction", "sold"])
      .order("inspection_date", { ascending: false })
      .limit(20);

    setAssigned((pending as AssignedVehicle[]) ?? []);
    setCompleted(((done ?? []) as (AssignedVehicle & { vehicle_photos: { count: number }[] })[]).map((v) => ({
      ...v,
      photo_count: Array.isArray(v.vehicle_photos) ? (v.vehicle_photos[0]?.count ?? 0) : 0,
    })));
  }, [user]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  if (loading) return <Spinner label="Loading inspections…" />;

  const formatDate = (iso: string | null | undefined): string =>
    iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <FlatList
        data={SECTIONS}
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
                  <Text style={styles.heroEyebrow}>INSPECTOR PORTAL</Text>
                  <Text style={styles.heroTitle}>Good {greeting()}</Text>
                  <Text style={styles.heroSub}>{user?.email}</Text>
                </View>
                <Pressable onPress={signOut} hitSlop={8} style={styles.signOutBtn}>
                  <Ionicons name="log-out-outline" size={18} color={theme.colors.white} />
                </Pressable>
              </View>

              <View style={styles.statsRow}>
                <Stat label="Assigned" value={assigned.length} icon="clipboard-outline" />
                <View style={styles.statDivider} />
                <Stat label="Completed" value={completed.length} icon="checkmark-done-outline" />
              </View>
            </LinearGradient>

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
                  <Ionicons name="add-circle-outline" size={22} color={theme.colors.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ctaTitle}>Start a new inspection</Text>
                  <Text style={styles.ctaSub}>Walk-in vehicle? Begin a fresh report from scratch.</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.white} />
              </LinearGradient>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ marginBottom: 24 }}>
            <View style={styles.sectionHeader}>
              <Ionicons
                name={item.section === "assigned" ? "clipboard-outline" : "checkmark-done-outline"}
                size={14}
                color={theme.colors.textLight}
              />
              <Text style={styles.sectionTitle}>
                {item.section === "assigned" ? "Assigned to you" : "Completed inspections"}
              </Text>
              <View style={styles.countPill}>
                <Text style={styles.countPillText}>
                  {item.section === "assigned" ? assigned.length : completed.length}
                </Text>
              </View>
            </View>

            {item.section === "assigned" ? (
              assigned.length === 0 ? (
                <EmptyState
                  icon="clipboard-outline"
                  title="No vehicles assigned"
                  body="Ask an admin to assign a vehicle to you, or start a new walk-in inspection."
                />
              ) : (
                assigned.map((v) => (
                  <Pressable
                    key={v.id}
                    style={({ pressed }) => [styles.card, pressed && { opacity: 0.96, transform: [{ scale: 0.99 }] }]}
                    onPress={() => navigation.navigate("Inspect", { vehicleId: v.id })}
                  >
                    <View style={styles.cardIconWrap}>
                      <Ionicons name="car-sport-outline" size={20} color={theme.colors.brand} />
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
                      <Text style={styles.scheduledTagText}>Scheduled</Text>
                    </View>
                  </Pressable>
                ))
              )
            ) : completed.length === 0 ? (
              <EmptyState
                icon="checkmark-done-outline"
                title="No completed inspections yet"
                body="Once you submit your first inspection, it will appear here for your records."
              />
            ) : (
              completed.map((v) => (
                <Pressable
                  key={v.id}
                  style={({ pressed }) => [styles.card, pressed && { opacity: 0.96, transform: [{ scale: 0.99 }] }]}
                  onPress={() => navigation.navigate("Inspect", { vehicleId: v.id, readOnly: true })}
                >
                  <View style={[styles.cardIconWrap, { backgroundColor: theme.colors.successBg }]}>
                    <Ionicons name="checkmark" size={20} color={theme.colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{v.year} {v.make} {v.model}</Text>
                    <View style={styles.cardMeta}>
                      <Meta icon="image-outline">{v.photo_count} photos</Meta>
                      <Meta icon="calendar-outline">{formatDate(v.inspection_date)}</Meta>
                    </View>
                  </View>
                  <View style={styles.doneTag}>
                    <Text style={styles.doneTagText}>{v.status.replace(/_/g, " ")}</Text>
                  </View>
                </Pressable>
              ))
            )}

            {item.section === "assigned" && assigned.length > 0 && (
              <Button
                label="Start a new inspection"
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

function Stat({ label, value, icon }: { label: string; value: number; icon: keyof typeof import("@expo/vector-icons").Ionicons.glyphMap }) {
  return (
    <View style={styles.statItem}>
      <Ionicons name={icon} size={16} color="rgba(255,255,255,0.85)" />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Meta({ icon, children }: { icon: keyof typeof import("@expo/vector-icons").Ionicons.glyphMap; children: React.ReactNode }) {
  return (
    <View style={styles.metaPill}>
      <Ionicons name={icon} size={11} color={theme.colors.textMuted} />
      <Text style={styles.metaText}>{children}</Text>
    </View>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
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
});
