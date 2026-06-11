import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { confirmAsync } from "../lib/ui";
import { estimateValuation, getMarketValuation, type Valuation } from "../lib/valuation";
import { useAuth } from "../lib/auth";
import { useTranslation, panelLabelKey } from "../lib/i18n";
import type { VehicleRow } from "../lib/types";
import { SearchableSelect, type SelectOption } from "../components/SearchableSelect";
import {
  ALL_MAKES, POPULAR_MAKES, MARKET_SPECS, modelsForMake, isKnownMake, isKnownModel,
} from "../lib/vehicleData";
import { decodeVin, isValidVin, type DecodedVin, type FuelType, type Transmission } from "../lib/vinDecoder";
import { base64ToBytes } from "../lib/bytes";

type TFunc = (key: string, values?: Record<string, string | number>) => string;

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
  // VIN-decoder / extra attributes (all optional so older drafts still parse).
  bodyType?: string; engine?: string; drivetrain?: string;
  transmission?: string; fuelType?: string; marketSpec?: string;
}

export { autosaveKeyFor as inspectionAutosaveKeyFor, AUTOSAVE_KEY_PREFIX as INSPECTION_AUTOSAVE_PREFIX };

// Resize + compress an image before upload. Max 1200px on the longest
// side; JPEG @ 80%. Drops a 5 MB photo to ~250-400 kB which uploads
// 10-20x faster on cellular and keeps Storage bills reasonable.
//
// Returns the compressed `base64` too (base64: true) — on native we upload
// those decoded bytes directly, because fetch(file://).blob() yields a Blob
// whose bytes don't cross the RN bridge and Storage ends up with a 0-byte file.
async function compressForUpload(uri: string): Promise<{ uri: string; base64: string | null }> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    return { uri: result.uri, base64: result.base64 ?? null };
  } catch {
    // If manipulation fails (rare — bad codec, OOM), fall back to the
    // original URI with no base64; uploadOne then reads bytes via fetch.
    return { uri, base64: null };
  }
}

