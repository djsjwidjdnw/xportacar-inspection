// trimCatalog.ts — a SHORT static seed of common exotic / luxury trims, used to
// auto-suggest the trim field in the inspection wizard. Trim drives valuation
// (a base Aventador vs an SVJ is a >2× swing), so making the right trim easy to
// pick keeps the live market estimate honest.
//
// These suggestions are MERGED with the distinct trims already present in the
// vehicles table (real local data is shown first); this catalog is the fallback
// so the very first listing of a model still has sensible options. Free text is
// always allowed — this is a convenience, never a constraint. Keep it short.

type ModelTrims = Record<string, string[]>; // model (lowercase) -> trims
interface MakeCatalog {
  models?: ModelTrims; // per-model trims, matched on the model name
  common?: string[];   // make-wide trims appended after any model match
}

const CATALOG: Record<string, MakeCatalog> = {
  lamborghini: {
    models: {
      aventador: ["LP 700-4", "S", "SV", "SVJ", "Ultimae"],
      huracan: ["LP 610-4", "EVO", "Performante", "STO", "Tecnica", "Sterrato"],
      urus: ["S", "Performante"],
      gallardo: ["LP 560-4", "LP 570-4 Superleggera", "LP 550-2"],
    },
  },
  ferrari: {
    models: {
      "488": ["GTB", "Spider", "Pista"],
      f8: ["Tributo", "Spider"],
      "812": ["Superfast", "GTS", "Competizione"],
      "296": ["GTB", "GTS"],
      sf90: ["Stradale", "Spider"],
      portofino: ["M"],
      roma: ["Spider"],
    },
    common: ["Pista", "Speciale", "Competizione"],
  },
  porsche: {
    models: {
      "911": ["Carrera", "Carrera S", "Carrera 4S", "Targa 4S", "Turbo", "Turbo S", "GT3", "GT3 RS", "GT2 RS"],
      cayenne: ["S", "GTS", "Turbo", "Turbo GT", "Turbo S E-Hybrid"],
      macan: ["S", "GTS", "Turbo"],
      panamera: ["4S", "GTS", "Turbo", "Turbo S"],
      taycan: ["4S", "GTS", "Turbo", "Turbo S"],
      "718 cayman": ["S", "GTS 4.0", "GT4", "GT4 RS"],
    },
    common: ["GT3", "GT3 RS", "Turbo S", "GTS"],
  },
  mclaren: {
    models: {
      "720s": ["Coupe", "Spider"],
      "765lt": ["Coupe", "Spider"],
      "750s": ["Coupe", "Spider"],
      "570s": ["Coupe", "Spider"],
      gt: ["GT"],
      artura: ["Artura"],
    },
    common: ["LT", "Spider"],
  },
  "mercedes-benz": {
    models: {
      "g-class": ["G 500", "AMG G 63", "G 550", "4x4²"],
      "amg gt": ["S", "C", "R", "Black Series", "63 S 4-Door"],
      "s-class": ["S 500", "S 580", "AMG S 63", "Maybach S 680"],
    },
    common: ["AMG Line", "AMG 53", "AMG 63 S", "4MATIC", "Maybach", "Black Series"],
  },
  mercedes: {
    common: ["AMG Line", "AMG 53", "AMG 63 S", "4MATIC", "Maybach", "Black Series"],
  },
  bmw: {
    models: {
      m3: ["Competition", "CS"],
      m4: ["Competition", "CSL"],
      m5: ["Competition", "CS"],
      x5: ["xDrive40i", "M50i", "X5 M Competition"],
      x6: ["xDrive40i", "M50i", "X6 M Competition"],
      "8 series": ["840i", "M850i", "M8 Competition"],
    },
    common: ["M Sport", "Competition", "xDrive", "CS", "CSL"],
  },
  audi: {
    models: {
      r8: ["V10", "V10 Performance", "GT"],
      rs6: ["Avant", "Performance"],
      rs7: ["Sportback", "Performance"],
      q8: ["55 TFSI", "SQ8", "RS Q8"],
      q7: ["55 TFSI", "SQ7"],
    },
    common: ["S line", "S", "RS", "quattro", "Performance"],
  },
  bentley: {
    models: {
      continental: ["GT", "GT V8", "GT Speed", "GTC", "GTC Speed"],
      bentayga: ["V8", "S", "Speed", "EWB"],
      "flying spur": ["V8", "S", "Speed"],
    },
    common: ["Speed", "Azure", "Mulliner"],
  },
  "rolls-royce": {
    models: {
      cullinan: ["Black Badge"],
      ghost: ["Extended", "Black Badge"],
      wraith: ["Black Badge"],
      phantom: ["Extended"],
      dawn: ["Black Badge"],
      spectre: ["Spectre"],
    },
    common: ["Black Badge", "Extended"],
  },
  "aston martin": {
    models: {
      vantage: ["Vantage", "F1 Edition"],
      db11: ["V8", "AMR"],
      db12: ["DB12"],
      dbs: ["Superleggera", "770 Ultimate"],
      dbx: ["DBX", "707"],
    },
    common: ["AMR", "Superleggera", "F1 Edition"],
  },
};

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Suggested trims for a make + model, model-specific first then make-wide
 * commons. De-duped (case-insensitive), empties dropped, original order kept.
 * Returns [] for unknown makes — the wizard then relies on live DB trims only.
 */
export function catalogTrims(make: string, model: string): string[] {
  const m = CATALOG[norm(make)];
  if (!m) return [];
  const candidates = [...(m.models?.[norm(model)] ?? []), ...(m.common ?? [])];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of candidates) {
    const k = norm(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
