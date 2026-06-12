// Vehicle market valuation engine.
//
// PRIMARY: getMarketValuation() calls the "valuation-proxy" Supabase Edge
// Function (which holds the auto.dev key server-side) with the BASE model only
// (auto.dev returns 0 records for "Model Trim"); the trim is sent alongside for
// logging and then used HERE to filter the returned listings by each record's
// trim — trims matter ("458 Speciale" ≫ "458 Spider"). Matching listings are
// aggregated into min/avg/max + the count as dataPoints (source: "market_data",
// trimMatched true). The API key NEVER ships in the client bundle.
//
// FALLBACK: estimateValuation() uses a curated reference table + depreciation,
// mileage and condition adjustments, with a trim multiplier so variants don't
// collapse to one price (source: "estimate"). Used when no API key is set or
// the API is down / returns nothing.

import { supabase } from "./supabase";

export type Condition = "excellent" | "good" | "fair" | "poor";

export interface Valuation {
  minEur: number;
  avgEur: number;
  maxEur: number;
  confidence: "high" | "medium" | "low";
  dataPoints: number;
  source: "market_data" | "estimate";
  // true when the figure reflects the SPECIFIC trim (live listings filtered to
  // the trim, or an estimate whose trim multiplier matched). false ⇒ model-only.
  trimMatched?: boolean;
}

export interface ValuationInput {
  make: string;
  model: string;
  trim?: string;
  year: number;
  mileageKm?: number;
  condition?: Condition;
}

const CURRENT_YEAR = 2026;
const DEFAULT_KM_PER_YEAR = 15_000;
const USD_TO_EUR = 0.92;

// (auto.dev key removed — the network call now lives in the valuation-proxy
// Supabase Edge Function so the key never ships in the client bundle.)

// --- Reference table -------------------------------------------------
// base = approximate EUR price of a recent (~1-year-old) example.
interface Ref { base: number; kmPerYear?: number }

const TABLE: Record<string, Record<string, Ref>> = {
  toyota:        { "land cruiser": { base: 90_000 }, "camry": { base: 32_000 }, "supra": { base: 60_000 }, "rav4": { base: 38_000 } },
  nissan:        { "patrol": { base: 75_000 }, "altima": { base: 28_000 }, "gt-r": { base: 110_000, kmPerYear: 8_000 }, "x-trail": { base: 34_000 } },
  porsche:       { "cayenne": { base: 95_000 }, "911": { base: 145_000, kmPerYear: 9_000 }, "panamera": { base: 110_000 }, "macan": { base: 75_000 }, "taycan": { base: 105_000 } },
  bmw:           { "x5": { base: 80_000 }, "7 series": { base: 110_000 }, "3 series": { base: 50_000 }, "x3": { base: 60_000 }, "m4": { base: 95_000, kmPerYear: 10_000 } },
  "mercedes-benz": { "gle": { base: 85_000 }, "s-class": { base: 130_000 }, "c-class": { base: 55_000 }, "g-class": { base: 180_000, kmPerYear: 10_000 }, "amg gt": { base: 150_000, kmPerYear: 9_000 } },
  mercedes:      { "gle": { base: 85_000 }, "s-class": { base: 130_000 }, "c-class": { base: 55_000 }, "g-class": { base: 180_000 }, "amg gt": { base: 150_000 } },
  audi:          { "q7": { base: 80_000 }, "a6": { base: 60_000 }, "rs6": { base: 130_000, kmPerYear: 10_000 }, "q5": { base: 55_000 }, "e-tron": { base: 75_000 } },
  "land rover":  { "range rover sport": { base: 110_000 }, "velar": { base: 75_000 }, "evoque": { base: 55_000 }, "defender": { base: 85_000 }, "range rover": { base: 150_000 }, "sport": { base: 110_000 } },
  "range rover": { "sport": { base: 110_000 }, "velar": { base: 75_000 }, "evoque": { base: 55_000 }, "defender": { base: 85_000 } },
  lexus:         { "lx": { base: 130_000 }, "rx": { base: 70_000 }, "es": { base: 50_000 }, "is": { base: 45_000 }, "lc": { base: 110_000, kmPerYear: 9_000 } },
  ferrari:       { "458": { base: 220_000, kmPerYear: 5_000 }, "488": { base: 280_000, kmPerYear: 5_000 }, "f8": { base: 350_000, kmPerYear: 5_000 }, "roma": { base: 230_000, kmPerYear: 6_000 }, "sf90": { base: 550_000, kmPerYear: 4_000 } },
  lamborghini:   { "huracan": { base: 280_000, kmPerYear: 5_000 }, "urus": { base: 280_000, kmPerYear: 8_000 }, "aventador": { base: 450_000, kmPerYear: 4_000 } },
  "rolls-royce": { "ghost": { base: 350_000, kmPerYear: 7_000 }, "wraith": { base: 320_000, kmPerYear: 7_000 }, "cullinan": { base: 420_000, kmPerYear: 8_000 }, "phantom": { base: 500_000, kmPerYear: 6_000 } },
  "rolls royce": { "ghost": { base: 350_000 }, "wraith": { base: 320_000 }, "cullinan": { base: 420_000 }, "phantom": { base: 500_000 } },
  bentley:       { "continental gt": { base: 230_000, kmPerYear: 8_000 }, "bentayga": { base: 220_000 }, "flying spur": { base: 230_000 } },
  mclaren:       { "720s": { base: 280_000, kmPerYear: 5_000 }, "570s": { base: 180_000, kmPerYear: 6_000 }, "gt": { base: 230_000, kmPerYear: 6_000 }, "artura": { base: 250_000, kmPerYear: 5_000 } },
};

