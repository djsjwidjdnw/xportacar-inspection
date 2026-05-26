// Vehicle market valuation engine.
//
// PRIMARY: fetchMarketValuation() calls the auto.dev listings API (free tier,
// set VALUATION_API_KEY) with the FULL model string the inspector typed —
// trims matter ("458 Speciale" ≫ "458 Spider"). Returns real listing
// min/avg/max + the count as dataPoints (source: "market_data").
//
// FALLBACK: estimateValuation() uses a curated reference table + depreciation,
// mileage and condition adjustments, with a trim multiplier so variants don't
// collapse to one price (source: "estimate"). Used when no API key is set or
// the API is down / returns nothing.

export type Condition = "excellent" | "good" | "fair" | "poor";

export interface Valuation {
  minEur: number;
  avgEur: number;
  maxEur: number;
  confidence: "high" | "medium" | "low";
  dataPoints: number;
  source: "market_data" | "estimate";
}

export interface ValuationInput {
  make: string;
  model: string;
  year: number;
  mileageKm?: number;
  condition?: Condition;
}

const CURRENT_YEAR = 2026;
const DEFAULT_KM_PER_YEAR = 15_000;
const USD_TO_EUR = 0.92;

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

function trimMultiplier(model: string): number {
  const m = ` ${model.toLowerCase()} `;
  for (const t of TRIM_MULTIPLIERS) if (m.includes(t.kw)) return t.mult;
  return 1;
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

  const trim = matched ? trimMultiplier(input.model) : 1;
  const condition = CONDITION_MULT[input.condition ?? "good"];

  let avg = base * depreciationFactor(age) * trim * condition;

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
  };
}

/**
 * Real market data from the auto.dev listings API (free tier). Returns null
 * on any failure so the caller can fall back to estimateValuation().
 * Pass the FULL model string — trims change the price dramatically.
 */
export async function fetchMarketValuation(
  input: ValuationInput,
  apiKey: string,
): Promise<Valuation | null> {
  if (!apiKey) return null;
  try {
    const qs = new URLSearchParams({
      apikey: apiKey,
      make: input.make,
      model: input.model, // full string incl. variant/trim
      year_min: String(input.year),
      year_max: String(input.year),
    });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://auto.dev/api/listings?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    // deno-lint-ignore no-explicit-any
    const data: any = await res.json();
    const records: unknown[] = data.records ?? data.listings ?? data.data ?? [];
    const prices = records
      // deno-lint-ignore no-explicit-any
      .map((r: any) => Number(typeof r === "object" ? (r.price ?? r.priceUnformatted ?? r.listing_price) : r))
      .filter((n) => Number.isFinite(n) && n > 1000)
      .map((usd) => usd * USD_TO_EUR);
    if (prices.length === 0) return null;
    const sorted = prices.sort((a, b) => a - b);
    const avg = sorted.reduce((s, n) => s + n, 0) / sorted.length;
    const round = (n: number) => Math.round(n / 100) * 100;
    return {
      minEur: round(sorted[0]),
      avgEur: round(avg),
      maxEur: round(sorted[sorted.length - 1]),
      confidence: sorted.length >= 10 ? "high" : sorted.length >= 4 ? "medium" : "low",
      dataPoints: sorted.length,
      source: "market_data",
    };
  } catch {
    return null;
  }
}

/** Human label for a valuation's provenance. */
export function valuationLabel(v: Valuation): string {
  return v.source === "market_data"
    ? `Based on ${v.dataPoints} comparable listing${v.dataPoints === 1 ? "" : "s"} across EU markets`
    : "Estimated from market data — verify with live listings";
}

/** Where a price sits relative to the range: below min / fair / above max. */
export function pricePosition(priceEur: number | null | undefined, v: Valuation): "below" | "fair" | "above" | "unknown" {
  if (priceEur == null) return "unknown";
  if (priceEur < v.minEur) return "below";
  if (priceEur > v.maxEur) return "above";
  return "fair";
}
