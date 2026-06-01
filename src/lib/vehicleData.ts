// Make/model reference data for the inspection wizard's searchable
// Make and Model dropdowns (step 1 — Details).
//
// Design notes:
// - `value` is the CANONICAL English make stored on vehicles.make. It is
//   kept lowercase-compatible with the valuation reference table
//   (src/lib/valuation.ts) so picking "Mercedes-Benz" / "Land Rover" still
//   resolves a market estimate. Never translate these — only the UI chrome
//   (labels/placeholders) is localised, exactly like the damage panels.
// - `label` (optional) is what the picker row shows when it differs from the
//   stored value (e.g. UAE buyers say "Range Rover" but the make is Land Rover).
// - `aliases` widen the type-to-filter search so "range rover", "vw",
//   "merc" etc. surface the right make without changing what gets stored.
// - Models are the common 15-30 (top makes) / 5-15 (others) variants. The
//   inspector can always pick "Other" to free-type anything not listed.

export interface MakeEntry {
  value: string;          // canonical, stored on vehicles.make
  label?: string;         // display override for the picker row
  aliases?: string[];     // extra search terms (lowercase)
  models: string[];       // common models, canonical English
}

// Top 10 most popular in the UAE→EU pipeline, in the exact order requested.
export const POPULAR_MAKES: MakeEntry[] = [
  {
    value: "Toyota",
    models: [
      "Land Cruiser", "Land Cruiser 70 Series", "Prado", "Fortuner", "Hilux",
      "Camry", "Corolla", "Corolla Cross", "RAV4", "Highlander", "Sequoia",
      "Tundra", "4Runner", "Rush", "Innova", "Granvia", "Hiace", "Yaris",
      "Avalon", "Supra", "GR86", "C-HR", "Crown", "bZ4X",
    ],
  },
  {
    value: "Mercedes-Benz",
    aliases: ["merc", "mercedes", "benz"],
    models: [
      "A-Class", "C-Class", "E-Class", "S-Class", "CLA", "CLE", "CLS",
      "GLA", "GLB", "GLC", "GLE", "GLS", "G-Class", "SL", "AMG GT",
      "GT 4-Door", "V-Class", "Vito", "EQA", "EQB", "EQE", "EQS",
      "Maybach S-Class", "Maybach GLS",
    ],
  },
  {
    value: "BMW",
    models: [
      "1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "6 Series",
      "7 Series", "8 Series", "X1", "X2", "X3", "X4", "X5", "X6", "X7", "XM",
      "Z4", "i4", "i5", "i7", "iX", "iX1", "iX3", "M2", "M3", "M4", "M5", "M8",
    ],
  },
  {
    value: "Nissan",
    models: [
      "Patrol", "Patrol Safari", "Armada", "X-Trail", "Qashqai", "Kicks",
      "Altima", "Maxima", "Sentra", "Sunny", "Pathfinder", "Murano", "Navara",
      "Urvan", "Terra", "Juke", "Z", "GT-R", "Patrol Nismo",
    ],
  },
  {
    value: "Lexus",
    models: [
      "LX", "GX", "RX", "NX", "UX", "TX", "ES", "IS", "LS", "LC", "RC", "RZ",
      "LM", "GS",
    ],
  },
  {
    value: "Porsche",
    models: [
      "911", "718 Cayman", "718 Boxster", "Cayenne", "Cayenne Coupe", "Macan",
      "Panamera", "Taycan", "911 Turbo", "911 GT3", "911 Turbo S",
    ],
  },
  {
    value: "Audi",
    models: [
      "A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q2", "Q3", "Q5", "Q7", "Q8",
      "e-tron", "e-tron GT", "Q4 e-tron", "Q8 e-tron", "TT", "R8", "RS3", "RS5",
      "RS6", "RS7", "RS Q8", "SQ5", "S8",
    ],
  },
  {
    value: "Land Rover",
    label: "Land Rover / Range Rover",
    aliases: ["range rover", "rangerover", "landrover", "range"],
    models: [
      "Range Rover", "Range Rover Sport", "Range Rover Velar",
      "Range Rover Evoque", "Defender", "Defender 90", "Defender 110",
      "Defender 130", "Discovery", "Discovery Sport",
    ],
  },
  {
    value: "Ford",
    models: [
      "F-150", "F-150 Raptor", "Mustang", "Mustang Mach-E", "Explorer",
      "Expedition", "Edge", "Escape", "Bronco", "Bronco Sport", "Ranger",
      "Ranger Raptor", "EcoSport", "Territory", "Taurus", "Focus", "Figo",
      "Transit", "GT",
    ],
  },
  {
    value: "Ferrari",
    models: [
      "296 GTB", "296 GTS", "SF90 Stradale", "SF90 Spider", "F8 Tributo",
      "488 GTB", "488 Pista", "Roma", "Portofino", "812 Superfast", "812 GTS",
      "Purosangue", "GTC4Lusso", "458 Italia", "California T",
    ],
  },
];

