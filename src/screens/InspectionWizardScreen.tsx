import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";

import { Button } from "../components/Button";
import { supabase } from "../lib/supabase";
import { theme, formatKm } from "../lib/theme";
import { useAuth } from "../lib/auth";
import type { VehicleRow } from "../lib/types";

// ---- Step config ----------------------------------------------------
const PHOTO_SLOTS = [
  { key: "front",           label: "Front" },
  { key: "rear",            label: "Rear" },
  { key: "left",            label: "Left side" },
  { key: "right",           label: "Right side" },
  { key: "front_left",      label: "Front-left" },
  { key: "front_right",     label: "Front-right" },
  { key: "rear_left",       label: "Rear-left" },
  { key: "rear_right",      label: "Rear-right" },
  { key: "interior_front",  label: "Interior front" },
  { key: "interior_rear",   label: "Interior rear" },
  { key: "engine",          label: "Engine bay" },
  { key: "trunk",           label: "Trunk" },
] as const;

const PANELS = [
  "Front bumper", "Rear bumper", "Hood", "Roof",
  "Left front door", "Left rear door", "Right front door", "Right rear door",
  "Left fender", "Right fender", "Trunk lid", "Windshield",
] as const;

const DAMAGE_LEVELS = ["none", "cosmetic", "minor", "moderate", "major"] as const;
type DamageLevel = (typeof DAMAGE_LEVELS)[number];

const DOC_SLOTS = [
  { key: "registration",  label: "Registration" },
  { key: "service_book",  label: "Service book" },
  { key: "insurance",     label: "Insurance docs" },
] as const;

const STORAGE_BUCKET = "vehicle-photos";

// ---- Component ------------------------------------------------------

