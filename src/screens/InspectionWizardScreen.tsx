import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Icon } from "../components/Icon";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Button } from "../components/Button";
import { Spinner } from "../components/Spinner";
import { supabase } from "../lib/supabase";
import { theme, formatKm } from "../lib/theme";
import { estimateValuation, getMarketValuation, type Valuation } from "../lib/valuation";
import { useAuth } from "../lib/auth";
import type { VehicleRow } from "../lib/types";

// Auto-save: persists wizard progress under a per-vehicle key so the
// inspector can pick up multiple drafts. A "new" inspection (no
// incomingId) lives at AUTOSAVE_KEY_NEW; existing vehicles use
// `${AUTOSAVE_KEY_PREFIX}${vehicleId}`. Drafts older than 14d expire.
const AUTOSAVE_KEY_PREFIX = "xpc_inspection_draft:";
const AUTOSAVE_KEY_NEW = `${AUTOSAVE_KEY_PREFIX}__new__`;
const AUTOSAVE_TTL_MS = 14 * 86400_000;

function autosaveKeyFor(vehicleId: string | null | undefined): string {
  return vehicleId ? `${AUTOSAVE_KEY_PREFIX}${vehicleId}` : AUTOSAVE_KEY_NEW;
}

export interface AutosavePayload {
  v: 1;
  ts: number;
  inspectorId: string | null;
  vehicleId: string | null;
  vehicleSummary?: string; // "2023 BMW X5" etc — surfaced in the drafts list.
  step: number;
  vin: string; make: string; model: string; year: string;
  mileage: string; color: string; city: string;
  sellerName: string; sellerPhone: string;
  startingPrice: string; reservePrice: string;
  notes?: string;
}

export { autosaveKeyFor as inspectionAutosaveKeyFor, AUTOSAVE_KEY_PREFIX as INSPECTION_AUTOSAVE_PREFIX };

// Resize + compress an image before upload. Max 1200px on the longest
// side; JPEG @ 80%. Drops a 5 MB photo to ~250-400 kB which uploads
// 10-20x faster on cellular and keeps Storage bills reasonable.
async function compressForUpload(uri: string): Promise<string> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
    );
    return result.uri;
  } catch {
    // If manipulation fails (rare — bad codec, OOM), fall back to the
    // original. Upload still proceeds, just slower.
    return uri;
  }
}

// Web-only image capture: a hidden <input type="file" accept="image/*"
// capture="environment"> that opens the rear camera on mobile Safari and falls
// back to the photo library elsewhere. Returns an object-URL the rest of the
// upload pipeline treats exactly like a native asset uri.
function pickImageWeb(): Promise<{ uri: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  return new Promise((resolve) => {
    const doc = g.document;
    if (!doc) { resolve(null); return; }
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.style.cssText = "position:fixed;left:-9999px;opacity:0";
    let settled = false;
    const finish = (val: { uri: string } | null) => {
      if (settled) return;
      settled = true;
      try { doc.body.removeChild(input); } catch { /* already gone */ }
      resolve(val);
    };
    input.onchange = () => {
      const file = input.files && input.files[0];
      finish(file ? { uri: g.URL.createObjectURL(file) } : null);
    };
    input.oncancel = () => finish(null);
    doc.body.appendChild(input);
    input.click();
  });
}

// Cross-platform alert. react-native-web's Alert is a no-op (no dialog, and
// button onPress callbacks never fire) — so on web we use the browser's
// blocking window.alert and run any follow-up (e.g. navigation) right after.
function notify(title: string, message?: string) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (typeof g.alert === "function") g.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

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

const MAX_OTHER_PHOTOS = 10;

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

interface DamageState {
  level: DamageLevel;
  description: string;
  photoUrl?: string;
}

const DOC_SLOTS = [
  { key: "registration",  label: "Registration" },
  { key: "service_book",  label: "Service book" },
  { key: "insurance",     label: "Insurance docs" },
] as const;

const STORAGE_BUCKET = "vehicle-photos";

type UploadKind = "photo" | "document" | "other" | "damage";

interface CapturedPhoto { local: string; remote: string | null }

// ---- Component ------------------------------------------------------