// Everything else, alphabetical. 5-15 common models each.
export const OTHER_MAKES: MakeEntry[] = [
  { value: "Acura", models: ["MDX", "RDX", "TLX", "ILX", "Integra", "NSX", "ZDX"] },
  { value: "Alfa Romeo", aliases: ["alfa"], models: ["Giulia", "Stelvio", "Tonale", "Giulietta", "4C"] },
  { value: "Aston Martin", aliases: ["aston"], models: ["DB11", "DB12", "Vantage", "DBS", "DBX", "Valkyrie", "Rapide"] },
  { value: "Bentley", models: ["Continental GT", "Flying Spur", "Bentayga", "Mulsanne", "Bacalar"] },
  { value: "Bugatti", models: ["Chiron", "Veyron", "Tourbillon", "Divo", "Mistral"] },
  { value: "Buick", models: ["Enclave", "Encore", "Envision", "Regal", "LaCrosse"] },
  { value: "Cadillac", aliases: ["caddy"], models: ["Escalade", "Escalade ESV", "XT4", "XT5", "XT6", "CT4", "CT5", "CT6", "Lyriq"] },
  { value: "Chevrolet", aliases: ["chevy"], models: ["Tahoe", "Suburban", "Silverado", "Camaro", "Corvette", "Malibu", "Captiva", "Traverse", "Blazer", "Trailblazer", "Groove", "Spark"] },
  { value: "Chrysler", models: ["300", "300C", "Pacifica"] },
  { value: "Citroën", aliases: ["citroen"], models: ["C3", "C4", "C5 Aircross", "Berlingo", "C-Elysée"] },
  { value: "Dodge", models: ["Charger", "Challenger", "Durango", "Ram 1500", "Journey"] },
  { value: "Fiat", models: ["500", "500X", "Tipo", "Panda", "Doblo"] },
  { value: "Genesis", models: ["G70", "G80", "G90", "GV70", "GV80", "GV60"] },
  { value: "GMC", models: ["Sierra", "Sierra Denali", "Yukon", "Yukon XL", "Acadia", "Terrain", "Canyon", "Hummer EV"] },
  { value: "Honda", models: ["Accord", "Civic", "CR-V", "HR-V", "Pilot", "City", "Jazz", "Odyssey", "Passport", "Ridgeline", "ZR-V"] },
  { value: "Hyundai", models: ["Tucson", "Santa Fe", "Elantra", "Sonata", "Accent", "Creta", "Palisade", "Kona", "Venue", "Staria", "Ioniq 5", "Ioniq 6", "Azera"] },
  { value: "Infiniti", models: ["Q50", "Q60", "QX50", "QX55", "QX60", "QX80"] },
  { value: "Isuzu", models: ["D-Max", "MU-X", "NPR", "Ascender"] },
  { value: "Jaguar", models: ["F-Pace", "E-Pace", "I-Pace", "XE", "XF", "XJ", "F-Type"] },
  { value: "Jeep", models: ["Wrangler", "Grand Cherokee", "Cherokee", "Compass", "Renegade", "Gladiator", "Wagoneer", "Grand Wagoneer"] },
  { value: "Kia", models: ["Sportage", "Sorento", "Seltos", "Cerato", "K5", "Carnival", "Telluride", "Picanto", "Rio", "Stinger", "Sonet", "EV6", "Niro"] },
  { value: "Lamborghini", aliases: ["lambo"], models: ["Huracán", "Aventador", "Urus", "Revuelto", "Gallardo"] },
  { value: "Lincoln", models: ["Navigator", "Aviator", "Nautilus", "Corsair", "Continental"] },
  { value: "Maserati", models: ["Ghibli", "Quattroporte", "Levante", "Grecale", "MC20", "GranTurismo"] },
  { value: "Maybach", models: ["S-Class", "GLS", "S680"] },
  { value: "Mazda", models: ["CX-5", "CX-30", "CX-9", "CX-60", "CX-90", "Mazda3", "Mazda6", "MX-5", "CX-3", "BT-50"] },
  { value: "McLaren", models: ["720S", "750S", "765LT", "Artura", "GT", "570S", "P1"] },
  { value: "MINI", aliases: ["mini cooper"], models: ["Cooper", "Cooper S", "Countryman", "Clubman", "John Cooper Works", "Electric"] },
  { value: "Mitsubishi", models: ["Pajero", "Montero Sport", "Outlander", "ASX", "Eclipse Cross", "L200", "Attrage", "Xpander", "Lancer"] },
  { value: "Pagani", models: ["Huayra", "Zonda", "Utopia"] },
  { value: "Peugeot", models: ["208", "308", "2008", "3008", "5008", "508", "Partner"] },
  { value: "Renault", models: ["Duster", "Koleos", "Megane", "Captur", "Talisman", "Symbol"] },
  { value: "Rolls-Royce", aliases: ["rolls", "rolls royce"], models: ["Phantom", "Ghost", "Wraith", "Dawn", "Cullinan", "Spectre"] },
  { value: "Smart", models: ["Fortwo", "Forfour", "#1", "#3"] },
  { value: "Subaru", models: ["Outback", "Forester", "XV", "Impreza", "Legacy", "WRX", "BRZ", "Ascent"] },
  { value: "Suzuki", models: ["Swift", "Vitara", "Grand Vitara", "Jimny", "Baleno", "Ciaz", "Ertiga", "Dzire"] },
  { value: "Tesla", models: ["Model 3", "Model S", "Model X", "Model Y", "Cybertruck"] },
  { value: "Volkswagen", aliases: ["vw"], models: ["Golf", "Passat", "Tiguan", "Touareg", "Teramont", "Jetta", "Polo", "T-Roc", "ID.4", "Arteon", "Atlas"] },
  { value: "Volvo", models: ["XC40", "XC60", "XC90", "S60", "S90", "V60", "V90", "C40", "EX30", "EX90"] },
];