export function InspectionWizardScreen({
  route, navigation,
}: {
  route: { params?: { vehicleId?: string | null; readOnly?: boolean } };
  navigation: { goBack: () => void; navigate: (s: string) => void };
}) {
  const { user } = useAuth();
  const readOnly = !!route.params?.readOnly;
  const incomingId = route.params?.vehicleId ?? null;

  // Step state
  const [step, setStep] = useState(1);

  // Vehicle (existing or new draft)
  const [vehicle, setVehicle] = useState<Partial<VehicleRow> & { id?: string }>({});
  const [vin, setVin] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [mileage, setMileage] = useState("");
  const [color, setColor] = useState("");
  const [city, setCity] = useState("Dubai");
  const [sellerName, setSellerName] = useState("");
  const [sellerPhone, setSellerPhone] = useState("");

  // Photo state — record of slot key -> uploaded URL
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);

  // Damage state — record of panel name -> { level, description }
  const [damages, setDamages] = useState<Record<string, { level: DamageLevel; description: string }>>({});
  const [pickerOpen, setPickerOpen] = useState<{ panel: string } | null>(null);

  // Documents
  const [docs, setDocs] = useState<Record<string, string>>({});

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(!!incomingId);

  // ---- Load existing vehicle ----------------------------------------
  useEffect(() => {
    if (!incomingId) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase.from("vehicles").select("*").eq("id", incomingId).single();
      if (data) {
        const v = data as VehicleRow;
        setVehicle(v);
        setVin(v.vin ?? "");
        setMake(v.make ?? "");
        setModel(v.model ?? "");
        setYear(String(v.year ?? ""));
        setMileage(String(v.mileage_km ?? ""));
        setColor(v.exterior_color ?? "");
        setCity(v.location_city ?? "Dubai");
      }
      setLoading(false);
    })();
  }, [incomingId]);

  // ---- Helpers ------------------------------------------------------

  const ensureBucket = useCallback(async () => {
    try { await supabase.storage.createBucket(STORAGE_BUCKET, { public: true }); } catch { /* already exists */ }
  }, []);

  const uploadOne = useCallback(async (slotKey: string, asset: ImagePicker.ImagePickerAsset, prefix: "photos" | "documents") => {
    await ensureBucket();
    const ext = asset.uri.split(".").pop()?.toLowerCase() ?? "jpg";
    const ts  = Date.now();
    const key = `${prefix}/${user?.id ?? "anon"}/${ts}-${slotKey}.${ext}`;

    // Read the file as a blob via fetch — works on iOS + Android + web.
    const res = await fetch(asset.uri);
    const blob = await res.blob();

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(key, blob, { contentType: asset.mimeType ?? `image/${ext}`, upsert: false });
    if (error) throw error;

    const { data: publicUrl } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(key);
    return publicUrl.publicUrl;
  }, [ensureBucket, user]);

  const takePhoto = async (slotKey: string, kind: "photo" | "document") => {
    if (readOnly) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera disabled", "Grant camera access in Settings to capture photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setUploading(slotKey);
    try {
      const url = await uploadOne(slotKey, result.assets[0], kind === "photo" ? "photos" : "documents");
      if (kind === "photo") setPhotos((p) => ({ ...p, [slotKey]: url }));
      else                  setDocs((d) => ({ ...d, [slotKey]: url }));
    } catch (e) {
      Alert.alert("Upload failed", (e as Error).message ?? "Unknown error");
    } finally {
      setUploading(null);
    }
  };

  // ---- Damage editor ------------------------------------------------
  const setDamage = (panel: string, level: DamageLevel, description?: string) => {
    setDamages((d) => ({ ...d, [panel]: { level, description: description ?? d[panel]?.description ?? "" } }));
  };

  // ---- Submit -------------------------------------------------------
  const submit = async () => {
    if (!user) { Alert.alert("Sign in required", "Sign in before submitting."); return; }
    if (!vin || !make || !model || !year) {
      Alert.alert("Missing details", "VIN, make, model and year are required.");
      setStep(1);
      return;
    }
    setSubmitting(true);
    try {
      let vehicleId = vehicle.id;

      // Insert or update vehicle.
      const vehiclePayload = {
        vin: vin.trim().toUpperCase(),
        make: make.trim(),
        model: model.trim(),
        year: Number(year) || 0,
        mileage_km: Number(mileage) || 0,
        exterior_color: color || null,
        location_city: city || "Dubai",
        location_country: "UAE",
        fuel_type: vehicle.fuel_type ?? "petrol",
        transmission: vehicle.transmission ?? "automatic",
        status: "inspected" as const,
        seller_name: sellerName || vehicle.seller_name || "Walk-in",
        seller_phone: sellerPhone || vehicle.seller_phone || "+971-",
        inspector_id: user.id,
        inspection_date: new Date().toISOString(),
      };

      if (vehicleId) {
        const { error } = await supabase.from("vehicles").update(vehiclePayload).eq("id", vehicleId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("vehicles")
          .insert({ ...vehiclePayload, created_by: user.id })
          .select("id")
          .single();
        if (error) throw error;
        vehicleId = (data as { id: string }).id;
      }
      if (!vehicleId) throw new Error("Couldn't create vehicle");

      // Photos
      const photoRows = Object.entries(photos).map(([slot, url], i) => ({
        vehicle_id: vehicleId!,
        url,
        category:   slot.startsWith("interior") ? "interior" : slot === "engine" ? "engine" : slot === "trunk" ? "interior" : "exterior",
        sort_order: i,
        caption:    PHOTO_SLOTS.find((s) => s.key === slot)?.label ?? slot,
      }));
      const docRows = Object.entries(docs).map(([slot, url]) => ({
        vehicle_id: vehicleId!,
        url,
        category: "documents",
        sort_order: 100,
        caption:    DOC_SLOTS.find((s) => s.key === slot)?.label ?? slot,
      }));
      if (photoRows.length + docRows.length > 0) {
        const { error } = await supabase.from("vehicle_photos").insert([...photoRows, ...docRows]);
        if (error) throw error;
      }

      // Damages
      const damageRows = Object.entries(damages)
        .filter(([, d]) => d.level !== "none")
        .map(([panel, d]) => ({
          vehicle_id: vehicleId!,
          location: panel,
          description: d.description || `${d.level} damage on ${panel}`,
          severity: d.level === "none" ? "cosmetic" : d.level,
        }));
      if (damageRows.length > 0) {
        const { error } = await supabase.from("vehicle_damages").insert(damageRows);
        if (error) throw error;
      }

      Alert.alert("Inspection submitted", "Vehicle is now ready for listing.", [
        { text: "Back to dashboard", onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert("Submit failed", (e as Error).message ?? "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.colors.brand} size="large" /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stepper step={step} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {step === 1 && (
          <Section title="1. Vehicle details">
            <Field label="VIN" required><TextInput value={vin} onChangeText={setVin} autoCapitalize="characters" maxLength={17} style={styles.input} editable={!readOnly} /></Field>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label="Make" required style={{ flex: 1 }}><TextInput value={make} onChangeText={setMake} style={styles.input} editable={!readOnly} /></Field>
              <Field label="Year" required style={{ flex: 1 }}><TextInput value={year} onChangeText={setYear} keyboardType="number-pad" style={styles.input} editable={!readOnly} /></Field>
            </View>
            <Field label="Model" required><TextInput value={model} onChangeText={setModel} style={styles.input} editable={!readOnly} /></Field>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label="Mileage (km)" style={{ flex: 1 }}><TextInput value={mileage} onChangeText={setMileage} keyboardType="number-pad" style={styles.input} editable={!readOnly} /></Field>
              <Field label="Exterior color" style={{ flex: 1 }}><TextInput value={color} onChangeText={setColor} style={styles.input} editable={!readOnly} /></Field>
            </View>
            <Field label="City"><TextInput value={city} onChangeText={setCity} style={styles.input} editable={!readOnly} /></Field>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label="Seller name" style={{ flex: 1 }}><TextInput value={sellerName} onChangeText={setSellerName} style={styles.input} editable={!readOnly} /></Field>
              <Field label="Seller phone" style={{ flex: 1 }}><TextInput value={sellerPhone} onChangeText={setSellerPhone} keyboardType="phone-pad" style={styles.input} editable={!readOnly} /></Field>
            </View>
          </Section>
        )}

        {step === 2 && (
          <Section title="2. Required photos">
            <Text style={styles.muted}>Capture every angle. Green ✓ = uploaded.</Text>
            <View style={styles.photoGrid}>
              {PHOTO_SLOTS.map((s) => (
                <Pressable key={s.key} onPress={() => takePhoto(s.key, "photo")} style={styles.photoTile} disabled={readOnly || uploading !== null}>
                  {photos[s.key] ? (
                    <>
                      <Image source={{ uri: photos[s.key] }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      <View style={styles.photoOverlay}><Text style={styles.photoCheck}>✓</Text></View>
                    </>
                  ) : (
                    <View style={styles.photoEmpty}>
                      <Text style={styles.photoIcon}>📷</Text>
                      <Text style={styles.photoLabel}>{s.label}</Text>
                      {uploading === s.key && <ActivityIndicator size="small" color={theme.colors.brand} style={{ marginTop: 4 }} />}
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </Section>
        )}

        {step === 3 && (
          <Section title="3. Damage report">
            <Text style={styles.muted}>Mark each panel. Tap to set severity.</Text>
            {PANELS.map((p) => {
              const d = damages[p];
              const level = d?.level ?? "none";
              const sev = damageStyle(level);
              return (
                <Pressable key={p} onPress={() => readOnly ? null : setPickerOpen({ panel: p })} style={styles.panelRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.panelName}>{p}</Text>
                    {d?.description ? <Text style={styles.panelDesc}>{d.description}</Text> : null}
                  </View>
                  <View style={[styles.severityTag, { backgroundColor: sev.bg }]}>
                    <Text style={[styles.severityText, { color: sev.fg }]}>{level}</Text>
                  </View>
                </Pressable>
              );
            })}
            <DamagePicker
              open={!!pickerOpen}
              panel={pickerOpen?.panel ?? ""}
              initial={pickerOpen ? (damages[pickerOpen.panel] ?? { level: "none", description: "" }) : { level: "none", description: "" }}
              onClose={() => setPickerOpen(null)}
              onSave={(level, desc) => {
                if (pickerOpen) setDamage(pickerOpen.panel, level, desc);
                setPickerOpen(null);
              }}
            />
          </Section>
        )}

        {step === 4 && (
          <Section title="4. Documents">
            <Text style={styles.muted}>Capture registration, service book and insurance via camera.</Text>
            <View style={styles.photoGrid}>
              {DOC_SLOTS.map((s) => (
                <Pressable key={s.key} onPress={() => takePhoto(s.key, "document")} style={styles.photoTile} disabled={readOnly || uploading !== null}>
                  {docs[s.key] ? (
                    <>
                      <Image source={{ uri: docs[s.key] }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      <View style={styles.photoOverlay}><Text style={styles.photoCheck}>✓</Text></View>
                    </>
                  ) : (
                    <View style={styles.photoEmpty}>
                      <Text style={styles.photoIcon}>📄</Text>
                      <Text style={styles.photoLabel}>{s.label}</Text>
                      {uploading === s.key && <ActivityIndicator size="small" color={theme.colors.brand} style={{ marginTop: 4 }} />}
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </Section>
        )}

        {step === 5 && (
          <Section title="5. Review & submit">
            <View style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>{year} {make} {model}</Text>
              <Text style={styles.reviewSub}>VIN {vin} · {formatKm(Number(mileage) || 0)} · {color}</Text>
            </View>

            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}><Text style={styles.summaryNum}>{Object.keys(photos).length}/{PHOTO_SLOTS.length}</Text><Text style={styles.summaryLabel}>Photos</Text></View>
              <View style={styles.summaryItem}><Text style={styles.summaryNum}>{Object.values(damages).filter((d) => d.level !== "none").length}</Text><Text style={styles.summaryLabel}>Damages</Text></View>
              <View style={styles.summaryItem}><Text style={styles.summaryNum}>{Object.keys(docs).length}/{DOC_SLOTS.length}</Text><Text style={styles.summaryLabel}>Documents</Text></View>
            </View>

            {!readOnly && (
              <Button label={submitting ? "Submitting…" : "Submit inspection"} onPress={submit} loading={submitting} fullWidth style={{ marginTop: 16 }} />
            )}
          </Section>
        )}
      </ScrollView>

      {/* Step nav */}
      <View style={styles.navBar}>
        <Button label="Back" variant="outline" onPress={() => step === 1 ? navigation.goBack() : setStep((s) => s - 1)} style={{ flex: 1 }} />
        {step < 5 && <Button label="Next" onPress={() => setStep((s) => Math.min(5, s + 1))} style={{ flex: 1 }} />}
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({ label, required, style, children }: { label: string; required?: boolean; style?: object; children: React.ReactNode }) {
  return (
    <View style={[{ marginBottom: 12 }, style]}>
      <Text style={styles.label}>{label}{required && <Text style={{ color: theme.colors.error }}>  *</Text>}</Text>
      {children}
    </View>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <View style={styles.stepper}>
      {[1, 2, 3, 4, 5].map((n) => (
        <View key={n} style={[styles.stepDot, n <= step && { backgroundColor: theme.colors.brand }]}>
          <Text style={[styles.stepDotText, n <= step && { color: theme.colors.white }]}>{n}</Text>
        </View>
      ))}
    </View>
  );
}

function damageStyle(level: DamageLevel) {
  switch (level) {
    case "cosmetic": return { bg: theme.colors.bgAlt, fg: theme.colors.textMuted };
    case "minor":    return { bg: theme.colors.brandLight, fg: theme.colors.brandDark };
    case "moderate": return { bg: theme.colors.warningBg, fg: theme.colors.warning };
    case "major":    return { bg: theme.colors.errorBg, fg: theme.colors.error };
    default:         return { bg: theme.colors.successBg, fg: theme.colors.success };
  }
}

function DamagePicker({
  open, panel, initial, onClose, onSave,
}: {
  open: boolean;
  panel: string;
  initial: { level: DamageLevel; description: string };
  onClose: () => void;
  onSave: (level: DamageLevel, description: string) => void;
}) {
  const [level, setLevel] = useState<DamageLevel>(initial.level);
  const [desc, setDesc] = useState(initial.description);
  useEffect(() => { setLevel(initial.level); setDesc(initial.description); }, [open, initial]);
  if (!open) return null;
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <View style={styles.modalScrim}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{panel}</Text>
          <Text style={styles.muted}>Set damage severity and add a quick note.</Text>

          <View style={styles.levelRow}>
            {DAMAGE_LEVELS.map((l) => {
              const sty = damageStyle(l);
              const selected = l === level;
              return (
                <Pressable
                  key={l}
                  onPress={() => setLevel(l)}
                  style={[styles.levelBtn, { backgroundColor: sty.bg, borderColor: selected ? sty.fg : "transparent", borderWidth: 2 }]}
                >
                  <Text style={[styles.levelText, { color: sty.fg }]}>{l}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={desc}
            onChangeText={setDesc}
            multiline
            placeholder="e.g. 12 cm scuff, no paint break"
            placeholderTextColor={theme.colors.textLight}
            style={[styles.input, { height: 80, paddingTop: 10, textAlignVertical: "top" }]}
          />

          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <Button label="Cancel" variant="outline" onPress={onClose} style={{ flex: 1 }} />
            <Button label="Save" onPress={() => onSave(level, desc)} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  stepper: { flexDirection: "row", justifyContent: "center", gap: 6, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: theme.colors.white, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  stepDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.bgAlt, alignItems: "center", justifyContent: "center" },
  stepDotText: { fontSize: 12, fontWeight: "700", color: theme.colors.textMuted },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: theme.colors.text, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: "700", color: theme.colors.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  input: { height: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.borderStrong, paddingHorizontal: 14, fontSize: 15, color: theme.colors.text, backgroundColor: theme.colors.white },
  muted: { color: theme.colors.textLight, fontSize: 12, marginBottom: 10 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoTile: { width: "31%", aspectRatio: 1, borderRadius: theme.radius.md, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden", alignItems: "center", justifyContent: "center", position: "relative" },
  photoEmpty: { alignItems: "center", justifyContent: "center" },
  photoIcon: { fontSize: 22 },
  photoLabel: { fontSize: 10, color: theme.colors.textMuted, marginTop: 2, textAlign: "center", paddingHorizontal: 6 },
  photoOverlay: { position: "absolute", top: 6, right: 6, backgroundColor: theme.colors.success, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  photoCheck: { color: theme.colors.white, fontSize: 12, fontWeight: "800" },
  panelRow: { flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, marginBottom: 8 },
  panelName: { fontSize: 14, fontWeight: "600", color: theme.colors.text },
  panelDesc: { fontSize: 11, color: theme.colors.textLight, marginTop: 2 },
  severityTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.full },
  severityText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  navBar: { flexDirection: "row", gap: 10, padding: 16, backgroundColor: theme.colors.white, borderTopWidth: 1, borderTopColor: theme.colors.border },
  reviewCard: { padding: 16, borderRadius: theme.radius.lg, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border },
  reviewTitle: { fontSize: 18, fontWeight: "800", color: theme.colors.text },
  reviewSub: { fontSize: 12, color: theme.colors.textLight, marginTop: 4 },
  summaryRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  summaryItem: { flex: 1, padding: 14, alignItems: "center", borderRadius: theme.radius.md, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border },
  summaryNum: { fontSize: 22, fontWeight: "800", color: theme.colors.text },
  summaryLabel: { fontSize: 11, color: theme.colors.textLight, marginTop: 2, textTransform: "uppercase" },
  modalScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", padding: 16, justifyContent: "flex-end" },
  modalCard: { backgroundColor: theme.colors.white, borderRadius: theme.radius.xl, padding: 20, ...Platform.select({ ios: { paddingBottom: 32 }, default: { paddingBottom: 16 } }) },
  modalTitle: { fontSize: 18, fontWeight: "800", color: theme.colors.text, marginBottom: 4 },
  levelRow: { flexDirection: "row", gap: 6, marginVertical: 14, flexWrap: "wrap" },
  levelBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.full },
  levelText: { fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
});