export function InspectionWizardScreen({
  route, navigation,
}: {
  // `viewMode` opens the screen in read-only view first (with an Edit
  // button up top). `readOnly` keeps the existing hard-locked behavior.
  route: { params?: { vehicleId?: string | null; readOnly?: boolean; viewMode?: boolean } };
  navigation: { goBack: () => void; navigate: (s: string) => void };
}) {
  const { user } = useAuth();
  const initialViewMode = !!route.params?.viewMode;
  const [viewMode, setViewMode] = useState(initialViewMode);
  // readOnly = either explicitly passed OR the user hasn't tapped Edit yet.
  const readOnly = !!route.params?.readOnly || viewMode;
  const incomingId = route.params?.vehicleId ?? null;
  // Stable key for AsyncStorage — per-vehicle so we can keep multiple drafts.
  const autosaveKey = autosaveKeyFor(incomingId);

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
  // Auction pricing — captured here so the admin sees the inspector's
  // recommendation when reviewing the vehicle.  Both are EUR; reserve is
  // optional (admin may set it later).
  const [startingPrice, setStartingPrice] = useState("");
  const [reservePrice,  setReservePrice]  = useState("");
  // Free-text inspector notes → saved to vehicles.inspection_notes so the
  // buyer/web condition report can show them.
  const [notes, setNotes] = useState("");

  // Market estimate + auto-fill. Auto-fills starting=avg / reserve=min until
  // the inspector edits a price (or for an existing vehicle with saved prices).
  // Instant reference-table estimate, upgraded to live market data (debounced)
  // when make/model/year are filled in.
  const [pricesTouched, setPricesTouched] = useState<boolean>(!!incomingId);
  const referenceEstimate = useMemo<Valuation | null>(() => {
    if (!make.trim() || !model.trim() || !year.trim()) return null;
    return estimateValuation({ make, model, year: Number(year), mileageKm: Number(mileage) || undefined });
  }, [make, model, year, mileage]);
  const [liveValuation, setLiveValuation] = useState<Valuation | null>(null);
  useEffect(() => {
    setLiveValuation(null);
    if (!make.trim() || !model.trim() || !year.trim()) return;
    let on = true;
    const id = setTimeout(() => {
      getMarketValuation({ make, model, year: Number(year), mileageKm: Number(mileage) || undefined })
        .then((v) => { if (on && v.source === "market_data") setLiveValuation(v); });
    }, 600);
    return () => { on = false; clearTimeout(id); };
  }, [make, model, year, mileage]);
  const marketEstimate = liveValuation ?? referenceEstimate;
  useEffect(() => {
    if (!marketEstimate || pricesTouched || readOnly) return;
    setStartingPrice(String(marketEstimate.avgEur));
    setReservePrice(String(marketEstimate.minEur));
  }, [marketEstimate, pricesTouched, readOnly]);

  // Photo state — record of slot key -> { local URI from camera (shown
  // instantly), remote public URL after Storage upload (used on submit).
  // Decoupling the two means the thumbnail appears the moment the picker
  // returns even if the network upload is slow or fails.
  const [photos, setPhotos] = useState<Record<string, CapturedPhoto>>({});
  const [otherPhotos, setOtherPhotos] = useState<CapturedPhoto[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);

  // Damage state — record of panel name -> { level, description, photoUrl? }
  const [damages, setDamages] = useState<Record<string, DamageState>>({});
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
        setStartingPrice(v.listed_price_eur != null ? String(v.listed_price_eur) : "");
        setReservePrice(v.reserve_price_eur != null ? String(v.reserve_price_eur) : "");
        setNotes(v.inspection_notes ?? "");
      }
      setLoading(false);
    })();
  }, [incomingId]);

  // ---- Auto-save restore on mount -----------------------------------
  // Restores any draft (by vehicle id, or the __new__ slot for fresh
  // inspections). Existing vehicles also support drafts now so an
  // inspector mid-edit doesn't lose typed changes.
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(autosaveKey);
        if (!raw) return;
        const data = JSON.parse(raw) as AutosavePayload;
        if (data.v !== 1) return;
        if (data.inspectorId && user?.id && data.inspectorId !== user.id) return;
        if (Date.now() - data.ts > AUTOSAVE_TTL_MS) {
          await AsyncStorage.removeItem(autosaveKey);
          return;
        }
        if (!data.vin && !data.make && !data.model) return;
        setVin(data.vin); setMake(data.make); setModel(data.model); setYear(data.year);
        setMileage(data.mileage); setColor(data.color); setCity(data.city);
        setSellerName(data.sellerName); setSellerPhone(data.sellerPhone);
        setStartingPrice(data.startingPrice); setReservePrice(data.reservePrice);
        if (data.startingPrice || data.reservePrice) setPricesTouched(true);
        setNotes(data.notes ?? "");
        setStep(data.step);
        setRestoredAt(data.ts);
      } catch { /* corrupt payload — skip */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveKey]);

  // ---- Auto-save write on changes -----------------------------------
  // Persists under the per-vehicle key — works for both new inspections
  // and partial edits to existing vehicles.
  useEffect(() => {
    if (viewMode) return; // don't write while the wizard is read-only-view
    const summary = year && make && model ? `${year} ${make} ${model}` : undefined;
    const payload: AutosavePayload = {
      v: 1, ts: Date.now(),
      inspectorId: user?.id ?? null,
      vehicleId: incomingId,
      vehicleSummary: summary,
      step,
      vin, make, model, year, mileage, color, city,
      sellerName, sellerPhone, startingPrice, reservePrice,
      notes,
    };
    void AsyncStorage.setItem(autosaveKey, JSON.stringify(payload)).catch(() => {});
  }, [
    autosaveKey, viewMode, incomingId, user, step,
    vin, make, model, year, mileage, color, city,
    sellerName, sellerPhone, startingPrice, reservePrice,
    notes,
  ]);

  // ---- Helpers ------------------------------------------------------

  const ensureBucket = useCallback(async () => {
    try { await supabase.storage.createBucket(STORAGE_BUCKET, { public: true }); } catch { /* already exists */ }
  }, []);

  const uploadOne = useCallback(async (
    slotKey: string,
    asset: { uri: string },
    prefix: "photos" | "documents" | "other" | "damages",
  ) => {
    await ensureBucket();
    const ts  = Date.now();
    const safe = slotKey.replace(/[^a-z0-9-]+/gi, "_").toLowerCase();
    // On web the asset is already a blob: object-URL from the file input —
    // skip expo-image-manipulator (flaky/deprecated on web) and upload the blob
    // directly. On native, compress to 1200px / 80% JPEG first.
    const sourceUri = Platform.OS === "web" ? asset.uri : await compressForUpload(asset.uri);
    const key = `${prefix}/${user?.id ?? "anon"}/${ts}-${safe}.jpg`;

    const res = await fetch(sourceUri);
    const blob = await res.blob();
    console.log(`[upload] ${slotKey} -> ${key} (${blob.size}b ${blob.type || "image/jpeg"})`);

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(key, blob, { contentType: blob.type || "image/jpeg", upsert: false });
    if (error) { console.error(`[upload] storage error (${slotKey}):`, JSON.stringify(error)); throw error; }

    const { data: publicUrl } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(key);
    console.log(`[upload] ${slotKey} OK -> ${publicUrl.publicUrl.slice(0, 70)}`);
    return publicUrl.publicUrl;
  }, [ensureBucket, user]);

  const takePhoto = async (slotKey: string, kind: UploadKind) => {
    if (readOnly) return;
    // Web: an HTML file input with accept=image/* + capture=environment, which
    // opens the rear camera on mobile Safari. Native: the device camera.
    let asset: { uri: string };
    if (Platform.OS === "web") {
      const picked = await pickImageWeb();
      if (!picked) return;
      asset = picked;
    } else {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        notify("Camera disabled", "Grant camera access in Settings to capture photos.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      asset = result.assets[0];
    }
    const localUri = asset.uri;
    console.log(`[InspectionWizard] takePhoto: got local URI for ${slotKey}: ${localUri.slice(0, 60)}…`);

    // STEP 1 — push the local URI into state immediately so the slot shows
    // the captured thumbnail before the upload completes (or even if it
    // fails). This was the bug: the slot stayed empty when upload was slow
    // or silently failed against Storage RLS.
    if (kind === "photo") {
      setPhotos((p) => ({ ...p, [slotKey]: { local: localUri, remote: null } }));
    } else if (kind === "other") {
      setOtherPhotos((arr) => [...arr, { local: localUri, remote: null }]);
    } else if (kind === "damage") {
      setDamages((d) => ({
        ...d,
        [slotKey]: { ...(d[slotKey] ?? { level: "cosmetic", description: "" }), photoUrl: localUri },
      }));
    } else if (kind === "document") {
      setDocs((d) => ({ ...d, [slotKey]: localUri }));
    }
    // Track the array index for "other" so the upload can patch the right
    // entry — we appended just above so it's the current array length - 1.
    const otherIndex = kind === "other" ? otherPhotos.length : -1;

    // STEP 2 — upload to Storage and patch the remote URL when it lands.
    setUploading(slotKey);
    try {
      const prefix =
        kind === "document" ? "documents"
        : kind === "damage" ? "damages"
        : kind === "other"  ? "other"
        : "photos";
      const url = await uploadOne(slotKey, asset, prefix);
      console.log(`[InspectionWizard] takePhoto: upload OK for ${slotKey}: ${url.slice(0, 60)}…`);
      if (kind === "photo") {
        setPhotos((p) => ({ ...p, [slotKey]: { local: localUri, remote: url } }));
      } else if (kind === "document") {
        setDocs((d) => ({ ...d, [slotKey]: url }));
      } else if (kind === "other") {
        setOtherPhotos((arr) => arr.map((entry, i) => i === otherIndex ? { local: entry.local, remote: url } : entry));
      } else if (kind === "damage") {
        setDamages((d) => ({
          ...d,
          [slotKey]: { ...(d[slotKey] ?? { level: "cosmetic", description: "" }), photoUrl: url },
        }));
      }
    } catch (e) {
      const msg = (e as Error).message ?? "Unknown error";
      console.warn(`[InspectionWizard] takePhoto: upload FAILED for ${slotKey}: ${msg}`);
      notify("Upload failed", `${msg}\n\nThe photo is still on your device — try again or submit later.`);
    } finally {
      setUploading(null);
    }
  };

  const removeOtherPhoto = (i: number) =>
    setOtherPhotos((arr) => arr.filter((_, idx) => idx !== i));

  // ---- Damage editor ------------------------------------------------
  const setDamage = (panel: string, level: DamageLevel, description?: string) => {
    setDamages((d) => ({
      ...d,
      [panel]: {
        level,
        description: description ?? d[panel]?.description ?? "",
        photoUrl:    d[panel]?.photoUrl,
      },
    }));
  };

  // ---- Submit -------------------------------------------------------
  const submit = async () => {
    console.log("[submit] start", { platform: Platform.OS, hasUser: !!user, userId: user?.id, vehicleId: vehicle.id ?? "(new)" });
    if (!user) { notify("Sign in required", "Your session expired — sign in again before submitting."); return; }
    if (!vin || !make || !model || !year) {
      notify("Missing details", "VIN, make, model and year are required.");
      setStep(1);
      return;
    }
    if (!startingPrice || Number(startingPrice) <= 0) {
      notify("Starting price required", "Enter a starting price for the auction.");
      setStep(1);
      return;
    }
    if (reservePrice && Number(reservePrice) < Number(startingPrice)) {
      notify("Reserve too low", "Reserve price cannot be below the starting price.");
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
        listed_price_eur: Number(startingPrice) || 0,
        reserve_price_eur: reservePrice ? Number(reservePrice) : null,
        inspection_notes: notes.trim() || null,
      };

      console.log("[submit] saving vehicle", { mode: vehicleId ? "update" : "insert", status: vehiclePayload.status, inspector_id: vehiclePayload.inspector_id });
      if (vehicleId) {
        const { error } = await supabase.from("vehicles").update(vehiclePayload).eq("id", vehicleId);
        if (error) { console.error("[submit] vehicle UPDATE error:", JSON.stringify(error)); throw error; }
        console.log("[submit] vehicle updated OK:", vehicleId);
      } else {
        const { data, error } = await supabase
          .from("vehicles")
          .insert({ ...vehiclePayload, created_by: user.id })
          .select("id")
          .single();
        if (error) { console.error("[submit] vehicle INSERT error:", JSON.stringify(error)); throw error; }
        vehicleId = (data as { id: string }).id;
        console.log("[submit] vehicle inserted OK:", vehicleId);
      }
      if (!vehicleId) throw new Error("Couldn't create vehicle");

      // Required + interior + engine photos — only ones that finished
      // uploading to Storage make it into the DB; locally-only photos are
      // skipped (the inspector can re-take or re-submit).
      const photoRows = Object.entries(photos)
        .filter(([, p]) => !!p.remote)
        .map(([slot, p], i) => ({
          vehicle_id: vehicleId!,
          url: p.remote!,
          category:   slot.startsWith("interior") ? "interior" : slot === "engine" ? "engine" : slot === "trunk" ? "interior" : "exterior",
          sort_order: i,
          caption:    PHOTO_SLOTS.find((s) => s.key === slot)?.label ?? slot,
        }));

      // Only persist documents that finished uploading to Storage — a local
      // file:// URI would be unreadable by the buyer/web apps.
      const docRows = Object.entries(docs)
        .filter(([, url]) => /^https?:\/\//.test(url))
        .map(([slot, url]) => ({
          vehicle_id: vehicleId!,
          url,
          category: "documents",
          sort_order: 100,
          caption:    DOC_SLOTS.find((s) => s.key === slot)?.label ?? slot,
        }));

      // Additional photos — anything noteworthy beyond the 12 required shots.
      const otherRows = otherPhotos
        .filter((p) => !!p.remote)
        .map((p, i) => ({
          vehicle_id: vehicleId!,
          url: p.remote!,
          category: "other",
          sort_order: 200 + i,
          caption:  `Additional photo ${i + 1}`,
        }));

      console.log("[submit] photos:", { capturedSlots: Object.keys(photos).length, uploaded: photoRows.length, docs: docRows.length, other: otherRows.length });
      if (photoRows.length + docRows.length + otherRows.length > 0) {
        const { error } = await supabase.from("vehicle_photos").insert([...photoRows, ...docRows, ...otherRows]);
        if (error) { console.error("[submit] vehicle_photos INSERT error:", JSON.stringify(error)); throw error; }
        console.log("[submit] vehicle_photos inserted OK");
      }

      // Damages — now carry photo_url straight onto the vehicle_damages row.
      const damageRows = Object.entries(damages)
        .filter(([, d]) => d.level !== "none")
        .map(([panel, d]) => ({
          vehicle_id: vehicleId!,
          location: panel,
          description: d.description || `${d.level} damage on ${panel}`,
          severity: d.level === "none" ? "cosmetic" : d.level,
          // Only store a remote Storage URL — a not-yet-uploaded local file://
          // URI would be unreadable by the buyer/web condition report.
          photo_url: d.photoUrl && /^https?:\/\//.test(d.photoUrl) ? d.photoUrl : null,
        }));
      console.log("[submit] damages:", damageRows.length);
      if (damageRows.length > 0) {
        const { error } = await supabase.from("vehicle_damages").insert(damageRows);
        if (error) { console.error("[submit] vehicle_damages INSERT error:", JSON.stringify(error)); throw error; }
        console.log("[submit] vehicle_damages inserted OK");
      }

      // Submission succeeded — clear the drafts so the dashboard list updates.
      void AsyncStorage.removeItem(autosaveKey).catch(() => {});
      void AsyncStorage.removeItem(AUTOSAVE_KEY_NEW).catch(() => {});

      console.log("[submit] SUCCESS — inspection saved for vehicle", vehicleId);
      // react-native-web's Alert is a no-op, so the original success dialog
      // (with navigation in its button callback) silently did nothing on web —
      // that was the "doesn't submit" bug. Show a web-safe message, then
      // navigate directly.
      notify("Inspection submitted", "Vehicle is now ready for listing.");
      navigation.goBack();
    } catch (e) {
      const err = e as { message?: string; details?: string; hint?: string; code?: string };
      console.error("[submit] FAILED:", JSON.stringify(err));
      notify("Submit failed", err?.message || err?.details || err?.hint || "Unknown error — check the browser console.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner label="Loading vehicle…" />;

  const currentStep = STEPS.find((s) => s.n === step)!;
  const photoProgress = Object.keys(photos).length / PHOTO_SLOTS.length;
  const docProgress   = Object.keys(docs).length / DOC_SLOTS.length;
  const damagedPanelsWithoutPhoto = Object.entries(damages)
    .filter(([, d]) => d.level !== "none" && !d.photoUrl).length;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      // Stepper sits at the top + the system status bar — give the
      // keyboard offset enough room so the price inputs don't end up
      // pushed off-screen when the keyboard opens.
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <Stepper step={step} />

      {viewMode && (
        <View style={styles.viewBanner}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="eye-outline" size={16} color={theme.colors.brand} />
            <Text style={styles.viewBannerText}>Viewing inspection (read-only).</Text>
          </View>
          <Pressable
            onPress={() => setViewMode(false)}
            style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.92 }]}
          >
            <Icon name="create-outline" size={14} color={theme.colors.white} />
            <Text style={styles.editBtnText}>Edit</Text>
          </Pressable>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {restoredAt && (
          <View style={styles.resumeBanner}>
            <Icon name="cloud-done-outline" size={16} color={theme.colors.brand} />
            <Text style={styles.resumeText}>Resumed draft inspection from earlier session.</Text>
            <Pressable
              hitSlop={8}
              onPress={() => {
                Alert.alert("Discard draft?", "Clear the auto-saved fields and start fresh?", [
                  { text: "Keep", style: "cancel" },
                  { text: "Discard", style: "destructive", onPress: () => {
                    void AsyncStorage.removeItem(autosaveKey);
                    setVin(""); setMake(""); setModel(""); setYear("");
                    setMileage(""); setColor(""); setCity("Dubai");
                    setSellerName(""); setSellerPhone("");
                    setStartingPrice(""); setReservePrice(""); setNotes("");
                    setStep(1); setRestoredAt(null);
                  } },
                ]);
              }}
            >
              <Icon name="close" size={16} color={theme.colors.textMuted} />
            </Pressable>
          </View>
        )}
        <View style={styles.stepHeader}>
          <View style={styles.stepHeaderIcon}>
            <Icon name={currentStep.icon} size={20} color={theme.colors.brand} />
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

            {/* Live market estimate from make/model/year/mileage. */}
            {marketEstimate && (
              <View style={styles.estCard}>
                <View style={styles.estHeaderRow}>
                  <Icon name="pricetag-outline" size={14} color={theme.colors.brand} />
                  <Text style={styles.estTitle}>Market estimate</Text>
                </View>
                <View style={styles.estCols}>
                  <EstCol label="Min" value={marketEstimate.minEur} />
                  <EstCol label="Avg" value={marketEstimate.avgEur} highlight />
                  <EstCol label="Max" value={marketEstimate.maxEur} />
                </View>
                <Text style={styles.estNote}>
                  {marketEstimate.source === "market_data"
                    ? `Based on ${marketEstimate.dataPoints} comparable listings`
                    : "Estimated from market data — starting price & reserve pre-filled, adjust as needed"}
                </Text>
              </View>
            )}

            {/* Pricing — sent to the admin panel with the rest of the
                inspection. Admin can still override either value. */}
            <View style={styles.priceHeader}>
              <Icon name="pricetag-outline" size={14} color={theme.colors.brand} />
              <Text style={styles.priceHeaderText}>Auction pricing</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label="Starting price (EUR)" required style={{ flex: 1 }}>
                <TextInput
                  value={startingPrice}
                  onChangeText={(v) => { setStartingPrice(v.replace(/[^0-9]/g, "")); setPricesTouched(true); }}
                  keyboardType="number-pad"
                  style={styles.input}
                  editable={!readOnly}
                  placeholder="35000"
                  placeholderTextColor={theme.colors.textLight}
                />
              </Field>
              <Field label="Reserve price (EUR)" style={{ flex: 1 }}>
                <TextInput
                  value={reservePrice}
                  onChangeText={(v) => { setReservePrice(v.replace(/[^0-9]/g, "")); setPricesTouched(true); }}
                  keyboardType="number-pad"
                  style={styles.input}
                  editable={!readOnly}
                  placeholder="optional"
                  placeholderTextColor={theme.colors.textLight}
                />
              </Field>
            </View>
            <Text style={styles.priceHint}>
              Starting price kicks off the auction. Reserve is the lowest the seller will accept — admin can still override either.
            </Text>
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
                      <Image source={{ uri: photos[s.key].local }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      <View style={styles.photoOverlay}>
                        <Icon
                          name={photos[s.key].remote ? "checkmark" : "cloud-upload-outline"}
                          size={14}
                          color={theme.colors.white}
                        />
                      </View>
                    </>
                  ) : (
                    <View style={styles.photoEmpty}>
                      <Icon name="camera" size={22} color={theme.colors.textLight} />
                      <Text style={styles.photoLabel}>{s.label}</Text>
                      {uploading === s.key && <ActivityIndicator size="small" color={theme.colors.brand} style={{ marginTop: 4 }} />}
                    </View>
                  )}
                </Pressable>
              ))}
            </View>

            {/* Additional photos — anything noteworthy beyond the 12 required */}
            <View style={styles.divider} />
            <View style={styles.subHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.subTitle}>Additional photos</Text>
                <Text style={styles.subTip}>Custom mods, special features, extra damage angles. Up to {MAX_OTHER_PHOTOS}.</Text>
              </View>
              <View style={styles.countPill}>
                <Text style={styles.countPillText}>{otherPhotos.length} / {MAX_OTHER_PHOTOS}</Text>
              </View>
            </View>

            {otherPhotos.length < MAX_OTHER_PHOTOS && !readOnly && (
              <Pressable
                onPress={() => takePhoto(`other-${Date.now()}`, "other")}
                disabled={uploading !== null}
                style={({ pressed }) => [styles.addPhotoBtn, pressed && { opacity: 0.92 }]}
              >
                <Icon name="add-circle-outline" size={20} color={theme.colors.brand} />
                <Text style={styles.addPhotoText}>Add Photo</Text>
                {uploading?.startsWith("other-") && (
                  <ActivityIndicator size="small" color={theme.colors.brand} style={{ marginLeft: 6 }} />
                )}
              </Pressable>
            )}

            {otherPhotos.length > 0 && (
              <View style={[styles.photoGrid, { marginTop: 12 }]}>
                {otherPhotos.map((entry, i) => (
                  <View key={`${entry.local}-${i}`} style={[styles.photoTile, styles.photoTileDone]}>
                    <Image source={{ uri: entry.local }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    <View style={styles.photoOverlay}>
                      <Icon
                        name={entry.remote ? "checkmark" : "cloud-upload-outline"}
                        size={14}
                        color={theme.colors.white}
                      />
                    </View>
                    {!readOnly && (
                      <Pressable
                        onPress={() => removeOtherPhoto(i)}
                        hitSlop={6}
                        style={styles.removeBtn}
                      >
                        <Icon name="close" size={14} color={theme.colors.white} />
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {step === 3 && (
          <View>
            <Text style={styles.tip}>Walk around the car and tag every panel that has damage.</Text>

            {damagedPanelsWithoutPhoto > 0 && (
              <View style={styles.warnBanner}>
                <Icon name="camera-outline" size={16} color={theme.colors.warning} />
                <Text style={styles.warnText}>
                  {damagedPanelsWithoutPhoto} damaged panel{damagedPanelsWithoutPhoto === 1 ? "" : "s"} still need a photo.
                </Text>
              </View>
            )}

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
                        <Icon name="warning-outline" size={11} color={theme.colors.warning} />
                        <Text style={styles.panelGroupBadgeText}>{sectionDamageCount} reported</Text>
                      </View>
                    ) : (
                      <View style={[styles.panelGroupBadge, { backgroundColor: theme.colors.successBg }]}>
                        <Icon name="checkmark-circle" size={11} color={theme.colors.success} />
                        <Text style={[styles.panelGroupBadgeText, { color: theme.colors.success }]}>clear</Text>
                      </View>
                    )}
                  </View>
                  {sec.panels.map((p) => {
                    const d = damages[p];
                    const level = d?.level ?? "none";
                    const damaged = level !== "none";
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
                        {damaged && !readOnly && (
                          <Pressable
                            onPress={() => takePhoto(p, "damage")}
                            disabled={uploading !== null}
                            hitSlop={6}
                            style={({ pressed }) => [
                              styles.damagePhotoBtn,
                              d?.photoUrl && styles.damagePhotoBtnDone,
                              pressed && { opacity: 0.85 },
                            ]}
                          >
                            {d?.photoUrl ? (
                              <Image source={{ uri: d.photoUrl }} style={styles.damageThumb} contentFit="cover" />
                            ) : uploading === p ? (
                              <ActivityIndicator size="small" color={theme.colors.brand} />
                            ) : (
                              <Icon name="camera" size={18} color={theme.colors.brand} />
                            )}
                          </Pressable>
                        )}
                        {damaged && readOnly && d?.photoUrl && (
                          <View style={[styles.damagePhotoBtn, styles.damagePhotoBtnDone]}>
                            <Image source={{ uri: d.photoUrl }} style={styles.damageThumb} contentFit="cover" />
                          </View>
                        )}
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
              hasPhoto={!!(pickerOpen && damages[pickerOpen.panel]?.photoUrl)}
              onTakePhoto={() => {
                if (pickerOpen) {
                  setPickerOpen(null);
                  // Defer the camera launch so the modal can dismiss cleanly.
                  setTimeout(() => takePhoto(pickerOpen.panel, "damage"), 250);
                }
              }}
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
                      <View style={styles.photoOverlay}><Icon name="checkmark" size={14} color={theme.colors.white} /></View>
                    </>
                  ) : (
                    <View style={styles.photoEmpty}>
                      <Icon name="document-text-outline" size={22} color={theme.colors.textLight} />
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

              {startingPrice && (
                <View style={styles.reviewPriceRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewPriceLabel}>Starting price</Text>
                    <Text style={styles.reviewPriceValue}>€{Number(startingPrice).toLocaleString("en-GB")}</Text>
                  </View>
                  {reservePrice && (
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reviewPriceLabel}>Reserve</Text>
                      <Text style={styles.reviewPriceValue}>€{Number(reservePrice).toLocaleString("en-GB")}</Text>
                    </View>
                  )}
                </View>
              )}
            </Card>

            <View style={styles.summaryRow}>
              <SummaryCard icon="camera-outline"      value={`${Object.keys(photos).length}/${PHOTO_SLOTS.length}`} label="Photos"    complete={Object.keys(photos).length === PHOTO_SLOTS.length} />
              <SummaryCard icon="images-outline"      value={String(otherPhotos.length)}                            label="Other" />
              <SummaryCard icon="warning-outline"     value={String(Object.values(damages).filter((d) => d.level !== "none").length)} label="Damages" />
              <SummaryCard icon="folder-open-outline" value={`${Object.keys(docs).length}/${DOC_SLOTS.length}`}     label="Docs"      complete={Object.keys(docs).length === DOC_SLOTS.length} />
            </View>

            {damagedPanelsWithoutPhoto > 0 && (
              <View style={[styles.warnBanner, { marginTop: 16 }]}>
                <Icon name="alert-circle-outline" size={16} color={theme.colors.warning} />
                <Text style={styles.warnText}>
                  {damagedPanelsWithoutPhoto} damaged panel{damagedPanelsWithoutPhoto === 1 ? "" : "s"} missing a photo. You can still submit, but buyers see only the severity tag.
                </Text>
              </View>
            )}

            {/* Inspector notes — saved to the vehicle so buyers see them in
                the condition report. */}
            <View style={[styles.card, { marginTop: 16 }]}>
              <View style={styles.priceHeader}>
                <Icon name="create-outline" size={14} color={theme.colors.brand} />
                <Text style={styles.priceHeaderText}>Inspector notes</Text>
              </View>
              {readOnly ? (
                <Text style={styles.reviewSub}>{notes.trim() || "No notes added."}</Text>
              ) : (
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  placeholder="Overall condition, mechanical notes, anything buyers should know…"
                  placeholderTextColor={theme.colors.textLight}
                  style={[styles.input, { height: 96, paddingTop: 10, textAlignVertical: "top" }]}
                />
              )}
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
                  <Icon name="checkmark-done-outline" size={20} color={theme.colors.white} />
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
    </KeyboardAvoidingView>
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
                  <Icon name="checkmark" size={14} color={theme.colors.white} />
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

function EstCol({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={styles.estCol}>
      <Text style={styles.estColLabel}>{label}</Text>
      <Text style={[styles.estColValue, highlight && { color: theme.colors.brand }]}>
        €{value.toLocaleString("en-GB")}
      </Text>
    </View>
  );
}

function SummaryCard({ icon, value, label, complete }: { icon: string; value: string; label: string; complete?: boolean }) {
  return (
    <View style={styles.summaryItem}>
      <Icon name={icon} size={18} color={complete ? theme.colors.success : theme.colors.textMuted} />
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
  open, panel, initial, hasPhoto, onClose, onSave, onTakePhoto,
}: {
  open: boolean;
  panel: string;
  initial: { level: DamageLevel; description: string };
  hasPhoto: boolean;
  onClose: () => void;
  onSave: (level: DamageLevel, description: string) => void;
  onTakePhoto: () => void;
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

          {level !== "none" && (
            <Pressable
              onPress={onTakePhoto}
              style={({ pressed }) => [styles.modalPhotoBtn, pressed && { opacity: 0.92 }]}
            >
              <Icon name={hasPhoto ? "camera" : "camera-outline"} size={18} color={theme.colors.brand} />
              <Text style={styles.modalPhotoText}>
                {hasPhoto ? "Retake damage photo" : "Take damage photo"}
              </Text>
            </Pressable>
          )}

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

  // Resume banner
  resumeBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, marginBottom: 12,
    backgroundColor: theme.colors.brandLight,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: "#b2ddff",
  },
  resumeText: { flex: 1, fontSize: 12, color: theme.colors.brandDark, fontWeight: "700" },

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
  priceHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, marginBottom: 8 },
  priceHeaderText: { fontSize: 12, fontWeight: "800", color: theme.colors.brand, textTransform: "uppercase", letterSpacing: 0.5 },
  priceHint: { fontSize: 11, color: theme.colors.textLight, lineHeight: 16, marginTop: 4 },

  // Market estimate card
  estCard: { marginTop: 8, marginBottom: 4, padding: 14, borderRadius: theme.radius.lg, backgroundColor: theme.colors.brandLight, borderWidth: 1, borderColor: "#b2ddff" },
  estHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  estTitle: { fontSize: 12, fontWeight: "800", color: theme.colors.brand, textTransform: "uppercase", letterSpacing: 0.5 },
  estCols: { flexDirection: "row", gap: 8 },
  estCol: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: theme.radius.md, backgroundColor: theme.colors.white },
  estColLabel: { fontSize: 10, fontWeight: "800", color: theme.colors.textLight, textTransform: "uppercase", letterSpacing: 0.5 },
  estColValue: { fontSize: 15, fontWeight: "800", color: theme.colors.text, marginTop: 3 },
  estNote: { fontSize: 11, color: theme.colors.textMuted, marginTop: 10, lineHeight: 15 },

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
  removeBtn: {
    position: "absolute", top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(217, 45, 32, 0.95)",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },

  // "Other" sub-section
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 22 },
  subHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  subTitle:  { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  subTip:    { fontSize: 11, color: theme.colors.textLight, marginTop: 2 },
  countPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.full, backgroundColor: theme.colors.brandLight },
  countPillText: { fontSize: 11, fontWeight: "800", color: theme.colors.brand },
  addPhotoBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 50, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.colors.brand, borderStyle: "dashed",
    backgroundColor: theme.colors.brandLight,
  },
  addPhotoText: { color: theme.colors.brand, fontWeight: "800", fontSize: 14 },

  // Damage warning banner
  warnBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderRadius: theme.radius.lg, marginBottom: 14,
    backgroundColor: theme.colors.warningBg, borderWidth: 1, borderColor: "#fedf89",
  },
  warnText: { color: theme.colors.warning, fontSize: 12, fontWeight: "700", flex: 1 },

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
  panelRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 14, backgroundColor: theme.colors.white,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg,
    marginBottom: 8,
  },
  panelName: { fontSize: 14, fontWeight: "700", color: theme.colors.text },
  panelDesc: { fontSize: 11, color: theme.colors.textLight, marginTop: 2 },
  severityTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.full },
  severityText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase" },

  damagePhotoBtn: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: theme.colors.brandLight,
    borderWidth: 1, borderColor: theme.colors.brand, borderStyle: "dashed",
    alignItems: "center", justifyContent: "center",
    overflow: "hidden",
  },
  damagePhotoBtnDone: {
    borderStyle: "solid",
    borderColor: theme.colors.success,
  },
  damageThumb: { width: "100%", height: "100%" },

  // Review step
  reviewEyebrow: { fontSize: 10, fontWeight: "800", color: theme.colors.textLight, textTransform: "uppercase", letterSpacing: 0.5 },
  reviewTitle: { fontSize: 20, fontWeight: "800", color: theme.colors.text, marginTop: 4 },
  reviewSub: { fontSize: 12, color: theme.colors.textLight, marginTop: 4 },
  reviewPriceRow: { flexDirection: "row", marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.colors.border, gap: 12 },
  reviewPriceLabel: { fontSize: 10, fontWeight: "800", color: theme.colors.textLight, textTransform: "uppercase", letterSpacing: 0.4 },
  reviewPriceValue: { fontSize: 16, fontWeight: "800", color: theme.colors.brand, marginTop: 4 },
  summaryRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  summaryItem: { flex: 1, padding: 12, alignItems: "center", borderRadius: theme.radius.lg, backgroundColor: theme.colors.white, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  summaryNum: { fontSize: 18, fontWeight: "800", color: theme.colors.text, marginTop: 4 },
  summaryLabel: { fontSize: 10, color: theme.colors.textLight, marginTop: 2, textTransform: "uppercase", fontWeight: "700", letterSpacing: 0.4 },
  submitShadow: { marginTop: 20, borderRadius: theme.radius.lg, shadowColor: theme.colors.brand, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  submitBtn: { height: 54, borderRadius: theme.radius.lg, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 },
  submitText: { color: theme.colors.white, fontSize: 16, fontWeight: "800" },

  // Nav bar
  navBar: { flexDirection: "row", gap: 10, padding: 16, backgroundColor: theme.colors.white, borderTopWidth: 1, borderTopColor: theme.colors.border },

  // View-mode banner (read-only with an Edit toggle)
  viewBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: theme.colors.brandLight,
    borderBottomWidth: 1, borderBottomColor: "#b2ddff",
  },
  viewBannerText: { fontSize: 12, fontWeight: "700", color: theme.colors.brandDark },
  editBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brand,
  },
  editBtnText: { color: theme.colors.white, fontSize: 12, fontWeight: "800" },

  // Modal
  modalScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", padding: 16, justifyContent: "flex-end" },
  modalCard: { backgroundColor: theme.colors.white, borderRadius: theme.radius.xl, padding: 20, ...Platform.select({ ios: { paddingBottom: 32 }, default: { paddingBottom: 16 } }) },
  modalTitle: { fontSize: 18, fontWeight: "800", color: theme.colors.text },
  modalSub:   { color: theme.colors.textLight, fontSize: 12, marginTop: 4, marginBottom: 4 },
  levelRow: { flexDirection: "row", gap: 6, marginVertical: 14, flexWrap: "wrap" },
  levelBtn: { paddingHorizontal: 14, minHeight: 44, justifyContent: "center", borderRadius: theme.radius.full },
  levelText: { fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  modalPhotoBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 14, height: 46, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.colors.brand, borderStyle: "dashed",
    backgroundColor: theme.colors.brandLight,
  },
  modalPhotoText: { color: theme.colors.brand, fontWeight: "800", fontSize: 14 },
});