// Full ordered list used to build the picker (popular first, then A-Z).
export const ALL_MAKES: MakeEntry[] = [...POPULAR_MAKES, ...OTHER_MAKES];

// ---- Market spec (regional variant) --------------------------------
// `value` is the canonical English token stored on vehicles.market_spec and
// shown verbatim on the web specs grid; `tkey` localises the picker row only.
// "Other" is handled by the picker's free-text fallback (no entry here).
export interface MarketSpecOption { value: string; tkey: string }

export const MARKET_SPECS: MarketSpecOption[] = [
  { value: "GCC Specs",        tkey: "market.gcc" },
  { value: "European Specs",   tkey: "market.european" },
  { value: "American Specs",   tkey: "market.american" },
  { value: "Canadian Specs",   tkey: "market.canadian" },
  { value: "Japanese Specs",   tkey: "market.japanese" },
  { value: "Korean Specs",     tkey: "market.korean" },
  { value: "Australian Specs", tkey: "market.australian" },
  { value: "UK Specs",         tkey: "market.uk" },
  { value: "Chinese Specs",    tkey: "market.chinese" },
  { value: "Mexican Specs",    tkey: "market.mexican" },
];

// Sentinel appended to both pickers — selecting it reveals a free-text input.
export const OTHER_OPTION = "__other__";

/** Case-insensitive lookup of a make entry by its stored canonical value. */
export function findMake(make: string): MakeEntry | undefined {
  const m = make.trim().toLowerCase();
  return ALL_MAKES.find((e) => e.value.toLowerCase() === m);
}

/** Models for a given (possibly free-typed) make, or [] if unknown. */
export function modelsForMake(make: string): string[] {
  return findMake(make)?.models ?? [];
}

/** True when the typed make matches one of our known canonical makes. */
export function isKnownMake(make: string): boolean {
  return !!findMake(make);
}

/** True when the typed model is one of the known models for its make. */
export function isKnownModel(make: string, model: string): boolean {
  const md = model.trim().toLowerCase();
  return modelsForMake(make).some((m) => m.toLowerCase() === md);
}

/**
 * Normalise a make string (e.g. from a VIN decoder) to our canonical value
 * so the dropdown pre-selects correctly. Matches on value, label, or alias.
 * Returns the canonical value, or the trimmed input unchanged if no match.
 */
export function canonicalizeMake(raw: string): string {
  const q = raw.trim().toLowerCase();
  if (!q) return raw.trim();
  for (const e of ALL_MAKES) {
    if (e.value.toLowerCase() === q) return e.value;
    if (e.label && e.label.toLowerCase() === q) return e.value;
    if (e.aliases?.some((a) => a === q)) return e.value;
  }
  // Loose contains-match (e.g. decoder returns "Mercedes-Benz AG" / "BMW M GmbH").
  for (const e of ALL_MAKES) {
    if (q.includes(e.value.toLowerCase()) || e.value.toLowerCase().includes(q)) return e.value;
    if (e.aliases?.some((a) => q.includes(a))) return e.value;
  }
  return raw.trim();
}

/** Filter make entries by a search query against value, label, and aliases. */
export function filterMakes(query: string): MakeEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_MAKES;
  return ALL_MAKES.filter(
    (e) =>
      e.value.toLowerCase().includes(q) ||
      e.label?.toLowerCase().includes(q) ||
      e.aliases?.some((a) => a.includes(q) || q.includes(a)),
  );
}

/** Filter a make's models by a search query. */
export function filterModels(make: string, query: string): string[] {
  const q = query.trim().toLowerCase();
  const models = modelsForMake(make);
  if (!q) return models;
  return models.filter((m) => m.toLowerCase().includes(q));
}
