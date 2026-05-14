import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { Button } from "../components/Button";
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.brand} />
        <Text style={styles.loadingLabel}>Loading inspections…</Text>
      </View>
    );
  }

  const formatDate = (iso: string | null | undefined): string =>
    iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Inspections</Text>
          <Text style={styles.subtitle}>
            {assigned.length} assigned · {completed.length} completed
          </Text>
        </View>
        <Pressable onPress={signOut}><Text style={{ color: theme.colors.brand, fontWeight: "700" }}>Sign out</Text></Pressable>
      </View>

      <FlatList
        data={[{ section: "assigned" as const }, { section: "completed" as const }]}
        keyExtractor={(s) => s.section}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={theme.colors.brand}
          />
        }
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        renderItem={({ item }) => (
          <View style={{ marginBottom: 24 }}>
            <View style={styles.sectionHeader}>
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
                <View style={styles.empty}>
                  <Text style={styles.muted}>No vehicles assigned. Ask an admin to assign one to you.</Text>
                </View>
              ) : (
                assigned.map((v) => (
                  <Pressable
                    key={v.id}
                    style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
                    onPress={() => navigation.navigate("Inspect", { vehicleId: v.id })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{v.year} {v.make} {v.model}</Text>
                      <Text style={styles.rowSub}>
                        VIN {v.vin} · {formatKm(v.mileage_km)} · {v.location_city}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                ))
              )
            ) : completed.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.muted}>Nothing here yet — completed inspections will show up after you submit one.</Text>
              </View>
            ) : (
              completed.map((v) => (
                <Pressable
                  key={v.id}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
                  onPress={() => navigation.navigate("Inspect", { vehicleId: v.id, readOnly: true })}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{v.year} {v.make} {v.model}</Text>
                    <Text style={styles.rowSub}>
                      <Text style={styles.metaStrong}>{v.photo_count}</Text> photos · {formatDate(v.inspection_date)}
                    </Text>
                  </View>
                  <View style={styles.doneTag}>
                    <Text style={styles.doneTagText}>{v.status.replace(/_/g, " ")}</Text>
                  </View>
                </Pressable>
              ))
            )}

            {item.section === "assigned" && (
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

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg },
  loadingLabel: { marginTop: 12, fontSize: 13, color: theme.colors.textLight },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, paddingTop: 24 },
  title:  { fontSize: 28, fontWeight: "800", color: theme.colors.text },
  subtitle: { fontSize: 12, color: theme.colors.textLight, marginTop: 4 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 11, fontWeight: "800", color: theme.colors.textLight, textTransform: "uppercase", letterSpacing: 0.5 },
  countPill: { backgroundColor: theme.colors.bgAlt, paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.full },
  countPillText: { fontSize: 11, fontWeight: "700", color: theme.colors.textMuted },
  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, padding: 14, marginBottom: 8 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.text },
  rowSub:   { fontSize: 11, color: theme.colors.textLight, marginTop: 3 },
  metaStrong: { color: theme.colors.text, fontWeight: "700" },
  chevron:  { fontSize: 28, color: theme.colors.textLight, fontWeight: "300" },
  empty:    { padding: 18, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderStyle: "dashed" },
  muted:    { color: theme.colors.textLight, fontSize: 12 },
  doneTag:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.full, backgroundColor: theme.colors.successBg },
  doneTagText: { fontSize: 10, fontWeight: "800", color: theme.colors.success, textTransform: "uppercase" },
});