// Read a stored object's byte size via the list API (metadata only — no body
// download). Returns null if it can't be determined. Used to reject 0-byte
// uploads before they become a vehicle_photos row.
async function uploadedSize(key: string): Promise<number | null> {
  try {
    const slash = key.lastIndexOf("/");
    const folder = key.slice(0, slash);
    const name = key.slice(slash + 1);
    const { data } = await supabase.storage.from(STORAGE_BUCKET).list(folder, { search: name, limit: 100 });
    const obj = data?.find((o) => o.name === name);
    const size = (obj?.metadata as { size?: number } | undefined)?.size;
    return typeof size === "number" ? size : null;
  } catch {
    return null;
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
// `tkey` is the display translation key; the step still has a stable `n`.
const STEPS = [
  { n: 1, tkey: "step.details",   icon: "document-text-outline" as const },
  { n: 2, tkey: "step.photos",    icon: "camera-outline" as const },
  { n: 3, tkey: "step.damage",    icon: "warning-outline" as const },
  { n: 4, tkey: "step.documents", icon: "folder-open-outline" as const },
  { n: 5, tkey: "step.review",    icon: "checkmark-done-outline" as const },
] as const;

// Photo capture is organised into collapsible sections. Each slot's `label`
// is the canonical English caption stored on the vehicle_photos row (read by
// the web/admin/buyer apps); `tkey` is the on-screen label. The section's
// `category` is the vehicle_photos.category enum value for every slot in it.
interface PhotoSlot { key: string; label: string; tkey: string }
interface PhotoSection { key: string; tkey: string; category: string; icon: string; slots: PhotoSlot[] }

const PHOTO_SECTIONS: PhotoSection[] = [
  {
    key: "exterior", tkey: "photos.section.exterior", category: "exterior", icon: "car-sport-outline",
    slots: [
      { key: "ext_front",        label: "Front",                  tkey: "photos.slot.ext_front" },
      { key: "ext_rear",         label: "Rear",                   tkey: "photos.slot.ext_rear" },
      { key: "ext_left",         label: "Left side (full)",       tkey: "photos.slot.ext_left" },
      { key: "ext_right",        label: "Right side (full)",      tkey: "photos.slot.ext_right" },
      { key: "ext_front_left",   label: "Front-left 3/4",         tkey: "photos.slot.ext_front_left" },
      { key: "ext_front_right",  label: "Front-right 3/4",        tkey: "photos.slot.ext_front_right" },
      { key: "ext_rear_left",    label: "Rear-left 3/4",          tkey: "photos.slot.ext_rear_left" },
      { key: "ext_rear_right",   label: "Rear-right 3/4",         tkey: "photos.slot.ext_rear_right" },
      { key: "ext_wheel_fl",     label: "Front-left wheel",       tkey: "photos.slot.ext_wheel_fl" },
      { key: "ext_wheel_fr",     label: "Front-right wheel",      tkey: "photos.slot.ext_wheel_fr" },
      { key: "ext_wheel_rl",     label: "Rear-left wheel",        tkey: "photos.slot.ext_wheel_rl" },
      { key: "ext_wheel_rr",     label: "Rear-right wheel",       tkey: "photos.slot.ext_wheel_rr" },
      { key: "ext_roof",         label: "Roof / sunroof",         tkey: "photos.slot.ext_roof" },
    ],
  },
  {
    key: "interior", tkey: "photos.section.interior", category: "interior", icon: "checkmark-circle",
    slots: [
      { key: "int_driver_seat",     label: "Driver seat",                 tkey: "photos.slot.int_driver_seat" },
      { key: "int_passenger_seat",  label: "Passenger front seat",        tkey: "photos.slot.int_passenger_seat" },
      { key: "int_rear_seats",      label: "Rear seats",                  tkey: "photos.slot.int_rear_seats" },
      { key: "int_dashboard",       label: "Dashboard (full)",            tkey: "photos.slot.int_dashboard" },
      { key: "int_cluster",         label: "Instrument cluster (mileage)", tkey: "photos.slot.int_cluster" },
      { key: "int_console",         label: "Center console / infotainment", tkey: "photos.slot.int_console" },
      { key: "int_driver_door",     label: "Driver door panel",           tkey: "photos.slot.int_driver_door" },
      { key: "int_passenger_door",  label: "Passenger door panel",        tkey: "photos.slot.int_passenger_door" },
      { key: "int_headliner",       label: "Headliner / ceiling",         tkey: "photos.slot.int_headliner" },
      { key: "int_boot",            label: "Trunk / boot interior",       tkey: "photos.slot.int_boot" },
    ],
  },
  {
    key: "engine", tkey: "photos.section.engine", category: "engine", icon: "pricetag-outline",
    slots: [
      { key: "eng_bay",        label: "Engine bay (full)",        tkey: "photos.slot.eng_bay" },
      { key: "eng_block",      label: "Engine block close-up",    tkey: "photos.slot.eng_block" },
      { key: "eng_vin_plate",  label: "VIN plate under hood",     tkey: "photos.slot.eng_vin_plate" },
    ],
  },
  {
    key: "undercarriage", tkey: "photos.section.undercarriage", category: "undercarriage", icon: "warning-outline",
    slots: [
      { key: "und_front",  label: "Front undercarriage",          tkey: "photos.slot.und_front" },
      { key: "und_rear",   label: "Rear undercarriage (exhaust)", tkey: "photos.slot.und_rear" },
    ],
  },
  {
    key: "documents", tkey: "photos.section.documents", category: "documents", icon: "document-text-outline",
    slots: [
      { key: "doc_vin_jamb",     label: "VIN plate (door jamb)",     tkey: "photos.slot.doc_vin_jamb" },
      { key: "doc_registration", label: "Registration / Mulkiya",    tkey: "photos.slot.doc_registration" },
    ],
  },
];

// Flat slot list + key→{label,category} lookup used on submit.
const ALL_PHOTO_SLOTS: Array<PhotoSlot & { category: string }> =
  PHOTO_SECTIONS.flatMap((s) => s.slots.map((sl) => ({ ...sl, category: s.category })));
const TOTAL_PHOTO_SLOTS = ALL_PHOTO_SLOTS.length;
const PHOTO_SLOT_BY_KEY: Record<string, { label: string; category: string }> =
  Object.fromEntries(ALL_PHOTO_SLOTS.map((s) => [s.key, { label: s.label, category: s.category }]));

const MAX_OTHER_PHOTOS = 10;

// Vehicle attribute enums surfaced as inline pill selectors (auto-fillable
// from the VIN decoder, overridable by the inspector). Values are the DB enums.
const FUEL_TYPES: FuelType[] = ["petrol", "diesel", "hybrid", "electric"];
const TRANSMISSIONS: Transmission[] = ["automatic", "manual"];

// Grouped damage panels — each entry maps to a labelled section so the
// inspector can move through the car visually instead of scanning a flat
// list.  An ASCII car outline at the top of the step orients the user.
// Panel names are the canonical English values stored as vehicle_damages.location
// AND used as keys in the damages state map — they must NOT be translated here.
// `tkey` translates only the section header; individual panels are translated at
// render time via panelLabelKey().
const PANEL_SECTIONS: ReadonlyArray<{ key: string; tkey: string; panels: readonly string[] }> = [
  { key: "front", tkey: "damage.section.front", panels: ["Front bumper", "Hood",       "Windshield"] },
  { key: "left",  tkey: "damage.section.left",  panels: ["Left front door",   "Left rear door",   "Left fender"] },
  { key: "right", tkey: "damage.section.right", panels: ["Right front door", "Right rear door",  "Right fender"] },
  { key: "rear",  tkey: "damage.section.rear",  panels: ["Rear bumper", "Trunk lid"] },
  { key: "top",   tkey: "damage.section.top",   panels: ["Roof"] },
] as const;

const DAMAGE_LEVELS = ["none", "cosmetic", "minor", "moderate", "major"] as const;
type DamageLevel = (typeof DAMAGE_LEVELS)[number];

interface DamageState {
  level: DamageLevel;
  description: string;
  photoUrl?: string;
}

// `label` is the canonical English caption stored on the vehicle_photos row;
// `tkey` is the on-screen label.
const DOC_SLOTS = [
  { key: "registration",  label: "Registration",   tkey: "docs.slot.registration" },
  { key: "service_book",  label: "Service book",   tkey: "docs.slot.service_book" },
  { key: "insurance",     label: "Insurance docs", tkey: "docs.slot.insurance" },
] as const;

const STORAGE_BUCKET = "vehicle-photos";

type UploadKind = "photo" | "document" | "other" | "damage" | "paint";

interface CapturedPhoto { local: string; remote: string | null }

// ---- Component ------------------------------------------------------

export function InspectionWizardScreen({
  route, navigation,
}: {
  // `viewMode` opens the screen in read-only view first (with an Edit
  // button up top). `readOnly` keeps the existing hard-locked behavior.
  route: { params?: { vehicleId?: string | null; readOnly?: boolean; viewMode?: boolean } };
  navigation: { goBack: () => void; navigate: (s: string) => void; setOptions: (o: Record<string, unknown>) => void };
}) {
  const { user } = useAuth();
  const { t } = useTranslation();
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

  // Extra vehicle attributes — auto-fillable from the VIN decoder, all
  // overridable by the inspector. transmission/fuelType map to DB enums.
  const [bodyType, setBodyType] = useState("");
  const [engine, setEngine] = useState("");
  const [drivetrain, setDrivetrain] = useState("");
  const [transmission, setTransmission] = useState<Transmission | "">("");
  const [fuelType, setFuelType] = useState<FuelType | "">("");
  // Market spec (regional variant) — required for listing. Stored on
  // vehicles.market_spec and shown on the web specs grid.
  const [marketSpec, setMarketSpec] = useState("");

  // Make/Model are searchable dropdowns; *Other flags switch a field to a
  // free-text input for values not in the reference list.
  const [makeOther, setMakeOther] = useState(false);
  const [modelOther, setModelOther] = useState(false);
  const [makePickerOpen, setMakePickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [marketPickerOpen, setMarketPickerOpen] = useState(false);

  // VIN decoder state. `decoded` drives the "Decoded" badges; `manuallyEdited`
  // (a ref so it doesn't retrigger the decode effect) protects inspector edits
  // from being clobbered by a later decode. Results are cached per-VIN for the
  // session so an unchanged VIN never re-hits the API.
  const [decoded, setDecoded] = useState<Record<string, true>>({});
  const manuallyEditedRef = useRef<Set<string>>(new Set());
  const decodeCacheRef = useRef<Map<string, DecodedVin | null>>(new Map());
  const lastDecodedVinRef = useRef<string>("");
  const [vinStatus, setVinStatus] = useState<"idle" | "decoding" | "ok" | "fail" | "invalid">("idle");

  // Photo step — which sections are expanded (exterior open by default).
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ exterior: true });

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
  // Paint thickness gauge reading — a single photo of the tester, separate
  // from damage panels. Persisted as a vehicle_photos row, category "paint_thickness".
  const [paintThickness, setPaintThickness] = useState<CapturedPhoto | null>(null);

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
        setBodyType(v.body_type ?? "");
        setEngine(v.engine ?? "");
        setDrivetrain(v.drivetrain ?? "");
        if (v.transmission === "automatic" || v.transmission === "manual") setTransmission(v.transmission);
        if (v.fuel_type === "petrol" || v.fuel_type === "diesel" || v.fuel_type === "hybrid" || v.fuel_type === "electric") setFuelType(v.fuel_type);
        setMarketSpec(v.market_spec ?? "");
        setMarketOther(!!v.market_spec && !MARKET_SPECS.some((m) => m.value === v.market_spec));
        // Unknown make/model load straight into free-text mode.
        setMakeOther(!!v.make && !isKnownMake(v.make));
        setModelOther(!!v.model && !isKnownModel(v.make ?? "", v.model));
        // Saved DB values are authoritative — don't auto-decode this VIN on
        // mount and clobber them. (Editing the VIN to a new value re-enables it.)
        lastDecodedVinRef.current = (v.vin ?? "").trim().toUpperCase();
        // Treat populated fields as manual input so a later VIN re-decode only
        // fills blanks rather than overwriting saved values.
        const edited = manuallyEditedRef.current;
        for (const [k, val] of Object.entries({
          make: v.make, model: v.model, year: v.year, bodyType: v.body_type,
          engine: v.engine, drivetrain: v.drivetrain, transmission: v.transmission, fuelType: v.fuel_type,
        })) { if (val) edited.add(k); }
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
        setBodyType(data.bodyType ?? ""); setEngine(data.engine ?? ""); setDrivetrain(data.drivetrain ?? "");
        if (data.transmission === "automatic" || data.transmission === "manual") setTransmission(data.transmission);
        if (data.fuelType === "petrol" || data.fuelType === "diesel" || data.fuelType === "hybrid" || data.fuelType === "electric") setFuelType(data.fuelType);
        setMarketSpec(data.marketSpec ?? "");
        setMarketOther(!!data.marketSpec && !MARKET_SPECS.some((m) => m.value === data.marketSpec));
        setMakeOther(!!data.make && !isKnownMake(data.make));
        setModelOther(!!data.model && !isKnownModel(data.make, data.model));
        // Don't re-decode a VIN we already auto-saved past.
        if (data.vin) lastDecodedVinRef.current = data.vin.trim().toUpperCase();
        // Protect drafted values from a later VIN re-decode (fills blanks only).
        const edited = manuallyEditedRef.current;
        for (const [k, val] of Object.entries({
          make: data.make, model: data.model, year: data.year, bodyType: data.bodyType,
          engine: data.engine, drivetrain: data.drivetrain, transmission: data.transmission, fuelType: data.fuelType,
        })) { if (val) edited.add(k); }
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
      bodyType, engine, drivetrain,
      transmission: transmission || undefined,
      fuelType: fuelType || undefined,
      marketSpec: marketSpec || undefined,
    };
    void AsyncStorage.setItem(autosaveKey, JSON.stringify(payload)).catch(() => {});
  }, [
    autosaveKey, viewMode, incomingId, user, step,
    vin, make, model, year, mileage, color, city,
    sellerName, sellerPhone, startingPrice, reservePrice,
    notes, bodyType, engine, drivetrain, transmission, fuelType, marketSpec,
  ]);

  // Market spec "Other" → free-text mode (set explicitly on load / restore).
  const [marketOther, setMarketOther] = useState(false);

  // ---- VIN decoder (auto.dev) ---------------------------------------
  // Mark a field as manually edited so a later VIN decode won't clobber it,
  // and drop its "Decoded" badge.
  const markEdited = useCallback((field: string) => {
    manuallyEditedRef.current.add(field);
    setDecoded((prev) => {
      if (!prev[field]) return prev;
      const cp = { ...prev }; delete cp[field]; return cp;
    });
  }, []);

  // Apply a decoded VIN to the form — only fields the inspector hasn't touched.
  // Stable (no state deps): make/model are validated against the DECODED make
  // (d.make), so there's no stale-closure read, and the decode effect below
  // can depend on it without re-running per make change.
  const applyDecoded = useCallback((d: DecodedVin) => {
    const edited = manuallyEditedRef.current;
    const next: Record<string, true> = {};
    // Make + model arrive together from the VIN. Only apply the decoded model
    // when we also own the make (the inspector hasn't overridden it), so we
    // never attach a model that belongs to a different make.
    const ownMake = !edited.has("make");
    if (ownMake && d.make) { setMake(d.make); setMakeOther(!isKnownMake(d.make)); next.make = true; }
    if (ownMake && d.model && !edited.has("model")) {
      setModel(d.model);
      setModelOther(!isKnownModel(d.make ?? "", d.model));
      next.model = true;
    }
    if (d.year && !edited.has("year")) { setYear(d.year); next.year = true; }
    if (d.bodyType && !edited.has("bodyType")) { setBodyType(d.bodyType); next.bodyType = true; }
    if (d.engine && !edited.has("engine")) { setEngine(d.engine); next.engine = true; }
    if (d.drivetrain && !edited.has("drivetrain")) { setDrivetrain(d.drivetrain); next.drivetrain = true; }
    if (d.transmission && !edited.has("transmission")) { setTransmission(d.transmission); next.transmission = true; }
    if (d.fuelType && !edited.has("fuelType")) { setFuelType(d.fuelType); next.fuelType = true; }
    if (Object.keys(next).length) setDecoded((prev) => ({ ...prev, ...next }));
  }, []);

  // Debounced auto-decode: fires once the VIN is a valid 17 chars and differs
  // from the last one handled. Results (incl. misses) are cached per session.
  // applyDecoded is stable (empty deps), so this never re-runs on a decode.
  useEffect(() => {
    if (readOnly) { setVinStatus("idle"); return; }
    const v = vin.trim().toUpperCase();
    if (!isValidVin(v)) {
      // Non-empty but not a complete/valid 17-char VIN. Nudge only once it's a
      // near-complete entry (avoids nagging mid-typing). A 16-char / wrong-length
      // VIN lands here — previously it sat silently "idle", which users mistook
      // for a broken decoder.
      setVinStatus(v.length >= 11 ? "invalid" : "idle");
      return;
    }
    if (v === lastDecodedVinRef.current) return;

    let on = true;
    const timer = setTimeout(async () => {
      lastDecodedVinRef.current = v;
      let data = decodeCacheRef.current.get(v);
      if (data === undefined) {
        setVinStatus("decoding");
        const res = await decodeVin(v);
        data = res.ok ? (res.data ?? null) : null;
        decodeCacheRef.current.set(v, data);
      }
      if (!on) return;
      if (!data) { setVinStatus("fail"); return; }
      applyDecoded(data);
      setVinStatus("ok");
    }, 500);
    return () => { on = false; clearTimeout(timer); };
  }, [vin, readOnly, applyDecoded]);

  // ---- Make / Model / Market pickers --------------------------------
  const onSelectMake = useCallback((value: string) => {
    markEdited("make");
    markEdited("model");
    setMakePickerOpen(false);
    setMakeOther(false);
    setMake(value);
    // Changing make invalidates the model unless it's still valid for the new make.
    setModel((prevModel) => (isKnownModel(value, prevModel) ? prevModel : ""));
    setModelOther(false);
  }, [markEdited]);

  const onMakeOther = useCallback(() => {
    markEdited("make");
    setMakePickerOpen(false);
    setMakeOther(true);
    setMake("");
    setModel(""); setModelOther(true); markEdited("model");
  }, [markEdited]);

  const onSelectModel = useCallback((value: string) => {
    markEdited("model");
    setModelPickerOpen(false);
    setModelOther(false);
    setModel(value);
  }, [markEdited]);

  const onModelOther = useCallback(() => {
    markEdited("model");
    setModelPickerOpen(false);
    setModelOther(true);
    setModel("");
  }, [markEdited]);

  // Option lists for the searchable pickers.
  const makeOptions = useMemo<SelectOption[]>(
    () => ALL_MAKES.map((m, i) => ({
      value: m.value,
      label: m.label ?? m.value,
      keywords: [m.value.toLowerCase(), ...(m.aliases ?? []), ...(m.label ? [m.label.toLowerCase()] : [])],
      group: i < POPULAR_MAKES.length ? t("details.makePopular") : t("details.makeAll"),
    })),
    [t],
  );
  const modelOptions = useMemo<SelectOption[]>(
    () => modelsForMake(make).map((m) => ({ value: m, label: m })),
    [make],
  );
  const marketOptions = useMemo<SelectOption[]>(
    () => MARKET_SPECS.map((m) => ({ value: m.value, label: t(m.tkey) })),
    [t],
  );
  // Display helpers for the select boxes (canonical value → friendly label).
  const makeDisplay = useMemo(() => (make ? (ALL_MAKES.find((m) => m.value === make)?.label ?? make) : ""), [make]);
  const marketDisplay = useMemo(() => {
    const found = MARKET_SPECS.find((m) => m.value === marketSpec);
    return found ? t(found.tkey) : marketSpec;
  }, [marketSpec, t]);

  // ---- Helpers ------------------------------------------------------

  const uploadOne = useCallback(async (
    slotKey: string,
    asset: { uri: string },
    prefix: "photos" | "documents" | "other" | "damages",
  ) => {
    const ts  = Date.now();
    const safe = slotKey.replace(/[^a-z0-9-]+/gi, "_").toLowerCase();
    const key = `${prefix}/${user?.id ?? "anon"}/${ts}-${safe}.jpg`;

    // Build the upload body as REAL bytes. On web the file-input object-URL
    // blob uploads fine (browser fetch reads file bodies). On native,
    // fetch(file://).blob() hands Supabase a 0-byte body, so we compress to
    // JPEG with base64:true and upload the decoded bytes (the official RN
    // pattern). A fetch().arrayBuffer() fallback covers the rare case where
    // manipulation can't emit base64.
    let body: Blob | Uint8Array;
    let contentType = "image/jpeg";
    if (Platform.OS === "web") {
      const blob = await (await fetch(asset.uri)).blob();
      if (blob.size === 0) throw new Error(t("submit.uploadEmptyBody"));
      body = blob;
      contentType = blob.type || "image/jpeg";
    } else {
      const { base64 } = await compressForUpload(asset.uri);
      let bytes: Uint8Array | null = base64 ? base64ToBytes(base64) : null;
      if (!bytes || bytes.byteLength === 0) {
        try {
          const ab = await (await fetch(asset.uri)).arrayBuffer();
          bytes = new Uint8Array(ab);
        } catch { /* leave null → guarded below */ }
      }
      if (!bytes || bytes.byteLength === 0) throw new Error(t("submit.uploadEmptyBody"));
      body = bytes;
    }

    const size = body instanceof Uint8Array ? body.byteLength : body.size;

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(key, body, { contentType, upsert: false });
    if (error) { if (__DEV__) console.error(`[upload] storage error (${slotKey}):`, JSON.stringify(error)); throw error; }

    // Defense-in-depth: confirm the STORED object is non-zero. If it landed
    // empty, delete it and fail so we never persist a vehicle_photos row that
    // points at a 0-byte file. (null = couldn't verify; local bytes already
    // checked > 0, so we let it through.)
    const stored = await uploadedSize(key);
    if (stored === 0) {
      await supabase.storage.from(STORAGE_BUCKET).remove([key]).catch(() => {});
      if (__DEV__) console.error(`[upload] 0-byte object stored for ${slotKey} — removed`);
      throw new Error(t("submit.uploadEmptyBody"));
    }

    const { data: publicUrl } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(key);
    return publicUrl.publicUrl;
  }, [user, t]);

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
        notify(t("submit.cameraOff"), t("submit.cameraOffBody"));
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

    // STEP 1 — push the local URI into state immediately so the slot shows
    // the captured thumbnail before the upload completes (or even if it
    // fails). This was the bug: the slot stayed empty when upload was slow
    // or silently failed against Storage RLS.
    if (kind === "photo") {
      setPhotos((p) => ({ ...p, [slotKey]: { local: localUri, remote: null } }));
    } else if (kind === "paint") {
      setPaintThickness({ local: localUri, remote: null });
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
      if (kind === "photo") {
        setPhotos((p) => ({ ...p, [slotKey]: { local: localUri, remote: url } }));
      } else if (kind === "paint") {
        setPaintThickness({ local: localUri, remote: url });
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
      if (__DEV__) console.warn(`[InspectionWizard] takePhoto: upload FAILED for ${slotKey}: ${msg}`);
      notify(t("submit.uploadFailed"), t("submit.uploadFailedBody", { msg }));
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
    if (!user) { notify(t("submit.signInRequired"), t("submit.signInRequiredBody")); return; }
    if (!vin || !make || !model || !year) {
      notify(t("submit.missingDetails"), t("submit.missingDetailsBody"));
      setStep(1);
      return;
    }
    if (!startingPrice || Number(startingPrice) <= 0) {
      notify(t("submit.startPriceReq"), t("submit.startPriceReqBody"));
      setStep(1);
      return;
    }
    if (reservePrice && Number(reservePrice) < Number(startingPrice)) {
      notify(t("submit.reserveLow"), t("submit.reserveLowBody"));
      setStep(1);
      return;
    }
    if (!marketSpec.trim()) {
      notify(t("submit.marketSpecReq"), t("submit.marketSpecReqBody"));
      setStep(1);
      return;
    }
    setSubmitting(true);
    try {
      let vehicleId = vehicle.id;

      // Re-submitting a vehicle the admin sent back goes straight to
      // pending_review; a normal inspection completes as "inspected".
      const nextStatus: "inspected" | "pending_review" =
        vehicle.status === "changes_requested" ? "pending_review" : "inspected";

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
        fuel_type: fuelType || vehicle.fuel_type || "petrol",
        transmission: transmission || vehicle.transmission || "automatic",
        body_type: bodyType.trim() || null,
        engine: engine.trim() || null,
        drivetrain: drivetrain.trim() || null,
        market_spec: marketSpec.trim() || null,
        status: nextStatus,
        seller_name: sellerName || vehicle.seller_name || "Walk-in",
        seller_phone: sellerPhone || vehicle.seller_phone || "+971-",
        inspector_id: user.id,
        inspection_date: new Date().toISOString(),
        listed_price_eur: Number(startingPrice) || 0,
        reserve_price_eur: reservePrice ? Number(reservePrice) : null,
        inspection_notes: notes.trim() || null,
      };

      if (vehicleId) {
        const { error } = await supabase.from("vehicles").update(vehiclePayload).eq("id", vehicleId);
        if (error) { if (__DEV__) console.error("[submit] vehicle UPDATE error:", JSON.stringify(error)); throw error; }
      } else {
        const { data, error } = await supabase
          .from("vehicles")
          .insert({ ...vehiclePayload, created_by: user.id })
          .select("id")
          .single();
        if (error) { if (__DEV__) console.error("[submit] vehicle INSERT error:", JSON.stringify(error)); throw error; }
        vehicleId = (data as { id: string }).id;
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
          category:   PHOTO_SLOT_BY_KEY[slot]?.category ?? "exterior",
          sort_order: i,
          caption:    PHOTO_SLOT_BY_KEY[slot]?.label ?? slot,
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

      // Additional photos — anything noteworthy beyond the required shots.
      // NOTE: the vehicle_photos.category enum has no 'other' value
      // (exterior/interior/engine/undercarriage/documents/damage/paint_thickness),
      // so these are stored as 'exterior' (they still show in the buyer gallery,
      // which groups every non-paint_thickness photo). sort_order 200+ keeps them
      // after the required shots so they never become the card thumbnail.
      const otherRows = otherPhotos
        .filter((p) => !!p.remote)
        .map((p, i) => ({
          vehicle_id: vehicleId!,
          url: p.remote!,
          category: "exterior",
          sort_order: 200 + i,
          caption:  `Additional photo ${i + 1}`,
        }));

      // Paint thickness gauge reading — its own category so the buyer
      // condition report and admin panel can surface it distinctly.
      const paintRows = paintThickness?.remote
        ? [{
            vehicle_id: vehicleId!,
            url: paintThickness.remote,
            category: "paint_thickness",
            sort_order: 300,
            caption: "Paint thickness gauge reading",
          }]
        : [];

      if (photoRows.length + docRows.length + otherRows.length + paintRows.length > 0) {
        const { error } = await supabase.from("vehicle_photos").insert([...photoRows, ...docRows, ...otherRows, ...paintRows]);
        if (error) { if (__DEV__) console.error("[submit] vehicle_photos INSERT error:", JSON.stringify(error)); throw error; }
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
      if (damageRows.length > 0) {
        const { error } = await supabase.from("vehicle_damages").insert(damageRows);
        if (error) { if (__DEV__) console.error("[submit] vehicle_damages INSERT error:", JSON.stringify(error)); throw error; }
      }

      // Submission succeeded — clear the drafts so the dashboard list updates.
      void AsyncStorage.removeItem(autosaveKey).catch(() => {});
      void AsyncStorage.removeItem(AUTOSAVE_KEY_NEW).catch(() => {});

      // react-native-web's Alert is a no-op, so the original success dialog
      // (with navigation in its button callback) silently did nothing on web —
      // that was the "doesn't submit" bug. Show a web-safe message, then
      // navigate directly.
      notify(t("submit.ok"), nextStatus === "pending_review"
        ? t("submit.okResubmit")
        : t("submit.okSaved"));
      navigation.goBack();
    } catch (e) {
      const err = e as { message?: string; details?: string; hint?: string; code?: string };
      if (__DEV__) console.error("[submit] FAILED:", JSON.stringify(err));
      notify(t("submit.failed"), err?.message || err?.details || err?.hint || t("submit.failedBody"));
    } finally {
      setSubmitting(false);
    }
  };

  // Discard the in-progress inspection (web-safe confirm) and leave.
  const discardInspection = useCallback(async () => {
    const ok = await confirmAsync(
      t("wiz.discardQ"),
      t("wiz.discardBody"),
      t("common.discard"), true,
    );
    if (!ok) return;
    await AsyncStorage.removeItem(autosaveKey).catch(() => {});
    navigation.goBack();
  }, [autosaveKey, navigation, t]);

  // Header "Discard" button — abandon mid-inspection. Hidden in read-only view.
  useEffect(() => {
    navigation.setOptions({
      headerRight: readOnly ? undefined : () => (
        <Pressable onPress={discardInspection} hitSlop={8} style={styles.discardHeaderBtn}>
          <Icon name="close" size={15} color={theme.colors.error} />
          <Text style={styles.discardHeaderText}>{t("nav.discard")}</Text>
        </Pressable>
      ),
    });
  }, [navigation, discardInspection, readOnly, t]);

  if (loading) return <Spinner label={t("wiz.loadingVehicle")} />;

  const currentStep = STEPS.find((s) => s.n === step)!;
  const photoProgress = Object.keys(photos).length / TOTAL_PHOTO_SLOTS;
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
      <Stepper step={step} t={t} />

      {viewMode && (
        <View style={styles.viewBanner}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="eye-outline" size={16} color={theme.colors.brand} />
            <Text style={styles.viewBannerText}>{t("wiz.viewing")}</Text>
          </View>
          <Pressable
            onPress={() => setViewMode(false)}
            style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.92 }]}
          >
            <Icon name="create-outline" size={14} color={theme.colors.white} />
            <Text style={styles.editBtnText}>{t("common.edit")}</Text>
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
            <Text style={styles.resumeText}>{t("wiz.resumed")}</Text>
            <Pressable
              hitSlop={8}
              onPress={async () => {
                const ok = await confirmAsync(t("wiz.discardDraftQ"), t("wiz.discardDraftBody"), t("common.discard"), true);
                if (!ok) return;
                void AsyncStorage.removeItem(autosaveKey);
                setVin(""); setMake(""); setModel(""); setYear("");
                setMileage(""); setColor(""); setCity("Dubai");
                setSellerName(""); setSellerPhone("");
                setStartingPrice(""); setReservePrice(""); setNotes("");
                setBodyType(""); setEngine(""); setDrivetrain("");
                setTransmission(""); setFuelType(""); setMarketSpec("");
                setMakeOther(false); setModelOther(false); setMarketOther(false);
                setDecoded({}); manuallyEditedRef.current = new Set(); lastDecodedVinRef.current = "";
                setStep(1); setRestoredAt(null);
              }}
            >
              <Icon name="close" size={16} color={theme.colors.textMuted} />
            </Pressable>
          </View>
        )}
        {vehicle.status === "changes_requested" && (
          <View style={styles.changesReqBanner}>
            <Icon name="warning-outline" size={16} color={theme.colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.changesReqTitle}>{t("wiz.changesTitle")}</Text>
              {vehicle.review_notes ? <Text style={styles.changesReqText}>“{vehicle.review_notes}”</Text> : null}
              <Text style={styles.changesReqHint}>{t("wiz.changesHint")}</Text>
            </View>
          </View>
        )}

        <View style={styles.stepHeader}>
          <View style={styles.stepHeaderIcon}>
            <Icon name={currentStep.icon} size={20} color={theme.colors.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.stepEyebrow}>{t("wiz.stepOf", { n: step, total: STEPS.length })}</Text>
            <Text style={styles.stepTitle}>{t(currentStep.tkey)}</Text>
          </View>
        </View>

        {step === 1 && (
          <Card>
            {/* VIN — auto-decodes via auto.dev once 17 valid chars are entered. */}
            <Field
              label={t("details.vin")}
              required
              badge={
                vinStatus === "decoding" ? (
                  <View style={styles.decodingBadge}>
                    <ActivityIndicator size="small" color={theme.colors.brand} />
                    <Text style={styles.decodingText}>{t("details.vinDecoding")}</Text>
                  </View>
                ) : vinStatus === "ok" ? <DecodedBadge t={t} /> : null
              }
            >
              <TextInput value={vin} onChangeText={(v) => setVin(v.toUpperCase())} autoCapitalize="characters" maxLength={17} style={styles.input} editable={!readOnly} placeholder="WBA1234567890XXXX" placeholderTextColor={theme.colors.textLight} />
            </Field>
            {vinStatus === "invalid" && !readOnly && (
              <Text style={styles.vinFailText}>
                {vin.trim().length < 17
                  ? t("details.vinIncomplete", { count: vin.trim().length })
                  : t("details.vinDecodeFail")}
              </Text>
            )}
            {vinStatus === "fail" && !readOnly && (
              <Text style={styles.vinFailText}>{t("details.vinDecodeFail")}</Text>
            )}

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label={t("details.make")} required style={{ flex: 1 }} badge={decoded.make ? <DecodedBadge t={t} /> : null}>
                {makeOther ? (
                  <View>
                    <TextInput value={make} onChangeText={(v) => { markEdited("make"); setMake(v); }} style={styles.input} editable={!readOnly} placeholder={t("details.otherMakePlaceholder")} placeholderTextColor={theme.colors.textLight} />
                    {!readOnly && <Pressable onPress={() => { setMakeOther(false); setMakePickerOpen(true); }} hitSlop={6}><Text style={styles.pickFromList}>{t("details.pickFromList")}</Text></Pressable>}
                  </View>
                ) : (
                  <SelectField value={makeDisplay} placeholder={t("details.makeSelect")} onPress={() => setMakePickerOpen(true)} disabled={readOnly} />
                )}
              </Field>
              <Field label={t("details.year")} required style={{ flex: 1 }} badge={decoded.year ? <DecodedBadge t={t} /> : null}>
                <TextInput value={year} onChangeText={(v) => { markEdited("year"); setYear(v.replace(/[^0-9]/g, "")); }} keyboardType="number-pad" maxLength={4} style={styles.input} editable={!readOnly} placeholder="2023" placeholderTextColor={theme.colors.textLight} />
              </Field>
            </View>

            <Field label={t("details.model")} required badge={decoded.model ? <DecodedBadge t={t} /> : null}>
              {(modelOther || makeOther || modelOptions.length === 0) ? (
                <View>
                  <TextInput value={model} onChangeText={(v) => { markEdited("model"); setModel(v); }} style={styles.input} editable={!readOnly} placeholder={make ? t("details.otherModelPlaceholder") : t("details.modelSelectFirst")} placeholderTextColor={theme.colors.textLight} />
                  {!readOnly && !makeOther && modelOptions.length > 0 && (
                    <Pressable onPress={() => { setModelOther(false); setModelPickerOpen(true); }} hitSlop={6}><Text style={styles.pickFromList}>{t("details.pickFromList")}</Text></Pressable>
                  )}
                </View>
              ) : (
                <SelectField value={model} placeholder={make ? t("details.modelSelect") : t("details.modelSelectFirst")} onPress={() => setModelPickerOpen(true)} disabled={readOnly || !make} />
              )}
            </Field>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label={t("details.mileage")} style={{ flex: 1 }}><TextInput value={mileage} onChangeText={setMileage} keyboardType="number-pad" style={styles.input} editable={!readOnly} placeholder="42 000" placeholderTextColor={theme.colors.textLight} /></Field>
              <Field label={t("details.color")} style={{ flex: 1 }}><TextInput value={color} onChangeText={setColor} style={styles.input} editable={!readOnly} placeholder={t("details.colorExample")} placeholderTextColor={theme.colors.textLight} /></Field>
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label={t("details.bodyType")} style={{ flex: 1 }} badge={decoded.bodyType ? <DecodedBadge t={t} /> : null}><TextInput value={bodyType} onChangeText={(v) => { markEdited("bodyType"); setBodyType(v); }} style={styles.input} editable={!readOnly} placeholder={t("details.bodyTypeExample")} placeholderTextColor={theme.colors.textLight} /></Field>
              <Field label={t("details.engine")} style={{ flex: 1 }} badge={decoded.engine ? <DecodedBadge t={t} /> : null}><TextInput value={engine} onChangeText={(v) => { markEdited("engine"); setEngine(v); }} style={styles.input} editable={!readOnly} placeholder={t("details.engineExample")} placeholderTextColor={theme.colors.textLight} /></Field>
            </View>

            <Field label={t("details.transmission")} badge={decoded.transmission ? <DecodedBadge t={t} /> : null}>
              <PillGroup options={TRANSMISSIONS} value={transmission} onChange={(v) => { markEdited("transmission"); setTransmission(v as Transmission); }} render={(v) => t(`transmission.${v}`)} disabled={readOnly} />
            </Field>

            <Field label={t("details.fuelType")} badge={decoded.fuelType ? <DecodedBadge t={t} /> : null}>
              <PillGroup options={FUEL_TYPES} value={fuelType} onChange={(v) => { markEdited("fuelType"); setFuelType(v as FuelType); }} render={(v) => t(`fuel.${v}`)} disabled={readOnly} />
            </Field>

            <Field label={t("details.drivetrain")} badge={decoded.drivetrain ? <DecodedBadge t={t} /> : null}><TextInput value={drivetrain} onChangeText={(v) => { markEdited("drivetrain"); setDrivetrain(v); }} style={styles.input} editable={!readOnly} placeholder={t("details.drivetrainExample")} placeholderTextColor={theme.colors.textLight} /></Field>

            <Field label={t("details.marketSpec")} required>
              {marketOther ? (
                <View>
                  <TextInput value={marketSpec} onChangeText={setMarketSpec} style={styles.input} editable={!readOnly} placeholder={t("details.marketSpecOther")} placeholderTextColor={theme.colors.textLight} />
                  {!readOnly && <Pressable onPress={() => { setMarketOther(false); setMarketSpec(""); setMarketPickerOpen(true); }} hitSlop={6}><Text style={styles.pickFromList}>{t("details.pickFromList")}</Text></Pressable>}
                </View>
              ) : (
                <SelectField value={marketDisplay} placeholder={t("details.marketSpecSelect")} onPress={() => setMarketPickerOpen(true)} disabled={readOnly} />
              )}
            </Field>

            <Field label={t("details.city")}><TextInput value={city} onChangeText={setCity} style={styles.input} editable={!readOnly} /></Field>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label={t("details.sellerName")} style={{ flex: 1 }}><TextInput value={sellerName} onChangeText={setSellerName} style={styles.input} editable={!readOnly} placeholder="Ahmed Al Rashid" placeholderTextColor={theme.colors.textLight} /></Field>
              <Field label={t("details.sellerPhone")} style={{ flex: 1 }}><TextInput value={sellerPhone} onChangeText={setSellerPhone} keyboardType="phone-pad" style={styles.input} editable={!readOnly} placeholder="+971 50 …" placeholderTextColor={theme.colors.textLight} /></Field>
            </View>

            {/* Live market estimate from make/model/year/mileage. */}
            {marketEstimate && (
              <View style={styles.estCard}>
                <View style={styles.estHeaderRow}>
                  <Icon name="pricetag-outline" size={14} color={theme.colors.brand} />
                  <Text style={styles.estTitle}>{t("details.marketEstimate")}</Text>
                </View>
                <View style={styles.estCols}>
                  <EstCol label={t("details.min")} value={marketEstimate.minEur} />
                  <EstCol label={t("details.avg")} value={marketEstimate.avgEur} highlight />
                  <EstCol label={t("details.max")} value={marketEstimate.maxEur} />
                </View>
                <Text style={styles.estNote}>
                  {marketEstimate.source === "market_data"
                    ? t("details.estComparable", { count: marketEstimate.dataPoints })
                    : t("details.estReference")}
                </Text>
              </View>
            )}

            {/* Pricing — sent to the admin panel with the rest of the
                inspection. Admin can still override either value. */}
            <View style={styles.priceHeader}>
              <Icon name="pricetag-outline" size={14} color={theme.colors.brand} />
              <Text style={styles.priceHeaderText}>{t("details.pricing")}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label={t("details.startingPrice")} required style={{ flex: 1 }}>
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
              <Field label={t("details.reservePrice")} style={{ flex: 1 }}>
                <TextInput
                  value={reservePrice}
                  onChangeText={(v) => { setReservePrice(v.replace(/[^0-9]/g, "")); setPricesTouched(true); }}
                  keyboardType="number-pad"
                  style={styles.input}
                  editable={!readOnly}
                  placeholder={t("details.optional")}
                  placeholderTextColor={theme.colors.textLight}
                />
              </Field>
            </View>
            <Text style={styles.priceHint}>
              {t("details.pricingHint")}
            </Text>

            {/* Searchable dropdowns (Make / Model / Market spec). */}
            <SearchableSelect
              visible={makePickerOpen}
              title={t("details.makeSelect")}
              options={makeOptions}
              searchPlaceholder={t("common.search")}
              emptyLabel={t("common.noResults")}
              otherLabel={t("details.otherMake")}
              selected={make}
              onSelect={onSelectMake}
              onSelectOther={onMakeOther}
              onClose={() => setMakePickerOpen(false)}
            />
            <SearchableSelect
              visible={modelPickerOpen}
              title={t("details.modelSelect")}
              options={modelOptions}
              searchPlaceholder={t("common.search")}
              emptyLabel={t("common.noResults")}
              otherLabel={t("details.otherModel")}
              selected={model}
              onSelect={onSelectModel}
              onSelectOther={onModelOther}
              onClose={() => setModelPickerOpen(false)}
            />
            <SearchableSelect
              visible={marketPickerOpen}
              title={t("details.marketSpec")}
              options={marketOptions}
              searchPlaceholder={t("common.search")}
              emptyLabel={t("common.noResults")}
              otherLabel={t("details.marketOtherOption")}
              selected={marketSpec}
              onSelect={(v) => { setMarketPickerOpen(false); setMarketOther(false); setMarketSpec(v); }}
              onSelectOther={() => { setMarketPickerOpen(false); setMarketOther(true); setMarketSpec(""); }}
              onClose={() => setMarketPickerOpen(false)}
            />
          </Card>
        )}

        {step === 2 && (
          <View>
            <ProgressBar value={photoProgress} label={t("photos.progress", { done: Object.keys(photos).length, total: TOTAL_PHOTO_SLOTS })} />
            <Text style={styles.tip}>{t("photos.tip")}</Text>

            {PHOTO_SECTIONS.map((sec) => {
              const done = sec.slots.filter((sl) => photos[sl.key]).length;
              const total = sec.slots.length;
              const open = openSections[sec.key] ?? false;
              const complete = done === total;
              return (
                <View key={sec.key} style={styles.photoSection}>
                  <Pressable
                    onPress={() => setOpenSections((o) => ({ ...o, [sec.key]: !open }))}
                    style={({ pressed }) => [styles.photoSectionHeader, pressed && { opacity: 0.92 }]}
                  >
                    <Icon name={sec.icon} size={18} color={complete ? theme.colors.success : theme.colors.brand} />
                    <Text style={styles.photoSectionTitle}>{t(sec.tkey)}</Text>
                    <View style={[styles.photoSectionCount, complete && styles.photoSectionCountDone]}>
                      {complete && <Icon name="checkmark" size={11} color={theme.colors.white} />}
                      <Text style={[styles.photoSectionCountText, complete && { color: theme.colors.white }]}>{done}/{total}</Text>
                    </View>
                    <Icon name={open ? "chevron-up" : "chevron-down"} size={18} color={theme.colors.textMuted} />
                  </Pressable>
                  {open && (
                    <View style={[styles.photoGrid, styles.photoSectionGrid]}>
                      {sec.slots.map((s) => (
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
                              <Text style={styles.photoLabel}>{t(s.tkey)}</Text>
                              {uploading === s.key && <ActivityIndicator size="small" color={theme.colors.brand} style={{ marginTop: 4 }} />}
                            </View>
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}

            {/* Additional photos — anything noteworthy beyond the 12 required */}
            <View style={styles.divider} />
            <View style={styles.subHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.subTitle}>{t("photos.additional")}</Text>
                <Text style={styles.subTip}>{t("photos.additionalSub", { max: MAX_OTHER_PHOTOS })}</Text>
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
                <Text style={styles.addPhotoText}>{t("photos.add")}</Text>
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
            <Text style={styles.tip}>{t("damage.tip")}</Text>

            {/* Paint Thickness Test — separate from damage panels. */}
            <View style={styles.paintCard}>
              <View style={styles.paintHeader}>
                <Icon name="color-palette-outline" size={16} color={theme.colors.brand} />
                <Text style={styles.paintTitle}>{t("damage.paintTitle")}</Text>
              </View>
              <Text style={styles.paintSub}>
                {t("damage.paintSub")}
              </Text>
              <Pressable
                onPress={() => takePhoto("paint_thickness", "paint")}
                disabled={readOnly || uploading !== null}
                style={({ pressed }) => [styles.paintCapture, pressed && { opacity: 0.9 }]}
              >
                {paintThickness ? (
                  <Image source={{ uri: paintThickness.remote ?? paintThickness.local }} style={styles.paintThumb} contentFit="cover" />
                ) : uploading === "paint_thickness" ? (
                  <ActivityIndicator size="small" color={theme.colors.brand} />
                ) : (
                  <>
                    <Icon name="camera" size={20} color={theme.colors.brand} />
                    <Text style={styles.paintCaptureText}>{t("damage.paintCapture")}</Text>
                  </>
                )}
              </Pressable>
            </View>

            {damagedPanelsWithoutPhoto > 0 && (
              <View style={styles.warnBanner}>
                <Icon name="camera-outline" size={16} color={theme.colors.warning} />
                <Text style={styles.warnText}>
                  {damagedPanelsWithoutPhoto === 1
                    ? t("damage.needPhotoOne")
                    : t("damage.needPhotoMany", { count: damagedPanelsWithoutPhoto })}
                </Text>
              </View>
            )}

            {/* Simple ASCII car outline — orientation aid for the inspector. */}
            <View style={styles.carOutline}>
              <Text style={styles.carOutlineLabel}>{t("damage.outFront")}</Text>
              <View style={styles.carOutlineMid}>
                <Text style={styles.carOutlineSide}>L</Text>
                <View style={styles.carOutlineBody}>
                  <Text style={styles.carOutlineRoof}>▢ {t("damage.outRoof")} ▢</Text>
                </View>
                <Text style={styles.carOutlineSide}>R</Text>
              </View>
              <Text style={styles.carOutlineLabel}>{t("damage.outRear")}</Text>
            </View>

            {PANEL_SECTIONS.map((sec) => {
              const sectionDamageCount = sec.panels.filter((p) => damages[p] && damages[p].level !== "none").length;
              return (
                <View key={sec.key} style={styles.panelGroup}>
                  <View style={styles.panelGroupHeader}>
                    <Text style={styles.panelGroupTitle}>{t(sec.tkey)}</Text>
                    {sectionDamageCount > 0 ? (
                      <View style={styles.panelGroupBadge}>
                        <Icon name="warning-outline" size={11} color={theme.colors.warning} />
                        <Text style={styles.panelGroupBadgeText}>{t("damage.reported", { count: sectionDamageCount })}</Text>
                      </View>
                    ) : (
                      <View style={[styles.panelGroupBadge, { backgroundColor: theme.colors.successBg }]}>
                        <Icon name="checkmark-circle" size={11} color={theme.colors.success} />
                        <Text style={[styles.panelGroupBadgeText, { color: theme.colors.success }]}>{t("damage.clear")}</Text>
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
                          <Text style={styles.panelName}>{t(panelLabelKey(p))}</Text>
                          {d?.description ? <Text style={styles.panelDesc}>{d.description}</Text> : null}
                        </View>
                        <View style={[styles.severityTag, { backgroundColor: sev.bg }]}>
                          <Text style={[styles.severityText, { color: sev.fg }]}>{t(`damage.level.${level}`)}</Text>
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
              t={t}
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
            <ProgressBar value={docProgress} label={t("docs.progress", { done: Object.keys(docs).length, total: DOC_SLOTS.length })} />
            <Text style={styles.tip}>{t("docs.tip")}</Text>
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
                      <Text style={styles.photoLabel}>{t(s.tkey)}</Text>
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
              <Text style={styles.reviewEyebrow}>{t("review.vehicle")}</Text>
              <Text style={styles.reviewTitle}>{year || "—"} {make || "—"} {model || "—"}</Text>
              <Text style={styles.reviewSub}>VIN {vin || "—"} · {formatKm(Number(mileage) || 0)} · {color || "—"}</Text>

              {startingPrice && (
                <View style={styles.reviewPriceRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewPriceLabel}>{t("review.startingPrice")}</Text>
                    <Text style={styles.reviewPriceValue}>€{Number(startingPrice).toLocaleString("en-GB")}</Text>
                  </View>
                  {reservePrice && (
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reviewPriceLabel}>{t("review.reserve")}</Text>
                      <Text style={styles.reviewPriceValue}>€{Number(reservePrice).toLocaleString("en-GB")}</Text>
                    </View>
                  )}
                </View>
              )}
            </Card>

            <View style={styles.summaryRow}>
              <SummaryCard icon="camera-outline"      value={`${Object.keys(photos).length}/${TOTAL_PHOTO_SLOTS}`} label={t("review.photos")}  complete={Object.keys(photos).length === TOTAL_PHOTO_SLOTS} />
              <SummaryCard icon="images-outline"      value={String(otherPhotos.length)}                            label={t("review.other")} />
              <SummaryCard icon="warning-outline"     value={String(Object.values(damages).filter((d) => d.level !== "none").length)} label={t("review.damages")} />
              <SummaryCard icon="folder-open-outline" value={`${Object.keys(docs).length}/${DOC_SLOTS.length}`}     label={t("review.docs")}    complete={Object.keys(docs).length === DOC_SLOTS.length} />
            </View>

            {damagedPanelsWithoutPhoto > 0 && (
              <View style={[styles.warnBanner, { marginTop: 16 }]}>
                <Icon name="alert-circle-outline" size={16} color={theme.colors.warning} />
                <Text style={styles.warnText}>
                  {damagedPanelsWithoutPhoto === 1
                    ? t("review.missingOne")
                    : t("review.missingMany", { count: damagedPanelsWithoutPhoto })}
                </Text>
              </View>
            )}

            {/* Inspector notes — saved to the vehicle so buyers see them in
                the condition report. */}
            <View style={[styles.card, { marginTop: 16 }]}>
              <View style={styles.priceHeader}>
                <Icon name="create-outline" size={14} color={theme.colors.brand} />
                <Text style={styles.priceHeaderText}>{t("review.notes")}</Text>
              </View>
              {readOnly ? (
                <Text style={styles.reviewSub}>{notes.trim() || t("review.noNotes")}</Text>
              ) : (
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  placeholder={t("review.notesPlaceholder")}
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
                  <Text style={styles.submitText}>{submitting ? t("review.submitting") : t("review.submit")}</Text>
                </LinearGradient>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      {/* Step nav */}
      <View style={styles.navBar}>
        <Button label={t("common.back")} variant="outline" onPress={() => step === 1 ? navigation.goBack() : setStep((s) => s - 1)} style={{ flex: 1 }} />
        {step < STEPS.length && <Button label={t("common.next")} onPress={() => setStep((s) => Math.min(STEPS.length, s + 1))} style={{ flex: 1 }} />}
      </View>
    </KeyboardAvoidingView>
  );
}

function Stepper({ step, t }: { step: number; t: TFunc }) {
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
              <Text style={[styles.stepLabel, active && { color: theme.colors.brand, fontWeight: "800" }]}>{t(s.tkey)}</Text>
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

function Field({ label, required, badge, style, children }: { label: string; required?: boolean; badge?: React.ReactNode; style?: object; children: React.ReactNode }) {
  return (
    <View style={[{ marginBottom: 12 }, style]}>
      <View style={styles.fieldLabelRow}>
        <Text style={[styles.label, { marginBottom: 0 }]}>{label}{required && <Text style={{ color: theme.colors.error }}>  *</Text>}</Text>
        {badge}
      </View>
      {children}
    </View>
  );
}

// "Decoded" pill shown next to a field auto-filled from the VIN decoder.
function DecodedBadge({ t }: { t: TFunc }) {
  return (
    <View style={styles.decodedBadge}>
      <Icon name="checkmark-circle" size={10} color={theme.colors.success} />
      <Text style={styles.decodedBadgeText}>{t("details.vinDecoded")}</Text>
    </View>
  );
}

// Input-styled pressable that opens a SearchableSelect sheet.
function SelectField({ value, placeholder, onPress, disabled }: { value?: string; placeholder: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [styles.input, styles.selectInput, disabled && styles.selectDisabled, pressed && !disabled && { opacity: 0.9 }]}
    >
      <Text style={[styles.selectValue, !value && styles.selectPlaceholder]} numberOfLines={1}>{value || placeholder}</Text>
      <Icon name="chevron-down" size={16} color={disabled ? theme.colors.textLight : theme.colors.textMuted} />
    </Pressable>
  );
}

// Inline single-select pill group for short enums (transmission / fuel).
function PillGroup({ options, value, onChange, render, disabled }: { options: readonly string[]; value: string; onChange: (v: string) => void; render: (v: string) => string; disabled?: boolean }) {
  return (
    <View style={styles.pillRow}>
      {options.map((o) => {
        const sel = o === value;
        return (
          <Pressable
            key={o}
            onPress={disabled ? undefined : () => onChange(o)}
            style={[styles.pill, sel && styles.pillSelected, disabled && !sel && { opacity: 0.55 }]}
          >
            <Text style={[styles.pillText, sel && styles.pillTextSelected]}>{render(o)}</Text>
          </Pressable>
        );
      })}
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
  open, panel, t, initial, hasPhoto, onClose, onSave, onTakePhoto,
}: {
  open: boolean;
  panel: string;
  t: TFunc;
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
          <Text style={styles.modalTitle}>{panel ? t(panelLabelKey(panel)) : ""}</Text>
          <Text style={styles.modalSub}>{t("damage.pickerSub")}</Text>

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
                  <Text style={[styles.levelText, { color: sty.fg }]}>{t(`damage.level.${l}`)}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={desc}
            onChangeText={setDesc}
            multiline
            placeholder={t("damage.pickerPlaceholder")}
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
                {hasPhoto ? t("damage.retakePhoto") : t("damage.takePhoto")}
              </Text>
            </Pressable>
          )}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <Button label={t("common.cancel")} variant="outline" onPress={onClose} style={{ flex: 1 }} />
            <Button label={t("common.save")} onPress={() => onSave(level, desc)} style={{ flex: 1 }} />
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
  fieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, minHeight: 16 },

  // VIN decoder badges
  decodedBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.full, backgroundColor: theme.colors.successBg },
  decodedBadgeText: { fontSize: 9, fontWeight: "800", color: theme.colors.success, textTransform: "uppercase", letterSpacing: 0.4 },
  decodingBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  decodingText: { fontSize: 10, fontWeight: "700", color: theme.colors.brand, textTransform: "uppercase", letterSpacing: 0.4 },
  vinFailText: { fontSize: 12, color: theme.colors.warning, fontWeight: "600", marginTop: -4, marginBottom: 12 },

  // Select (dropdown) field
  selectInput: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectDisabled: { backgroundColor: theme.colors.bgAlt },
  selectValue: { flex: 1, fontSize: 14, color: theme.colors.text },
  selectPlaceholder: { color: theme.colors.textLight },
  pickFromList: { fontSize: 11, fontWeight: "700", color: theme.colors.brand, marginTop: 6 },

  // Enum pill group
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 16, minHeight: 40, justifyContent: "center", borderRadius: theme.radius.full, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.white },
  pillSelected: { borderColor: theme.colors.brand, backgroundColor: theme.colors.brandLight },
  pillText: { fontSize: 13, fontWeight: "700", color: theme.colors.textMuted },
  pillTextSelected: { color: theme.colors.brandDark },

  // Photo sections (collapsible)
  photoSection: { marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, overflow: "hidden", backgroundColor: theme.colors.white },
  photoSectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 14, backgroundColor: theme.colors.bgAlt },
  photoSectionTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: theme.colors.text },
  photoSectionCount: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 9, paddingVertical: 3, borderRadius: theme.radius.full, backgroundColor: theme.colors.brandLight },
  photoSectionCountDone: { backgroundColor: theme.colors.success },
  photoSectionCountText: { fontSize: 11, fontWeight: "800", color: theme.colors.brand },
  photoSectionGrid: { padding: 12 },
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

  // Paint thickness test
  paintCard: {
    padding: 14, borderRadius: theme.radius.lg, marginBottom: 16,
    backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border,
  },
  paintHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  paintTitle: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  paintSub: { fontSize: 12, color: theme.colors.textLight, marginTop: 4, fontWeight: "600", lineHeight: 17 },
  paintCapture: {
    marginTop: 12, height: 96, borderRadius: theme.radius.lg, overflow: "hidden",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 1, borderColor: theme.colors.brand, borderStyle: "dashed", backgroundColor: theme.colors.bgAlt,
  },
  paintCaptureText: { color: theme.colors.brand, fontWeight: "800", fontSize: 13 },
  paintThumb: { width: "100%", height: "100%" },

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

  // Header "Discard" button
  discardHeaderBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  discardHeaderText: { color: theme.colors.error, fontWeight: "800", fontSize: 13 },

  // Changes-requested banner (admin sent the vehicle back)
  changesReqBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    padding: 12, marginBottom: 12,
    backgroundColor: theme.colors.warningBg,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: "#fedf89",
  },
  changesReqTitle: { fontSize: 13, fontWeight: "800", color: theme.colors.warning },
  changesReqText: { fontSize: 12, color: theme.colors.warning, marginTop: 3, lineHeight: 17, fontWeight: "600" },
  changesReqHint: { fontSize: 11, color: theme.colors.textMuted, marginTop: 4, lineHeight: 15 },
});
