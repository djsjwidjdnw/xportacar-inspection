// VIN decoder backed by the auto.dev VIN API.
//
// Calls the "vin-decoder-proxy" Supabase Edge Function, which proxies
// GET https://api.auto.dev/vin/{VIN} server-side using AUTODEV_API_KEY. The
// auto.dev key NEVER ships in the client bundle.
//
// The response is parsed DEFENSIVELY — auto.dev returns a flat object
// ({make, model, body, engine, drive, transmission, ...}) plus a nested
// `vehicle` ({year, make, model}). We read from several candidate paths and
// normalise transmission/fuel/drivetrain into the values our schema expects,
// so a small shape change upstream degrades gracefully rather than crashing.
//
// On ANY failure (invalid VIN, 404/422, network, bad JSON) decodeVin resolves
// to { ok:false } so the caller falls back to manual entry — never throws.

import { supabase } from "./supabase";
import { canonicalizeMake } from "./vehicleData";

export type Transmission = "automatic" | "manual";
export type FuelType = "petrol" | "diesel" | "hybrid" | "electric";

export interface DecodedVin {
  make?: string;          // canonicalised to our make list where possible
  model?: string;
  year?: string;
  bodyType?: string;
  engine?: string;
  transmission?: Transmission;
  fuelType?: FuelType;
  drivetrain?: string;
  trim?: string;
}

export type VinDecodeError = "invalid" | "not_found" | "network" | "unknown";

export interface VinDecodeResult {
  ok: boolean;
  data?: DecodedVin;
  error?: VinDecodeError;
}

// ISO 3779 VIN: 17 chars, excludes I, O, Q.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

/** True when `vin` is a structurally valid 17-char VIN. */
export function isValidVin(vin: string): boolean {
  return VIN_RE.test(vin.trim());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(obj: any, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return undefined;
}

function normTransmission(raw?: string): Transmission | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  // "automated manual" / "single-speed automatic" / CVT / DCT / PDK → automatic.
  if (/\bmanual\b/.test(s) && !/auto/.test(s)) return "manual";
  if (/auto|cvt|dct|pdk|tiptronic|dsg|s-tronic|single-speed/.test(s)) return "automatic";
  if (/\bmanual\b/.test(s)) return "manual";
  return undefined;
}

function normFuel(raw?: string): FuelType | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (/diesel/.test(s)) return "diesel";
  if (/electric|^ev$|\bbev\b/.test(s)) return "electric";
  if (/hybrid|phev|hev|plug-in/.test(s)) return "hybrid";
  if (/gas|petrol|gasoline|flex|e85|ethanol/.test(s)) return "petrol";
  return undefined;
}

/**
 * Decode a VIN via auto.dev. Never throws — returns { ok:false, error } on any
 * problem so the wizard can fall back to manual dropdowns.
 */
export async function decodeVin(vin: string): Promise<VinDecodeResult> {
  const v = vin.trim().toUpperCase();
  if (!isValidVin(v)) return { ok: false, error: "invalid" };

  // The auto.dev key lives in the vin-decoder-proxy Edge Function, not here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let j: any;
  try {
    const { data, error } = await supabase.functions.invoke("vin-decoder-proxy", {
      body: { vin: v },
    });
    if (error) {
      // The proxy passes the upstream status through; invoke surfaces any
      // non-2xx (incl. 404/422 not-found) as an error → fall back to manual.
      return { ok: false, error: "not_found" };
    }
    j = data;
  } catch {
    return { ok: false, error: "network" };
  }
  if (!j) return { ok: false, error: "not_found" };

  // Some payloads wrap useful bits in a nested `vehicle` object.
  const nested = j?.vehicle ?? {};

  // Explicit "no match" signals from the API.
  if (j?.vinValid === false || j?.error || j?.code === "VIN_NOT_FOUND") {
    return { ok: false, error: "not_found" };
  }

  const rawMake = pick(j, "make") ?? pick(nested, "make", "manufacturer");
  const model   = pick(j, "model") ?? pick(nested, "model");
  const year    = pick(nested, "year") ?? pick(j, "year", "modelYear", "ModelYear");
  const body    = pick(j, "body", "bodyType", "bodyClass", "BodyClass", "style");
  const engine  = pick(j, "engine", "engineDescription") ?? buildEngine(j);
  const drive   = pick(j, "drive", "drivetrain", "driveType", "DriveType");
  const fuelRaw = pick(j, "fuel", "fuelType", "fuelTypePrimary", "FuelTypePrimary", "engineFuelType");
  const transRaw = pick(j, "transmission", "transmissionStyle", "TransmissionStyle");
  const trim    = pick(j, "trim");

  const data: DecodedVin = {
    make: rawMake ? canonicalizeMake(rawMake) : undefined,
    model,
    year: year ? String(parseInt(year, 10) || year) : undefined,
    bodyType: body,
    engine,
    transmission: normTransmission(transRaw),
    fuelType: normFuel(fuelRaw),
    drivetrain: drive,
    trim,
  };

  // If literally nothing usable came back, treat as not found.
  const hasAny = Object.values(data).some((x) => x != null && x !== "");
  if (!hasAny) return { ok: false, error: "not_found" };

  return { ok: true, data };
}

// Build an engine string from granular fields if no combined string exists.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEngine(j: any): string | undefined {
  const disp = pick(j, "displacement", "displacementL", "baseEngineSize", "DisplacementL");
  const cyl = pick(j, "cylinders", "engineCylinders", "EngineCylinders");
  const parts: string[] = [];
  if (disp) parts.push(/l$/i.test(disp) ? disp : `${disp}L`);
  if (cyl) parts.push(`${cyl}-cyl`);
  return parts.length ? parts.join(" ") : undefined;
}