// High-value trim keywords → multiplier on the base model price.
const TRIM_MULTIPLIERS: Array<{ kw: string; mult: number }> = [
  { kw: "black series", mult: 2.6 },
  { kw: "speciale",     mult: 2.4 },
  { kw: "pista",        mult: 2.4 },
  { kw: "svj",          mult: 2.2 },
  { kw: "gt3 rs",       mult: 2.0 },
  { kw: "gt2 rs",       mult: 2.1 },
  { kw: "performante",  mult: 1.6 },
  { kw: "competizione", mult: 1.55 },
  { kw: "turbo gt",     mult: 1.5 },
  { kw: "gt3",          mult: 1.7 },
  { kw: "z06",          mult: 1.5 },
  { kw: "turbo s",      mult: 1.4 },
  { kw: " sv",          mult: 1.9 },
  { kw: "first edition", mult: 1.12 },
  { kw: "long wheelbase", mult: 1.15 },
  { kw: "executive",    mult: 1.12 },
];

// Scans BOTH the model and the (now-separate) trim field for a high-value
// keyword, so e.g. model "Aventador" + trim "SVJ" still gets the SVJ premium.
// Returns the multiplier and whether a trim keyword actually matched.
function trimMultiplier(model: string, trim?: string): { mult: number; matched: boolean } {
  const m = ` ${model.toLowerCase()} ${(trim ?? "").toLowerCase()} `;
  for (const t of TRIM_MULTIPLIERS) if (m.includes(t.kw)) return { mult: t.mult, matched: true };
  return { mult: 1, matched: false };
}

// Find the best reference entry: exact make, then the longest model key the
// typed model contains (so "Cayenne Turbo GT" matches "cayenne").
function lookupRef(make: string, model: string): Ref | null {
  const mk = make.trim().toLowerCase();
  const md = model.trim().toLowerCase();
  const models = TABLE[mk];
  if (!models) return null;
  let best: { key: string; ref: Ref } | null = null;
  for (const [key, ref] of Object.entries(models)) {
    if (md.includes(key) && (!best || key.length > best.key.length)) best = { key, ref };
  }
  // No model-substring match — use the make's most common (median) base.
  if (!best) {
    const bases = Object.values(models).map((r) => r.base).sort((a, b) => a - b);
    return { base: bases[Math.floor(bases.length / 2)] };
  }
  return best.ref;
}

function depreciationFactor(age: number): number {
  let f = 1;
  for (let y = 1; y <= age; y++) f *= y === 1 ? 0.85 : y === 2 ? 0.88 : y === 3 ? 0.90 : 0.93;
  return f;
}

const CONDITION_MULT: Record<Condition, number> = { excellent: 1.05, good: 1.0, fair: 0.92, poor: 0.85 };

/** Fallback valuation from the reference table. Always returns a result. */
export function estimateValuation(input: ValuationInput): Valuation {
  const age = Math.max(0, CURRENT_YEAR - (Number(input.year) || CURRENT_YEAR));
  const ref = lookupRef(input.make, input.model);
  const matched = ref != null;
  const base = ref?.base ?? 40_000; // generic fallback for unknown make

  const tm = matched ? trimMultiplier(input.model, input.trim) : { mult: 1, matched: false };
  const condition = CONDITION_MULT[input.condition ?? "good"];

  let avg = base * depreciationFactor(age) * tm.mult * condition;

  // Mileage adjustment vs expected mileage for the age.
  const kmPerYear = ref?.kmPerYear ?? DEFAULT_KM_PER_YEAR;
  const expectedKm = kmPerYear * Math.max(1, age);
  const delta = (input.mileageKm ?? expectedKm) - expectedKm;
  const overKm = Math.max(0, delta);
  const underKm = Math.max(0, -delta);
  avg += -(overKm / 10_000) * 800 + (underKm / 10_000) * 400;

  avg = Math.max(base * 0.1, Math.round(avg / 100) * 100);

  return {
    minEur: Math.round((avg * 0.85) / 100) * 100,
    avgEur: avg,
    maxEur: Math.round((avg * 1.15) / 100) * 100,
    confidence: matched ? "medium" : "low",
    dataPoints: 0,
    source: "estimate",
    trimMatched: tm.matched,
  };
}

/**
 * Aggregate an auto.dev listings payload into a Valuation. Returns null when
 * the payload has no usable prices. Pure — the network call (and the API key)
 * live in the valuation-proxy Edge Function, not in this client.
 */
