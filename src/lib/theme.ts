// Shared design tokens — matches the web app's blue brand identity.

export const theme = {
  colors: {
    brand:        "#1570EF",
    brandDark:    "#175CD3",
    brandLight:   "#EFF8FF",
    success:      "#039855",
    successBg:    "#ecfdf3",
    warning:      "#DC6803",
    warningBg:    "#fff8eb",
    error:        "#D92D20",
    errorBg:      "#fef3f2",
    white:        "#ffffff",
    black:        "#101828",
    text:         "#101828",
    textMuted:    "#475467",
    textLight:    "#667085",
    border:       "#eaecf0",
    borderStrong: "#d0d5dd",
    bg:           "#fcfcfd",
    bgAlt:        "#f9fafb",
    surface:      "#ffffff",
  },
  radius:  { sm: 6, md: 8, lg: 12, xl: 16, full: 999 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  fontWeight: {
    regular: "400" as const,
    medium:  "500" as const,
    semibold: "600" as const,
    bold:    "700" as const,
    extra:   "800" as const,
  },
};

export const formatEur = (n: number | null | undefined): string => {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `€${Math.round(n).toLocaleString("en-GB")}`;
  }
};

export const formatKm = (n: number | null | undefined): string =>
  n == null ? "—" : `${n.toLocaleString("en-GB")} km`;

export const formatRemaining = (endIso: string): string => {
  const ms = new Date(endIso).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};
