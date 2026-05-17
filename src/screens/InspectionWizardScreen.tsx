import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { Button } from "../components/Button";
import { Spinner } from "../components/Spinner";
import { supabase } from "../lib/supabase";
import { theme, formatKm } from "../lib/theme";
import { useAuth } from "../lib/auth";
import type { VehicleRow } from "../lib/types";

// ---- Step config ----------------------------------------------------
const STEPS = [
  { n: 1, label: "Details",   icon: "document-text-outline" as const },
  { n: 2, label: "Photos",    icon: "camera-outline" as const },
  { n: 3, label: "Damage",    icon: "warning-outline" as const },
  { n: 4, label: "Documents", icon: "folder-open-outline" as const },
  { n: 5, label: "Review",    icon: "checkmark-done-outline" as const },
] as const;

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

// Grouped damage panels — each entry maps to a labelled section so the
// inspector can move through the car visually instead of scanning a flat
// list.  An ASCII car outline at the top of the step orients the user.
const PANEL_SECTIONS: ReadonlyArray<{ key: string; label: string; panels: readonly string[] }> = [
  { key: "front", label: "Front",  panels: ["Front bumper", "Hood",       "Windshield"] },
  { key: "left",  label: "Left side", panels: ["Left front door",   "Left rear door",   "Left fender"] },
  { key: "right", label: "Right side", panels: ["Right front door", "Right rear door",  "Right fender"] },
  { key: "rear",  label: "Rear",  panels: ["Rear bumper", "Trunk lid"] },
  { key: "top",   label: "Top",   panels: ["Roof"] },
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

  if (loading) return <Spinner label="Loading vehicle…" />;

  const currentStep = STEPS.find((s) => s.n === step)!;
  const photoProgress = Object.keys(photos).length / PHOTO_SLOTS.length;
  const docProgress   = Object.keys(docs).length / DOC_SLOTS.length;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stepper step={step} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={styles.stepHeader}>
          <View style={styles.stepHeaderIcon}>
            <Ionicons name={currentStep.icon} size={20} color={theme.colors.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.stepEyebrow}>Step {step} of {STEPS.length}</Text>
            <Text style={styles.stepTitle}>{currentStep.label}</Text>
          </View>
        </View>

        {step === 1 && (
          <Card>
            <Field label="VIN" required><TextInput value={vin} onChangeText={setVin} autoCapitalize="characters" maxLength={17} style={styles.input} editable={!readOnly} placeholder="WBA1234567890XXXX" placeholderTextColor={theme.colors.textLight} /></Field>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label="Make" required style={{ flex: 1 }}><TextInput value={make} onChangeText={setMake} style={styles.input} editable={!readOnly} placeholder="BMW" placeholderTextColor={theme.colors.textLight} /></Field>
              <Field label="Year" required style={{ flex: 1 }}><TextInput value={year} onChangeText={setYear} keyboardType="number-pad" style={styles.input} editable={!readOnly} placeholder="2023" placeholderTextColor={theme.colors.textLight} /></Field>
            </View>
            <Field label="Model" required><TextInput value={model} onChangeText={setModel} style={styles.input} editable={!readOnly} placeholder="X5" placeholderTextColor={theme.colors.textLight} /></Field>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label="Mileage (km)" style={{ flex: 1 }}><TextInput value={mileage} onChangeText={setMileage} keyboardType="number-pad" style={styles.input} editable={!readOnly} placeholder="42 000" placeholderTextColor={theme.colors.textLight} /></Field>
              <Field label="Exterior color" style={{ flex: 1 }}><TextInput value={color} onChangeText={setColor} style={styles.input} editable={!readOnly} placeholder="White" placeholderTextColor={theme.colors.textLight} /></Field>
            </View>
            <Field label="City"><TextInput value={city} onChangeText={setCity} style={styles.input} editable={!readOnly} /></Field>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label="Seller name" style={{ flex: 1 }}><TextInput value={sellerName} onChangeText={setSellerName} style={styles.input} editable={!readOnly} placeholder="Ahmed Al Rashid" placeholderTextColor={theme.colors.textLight} /></Field>
              <Field label="Seller phone" style={{ flex: 1 }}><TextInput value={sellerPhone} onChangeText={setSellerPhone} keyboardType="phone-pad" style={styles.input} editable={!readOnly} placeholder="+971 50 …" placeholderTextColor={theme.colors.textLight} /></Field>
            </View>
          </Card>
        )}

        {step === 2 && (
          <View>
            <ProgressBar value={photoProgress} label={`${Object.keys(photos).length} of ${PHOTO_SLOTS.length} required photos captured`} />
            <Text style={styles.tip}>Tap a tile to capture. Green check = uploaded.</Text>
            <View style={styles.photoGrid}>
              {PHOTO_SLOTS.map((s) => (
                <Pressable
                  key={s.key}
                  onPress={() => takePhoto(s.key, "photo")}
                  style={({ pressed }) => [
                    styles.photoTile,
                    photos[s.key] && styles.photoTileDone,
                    pressed && { opacity: 0.92 },
                  ]}
                  disabled={readOnly || uploading !== null}
                >
                  {photos[s.key] ? (
                    <>
                      <Image source={{ uri: photos[s.key] }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      <View style={styles.photoOverlay}><Ionicons name="checkmark" size={14} color={theme.colors.white} /></View>
                    </>
                  ) : (
                    <View style={styles.photoEmpty}>
                      <Ionicons name="camera" size={22} color={theme.colors.textLight} />
                      <Text style={styles.photoLabel}>{s.label}</Text>
                      {uploading === s.key && <ActivityIndicator size="small" color={theme.colors.brand} style={{ marginTop: 4 }} />}
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {step === 3 && (
          <View>
            <Text style={styles.tip}>Walk around the car and tag every panel that has damage.</Text>

            {/* Simple ASCII car outline — orientation aid for the inspector. */}
            <View style={styles.carOutline}>
              <Text style={styles.carOutlineLabel}>FRONT</Text>
              <View style={styles.carOutlineMid}>
                <Text style={styles.carOutlineSide}>L</Text>
                <View style={styles.carOutlineBody}>
                  <Text style={styles.carOutlineRoof}>▢ ROOF ▢</Text>
                </View>
                <Text style={styles.carOutlineSide}>R</Text>
              </View>
              <Text style={styles.carOutlineLabel}>REAR</Text>
            </View>

            {PANEL_SECTIONS.map((sec) => {
              const sectionDamageCount = sec.panels.filter((p) => damages[p] && damages[p].level !== "none").length;
              return (
                <View key={sec.key} style={styles.panelGroup}>
                  <View style={styles.panelGroupHeader}>
                    <Text style={styles.panelGroupTitle}>{sec.label}</Text>
                    {sectionDamageCount > 0 ? (
                      <View style={styles.panelGroupBadge}>
                        <Ionicons name="warning-outline" size={11} color={theme.colors.warning} />
                        <Text style={styles.panelGroupBadgeText}>{sectionDamageCount} reported</Text>
                      </View>
                    ) : (
                      <View style={[styles.panelGroupBadge, { backgroundColor: theme.colors.successBg }]}>
                        <Ionicons name="checkmark-circle" size={11} color={theme.colors.success} />
                        <Text style={[styles.panelGroupBadgeText, { color: theme.colors.success }]}>clear</Text>
                      </View>
                    )}
                  </View>
                  {sec.panels.map((p) => {
                    const d = damages[p];
                    const level = d?.level ?? "none";
                    const sev = damageStyle(level);
                    return (
                      <Pressable
                        key={p}
                        onPress={() => readOnly ? null : setPickerOpen({ panel: p })}
                        style={({ pressed }) => [styles.panelRow, pressed && { opacity: 0.95 }]}
                      >
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
                </View>
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
          </View>
        )}

        {step === 4 && (
          <View>
            <ProgressBar value={docProgress} label={`${Object.keys(docs).length} of ${DOC_SLOTS.length} documents captured`} />
            <Text style={styles.tip}>Capture each document with the camera. Make sure text is readable.</Text>
            <View style={styles.photoGrid}>
              {DOC_SLOTS.map((s) => (
                <Pressable
                  key={s.key}
                  onPress={() => takePhoto(s.key, "document")}
                  style={({ pressed }) => [
                    styles.photoTile,
                    docs[s.key] && styles.photoTileDone,
                    pressed && { opacity: 0.92 },
                  ]}
                  disabled={readOnly || uploading !== null}
                >
                  {docs[s.key] ? (
                    <>
                      <Image source={{ uri: docs[s.key] }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      <View style={styles.photoOverlay}><Ionicons name="checkmark" size={14} color={theme.colors.white} /></View>
                    </>
                  ) : (
                    <View style={styles.photoEmpty}>
                      <Ionicons name="document-text-outline" size={22} color={theme.colors.textLight} />
                      <Text style={styles.photoLabel}>{s.label}</Text>
                      {uploading === s.key && <ActivityIndicator size="small" color={theme.colors.brand} style={{ marginTop: 4 }} />}
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {step === 5 && (
          <View>
            <Card>
              <Text style={styles.reviewEyebrow}>Vehicle</Text>
              <Text style={styles.reviewTitle}>{year || "—"} {make || "—"} {model || "—"}</Text>
              <Text style={styles.reviewSub}>VIN {vin || "—"} · {formatKm(Number(mileage) || 0)} · {color || "—"}</Text>
            </Card>

            <View style={styles.summaryRow}>
              <SummaryCard icon="camera-outline" value={`${Object.keys(photos).length}/${PHOTO_SLOTS.length}`} label="Photos" complete={Object.keys(photos).length === PHOTO_SLOTS.length} />
              <SummaryCard icon="warning-outline" value={String(Object.values(damages).filter((d) => d.level !== "none").length)} label="Damages" />
              <SummaryCard icon="folder-open-outline" value={`${Object.keys(docs).length}/${DOC_SLOTS.length}`} label="Documents" complete={Object.keys(docs).length === DOC_SLOTS.length} />
            </View>

            {!readOnly && (
              <Pressable onPress={submit} disabled={submitting} style={({ pressed }) => [styles.submitShadow, pressed && { opacity: 0.92 }]}>
                <LinearGradient
                  colors={[theme.colors.brand, theme.colors.brandDark]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.submitBtn}
                >
                  {submitting && <ActivityIndicator color={theme.colors.white} />}
                  <Ionicons name="checkmark-done-outline" size={20} color={theme.colors.white} />
                  <Text style={styles.submitText}>{submitting ? "Submitting…" : "Submit inspection"}</Text>
                </LinearGradient>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      {/* Step nav */}
      <View style={styles.navBar}>
        <Button label="Back" variant="outline" onPress={() => step === 1 ? navigation.goBack() : setStep((s) => s - 1)} style={{ flex: 1 }} />
        {step < STEPS.length && <Button label="Next" onPress={() => setStep((s) => Math.min(STEPS.length, s + 1))} style={{ flex: 1 }} />}
      </View>
    </View>
  );
}

function Stepper({ step }: { step: number }) {
  const pct = ((step - 1) / (STEPS.length - 1)) * 100;
  return (
    <View style={styles.stepperWrap}>
      <View style={styles.stepperTrack}>
        <View style={[styles.stepperFill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.stepperDots}>
        {STEPS.map((s) => {
          const done = s.n < step;
          const active = s.n === step;
          return (
            <View key={s.n} style={styles.stepperItem}>
              <View
                style={[
                  styles.stepDot,
                  (done || active) && { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
                ]}
              >
                {done ? (
                  <Ionicons name="checkmark" size={14} color={theme.colors.white} />
                ) : (
                  <Text style={[styles.stepDotText, active && { color: theme.colors.white }]}>{s.n}</Text>
                )}
              </View>
              <Text style={[styles.stepLabel, active && { color: theme.colors.brand, fontWeight: "800" }]}>{s.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.progressLabel}>{label}</Text>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function SummaryCard({ icon, value, label, complete }: { icon: keyof typeof Ionicons.glyphMap; value: string; label: string; complete?: boolean }) {
  return (
    <View style={styles.summaryItem}>
      <Ionicons name={icon} size={18} color={complete ? theme.colors.success : theme.colors.textMuted} />
      <Text style={[styles.summaryNum, complete && { color: theme.colors.success }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
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
          <Text style={styles.modalSub}>Set damage severity and add a quick note.</Text>

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
  // Stepper
  stepperWrap: { backgroundColor: theme.colors.white, paddingTop: 18, paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  stepperTrack: { position: "absolute", top: 32, left: 32, right: 32, height: 2, backgroundColor: theme.colors.border, borderRadius: 1 },
  stepperFill:  { height: 2, backgroundColor: theme.colors.brand, borderRadius: 1 },
  stepperDots:  { flexDirection: "row", justifyContent: "space-between" },
  stepperItem:  { alignItems: "center", flex: 1 },
  stepDot:      { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.white, borderWidth: 2, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center" },
  stepDotText:  { fontSize: 12, fontWeight: "800", color: theme.colors.textMuted },
  stepLabel:    { fontSize: 10, fontWeight: "700", color: theme.colors.textLight, marginTop: 6, textAlign: "center" },

  // Step header
  stepHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  stepHeaderIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.brandLight, alignItems: "center", justifyContent: "center" },
  stepEyebrow: { fontSize: 10, fontWeight: "800", color: theme.colors.textLight, letterSpacing: 1, textTransform: "uppercase" },
  stepTitle:   { fontSize: 22, fontWeight: "800", color: theme.colors.text, marginTop: 2 },

  // Progress bar
  progressTrack: { height: 6, backgroundColor: theme.colors.bgAlt, borderRadius: 3, overflow: "hidden" },
  progressFill:  { height: 6, backgroundColor: theme.colors.brand, borderRadius: 3 },
  progressLabel: { fontSize: 11, color: theme.colors.textLight, marginTop: 6, fontWeight: "600" },
  tip:           { fontSize: 12, color: theme.colors.textLight, marginBottom: 12 },

  // Card
  card: {
    padding: 16, borderRadius: theme.radius.xl, backgroundColor: theme.colors.white,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },

  // Forms
  label: { fontSize: 11, fontWeight: "800", color: theme.colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  input: { height: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 14, fontSize: 14, color: theme.colors.text, backgroundColor: theme.colors.white },

  // Photo grid
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoTile: {
    width: "31%", aspectRatio: 1, borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border,
    overflow: "hidden", alignItems: "center", justifyContent: "center", position: "relative",
  },
  photoTileDone: { borderColor: theme.colors.success, borderWidth: 2 },
  photoEmpty: { alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  photoLabel: { fontSize: 10, fontWeight: "600", color: theme.colors.textMuted, marginTop: 6, textAlign: "center" },
  photoOverlay: { position: "absolute", top: 6, right: 6, backgroundColor: theme.colors.success, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },

  // Car outline
  carOutline: { padding: 12, backgroundColor: theme.colors.bgAlt, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 16, alignItems: "center" },
  carOutlineLabel: { fontSize: 10, fontWeight: "800", color: theme.colors.textLight, letterSpacing: 1, marginVertical: 2 },
  carOutlineMid: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", paddingHorizontal: 12, marginVertical: 4 },
  carOutlineSide: { fontSize: 14, fontWeight: "800", color: theme.colors.textMuted, paddingHorizontal: 8 },
  carOutlineBody: { flex: 1, borderWidth: 2, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.md, paddingVertical: 18, alignItems: "center", marginHorizontal: 6 },
  carOutlineRoof: { fontSize: 11, fontWeight: "700", color: theme.colors.textMuted, letterSpacing: 1 },

  // Panel groups
  panelGroup: { marginBottom: 14 },
  panelGroupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6, paddingHorizontal: 2 },
  panelGroupTitle: { fontSize: 12, fontWeight: "800", color: theme.colors.text, textTransform: "uppercase", letterSpacing: 0.5 },
  panelGroupBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.full, backgroundColor: theme.colors.warningBg },
  panelGroupBadgeText: { fontSize: 10, color: theme.colors.warning, fontWeight: "800", textTransform: "uppercase" },
  panelRow: { flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, marginBottom: 8 },
  panelName: { fontSize: 14, fontWeight: "700", color: theme.colors.text },
  panelDesc: { fontSize: 11, color: theme.colors.textLight, marginTop: 2 },
  severityTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.full },
  severityText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" },

  // Review step
  reviewEyebrow: { fontSize: 10, fontWeight: "800", color: theme.colors.textLight, textTransform: "uppercase", letterSpacing: 0.5 },
  reviewTitle: { fontSize: 20, fontWeight: "800", color: theme.colors.text, marginTop: 4 },
  reviewSub: { fontSize: 12, color: theme.colors.textLight, marginTop: 4 },
  summaryRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  summaryItem: { flex: 1, padding: 14, alignItems: "center", borderRadius: theme.radius.lg, backgroundColor: theme.colors.white, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  summaryNum: { fontSize: 20, fontWeight: "800", color: theme.colors.text, marginTop: 4 },
  summaryLabel: { fontSize: 10, color: theme.colors.textLight, marginTop: 2, textTransform: "uppercase", fontWeight: "700", letterSpacing: 0.4 },
  submitShadow: { marginTop: 20, borderRadius: theme.radius.lg, shadowColor: theme.colors.brand, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  submitBtn: { height: 54, borderRadius: theme.radius.lg, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 },
  submitText: { color: theme.colors.white, fontSize: 16, fontWeight: "800" },

  // Nav bar
  navBar: { flexDirection: "row", gap: 10, padding: 16, backgroundColor: theme.colors.white, borderTopWidth: 1, borderTopColor: theme.colors.border },

  // Modal
  modalScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", padding: 16, justifyContent: "flex-end" },
  modalCard: { backgroundColor: theme.colors.white, borderRadius: theme.radius.xl, padding: 20, ...Platform.select({ ios: { paddingBottom: 32 }, default: { paddingBottom: 16 } }) },
  modalTitle: { fontSize: 18, fontWeight: "800", color: theme.colors.text },
  modalSub:   { color: theme.colors.textLight, fontSize: 12, marginTop: 4, marginBottom: 4 },
  levelRow: { flexDirection: "row", gap: 6, marginVertical: 14, flexWrap: "wrap" },
  levelBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.full },
  levelText: { fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
});