// Pull a usable USD price from an auto.dev listing record. The real number is
// `priceUnformatted`; `price` is often a STRING ("accepting_offers", "call")
// for exotics, so never parse it directly. Falls back to basePrice/pricePlusFees.
function recordPriceUsd(o: Record<string, unknown>): number {
  for (const k of ["priceUnformatted", "basePrice", "pricePlusFees", "priceMobile"]) {
    const n = Number(o[k]);
    if (Number.isFinite(n) && n > 1000) return n;
  }
  const p = o.price; // only if it's actually numeric (not "accepting_offers")
  if (typeof p === "number" && p > 1000) return p;
  return 0;
}

function matchesTrim(recordTrim: string, wanted: string): boolean {
  const rt = recordTrim.toLowerCase();
  const w = wanted.toLowerCase().trim();
  if (!w) return true;
  if (rt.includes(w)) return true;
  // Token overlap — the distinctive bits ("svj", "gt3 rs", "performante").
  return w.split(/[\s-]+/).filter((t) => t.length >= 2).some((tok) => rt.includes(tok));
}

/**
 * Aggregate an auto.dev listings payload into a Valuation. When `wantedTrim` is
 * set, prefer records whose listing trim matches it (so SVJ ≫ base Aventador);
 * if too few trim-matched listings have a price, fall back to all priced
 * records and flag trimMatched=false. Returns null when no usable price exists.
 */
function parseListings(payload: unknown, wantedTrim?: string): Valuation | null {
  const d = (payload ?? {}) as { records?: unknown[]; listings?: unknown[]; data?: unknown[] };
  const records = (d.records ?? d.listings ?? d.data ?? []) as Record<string, unknown>[];

  const priced = records
    .filter((r) => r && typeof r === "object")
    .map((r) => ({ price: recordPriceUsd(r), trim: String(r.trim ?? "") }))
    .filter((x) => x.price > 1000);
  if (priced.length === 0) return null;

  // Prefer trim-matched listings when we have enough of them.
  let used = priced;
  let trimMatched = false;
  if (wantedTrim && wantedTrim.trim()) {
    const matched = priced.filter((x) => matchesTrim(x.trim, wantedTrim));
    if (matched.length >= 3) { used = matched; trimMatched = true; }
  }

  const prices = used.map((x) => x.price * USD_TO_EUR).sort((a, b) => a - b);
  const avg = prices.reduce((s, n) => s + n, 0) / prices.length;
  const round = (n: number) => Math.round(n / 100) * 100;
  return {
    minEur: round(prices[0]),
    avgEur: round(avg),
    maxEur: round(prices[prices.length - 1]),
    confidence: prices.length >= 10 ? "high" : prices.length >= 4 ? "medium" : "low",
    dataPoints: prices.length,
    source: "market_data",
    trimMatched,
  };
}

/**
 * Try live market data via the valuation-proxy Edge Function (which holds the
 * auto.dev key server-side), then fall back to the reference-table estimate.
 * Always resolves to a Valuation — never throws.
 */
export async function getMarketValuation(input: ValuationInput): Promise<Valuation> {
  try {
    const { data, error } = await supabase.functions.invoke("valuation-proxy", {
      body: {
        make: input.make,
        model: input.model, // BASE model only — auto.dev returns 0 for "Model Trim"
        trim: input.trim,   // forwarded for logging; trim filtering happens here
        year: input.year,
        mileage: input.mileageKm,
      },
    });
    if (!error && data) {
      const live = parseListings(data, input.trim);
      // Use live data only when it actually reflects the trim, or when the
      // offline table has no trim premium to offer anyway. Otherwise the
      // trim-aware estimate (e.g. SVJ multiplier) is the more honest figure.
      if (live) {
        const est = estimateValuation(input);
        if (live.trimMatched || !est.trimMatched) return live;
        // Live data exists but isn't trim-specific AND the estimate has a trim
        // premium → prefer the estimate (model-only live would understate SVJ).
        return est;
      }
    }
  } catch {
    // network / invoke failure — fall through to the offline estimate
  }
  return estimateValuation(input);
}

/** Human label for a valuation's provenance. */
export function valuationLabel(v: Valuation): string {
  if (v.source === "market_data") {
    const base = `Based on ${v.dataPoints} comparable listing${v.dataPoints === 1 ? "" : "s"} across EU markets`;
    return v.trimMatched ? base : `${base} — model only, trim adjustment recommended`;
  }
  return v.trimMatched
    ? "Trim-adjusted estimate — verify with live listings"
    : "Market estimate based on model only — trim adjustment recommended";
}

/** Where a price sits relative to the range: below min / fair / above max. */
export function pricePosition(priceEur: number | null | undefined, v: Valuation): "below" | "fair" | "above" | "unknown" {
  if (priceEur == null) return "unknown";
  if (priceEur < v.minEur) return "below";
  if (priceEur > v.maxEur) return "above";
  return "fair";
}
