// Inline-SVG icon set (Feather-style strokes) replacing @expo/vector-icons.
// Vector-icon FONTS render unreliably in Expo web exports (missing glyphs /
// boxes on Safari), so we draw every glyph as an SVG path instead — works
// identically on web and native, no font loading required.

import { Svg, Path, Circle, Rect, Polyline, Line } from "react-native-svg";
import type { StyleProp, ViewStyle } from "react-native";

export type IconName =
  | "add-circle-outline" | "alert-circle-outline" | "camera" | "camera-outline"
  | "car-sport-outline" | "checkmark" | "checkmark-circle" | "checkmark-done-outline"
  | "chevron-forward" | "close" | "cloud-done-outline" | "create-outline"
  | "document-text-outline" | "eye-outline" | "lock-closed-outline" | "log-in-outline"
  | "log-out-outline" | "mail-outline" | "pricetag-outline" | "trash-outline"
  | "warning-outline" | "eye-off-outline" | "folder-open-outline" | "cloud-upload-outline"
  | "globe-outline" | "search-outline" | "close-circle" | "chevron-down" | "chevron-up"
  | "color-palette-outline" | "images-outline" | "key-outline";

export function Icon({
  name,
  size = 24,
  color = "currentColor",
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  // Presentation props set on <Svg> are inherited by child shapes in
  // react-native-svg (web + native).
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style,
  };

  switch (name) {
    case "checkmark":
      return <Svg {...p}><Polyline points="20 6 9 17 4 12" /></Svg>;
    case "checkmark-circle":
      return <Svg {...p}><Circle cx="12" cy="12" r="10" /><Path d="M8 12l2.5 2.5L16 9" /></Svg>;
    case "checkmark-done-outline":
      return <Svg {...p}><Path d="M18 6 7 17l-5-5" /><Path d="M22 10l-7.5 7.5L13 16" /></Svg>;
    case "close":
      return <Svg {...p}><Path d="M18 6 6 18" /><Path d="M6 6l12 12" /></Svg>;
    case "chevron-forward":
      return <Svg {...p}><Path d="M9 6l6 6-6 6" /></Svg>;
    case "add-circle-outline":
      return <Svg {...p}><Circle cx="12" cy="12" r="10" /><Line x1="12" y1="8" x2="12" y2="16" /><Line x1="8" y1="12" x2="16" y2="12" /></Svg>;
    case "alert-circle-outline":
      return <Svg {...p}><Circle cx="12" cy="12" r="10" /><Line x1="12" y1="8" x2="12" y2="12" /><Path d="M12 16h0.01" /></Svg>;
    case "warning-outline":
      return <Svg {...p}><Path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><Line x1="12" y1="9" x2="12" y2="13" /><Path d="M12 17h0.01" /></Svg>;
    case "camera":
    case "camera-outline":
      return <Svg {...p}><Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><Circle cx="12" cy="13" r="4" /></Svg>;
    case "car-sport-outline":
      return <Svg {...p}><Path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" /><Circle cx="7" cy="17" r="2" /><Circle cx="17" cy="17" r="2" /></Svg>;
    case "cloud-done-outline":
      return <Svg {...p}><Path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /><Path d="M9 13.5l2 2 3.5-3.5" /></Svg>;
    case "create-outline":
      return <Svg {...p}><Path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /><Path d="M15 5l4 4" /></Svg>;
    case "document-text-outline":
      return <Svg {...p}><Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><Polyline points="14 2 14 8 20 8" /><Line x1="16" y1="13" x2="8" y2="13" /><Line x1="16" y1="17" x2="8" y2="17" /><Line x1="10" y1="9" x2="8" y2="9" /></Svg>;
    case "eye-outline":
      return <Svg {...p}><Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><Circle cx="12" cy="12" r="3" /></Svg>;
    case "eye-off-outline":
      return <Svg {...p}><Path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><Path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><Line x1="1" y1="1" x2="23" y2="23" /></Svg>;
    case "lock-closed-outline":
      return <Svg {...p}><Rect x="3" y="11" width="18" height="11" rx="2" /><Path d="M7 11V7a5 5 0 0 1 10 0v4" /></Svg>;
    case "log-in-outline":
      return <Svg {...p}><Path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><Polyline points="10 17 15 12 10 7" /><Line x1="15" y1="12" x2="3" y2="12" /></Svg>;
    case "log-out-outline":
      return <Svg {...p}><Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><Polyline points="16 17 21 12 16 7" /><Line x1="21" y1="12" x2="9" y2="12" /></Svg>;
    case "mail-outline":
      return <Svg {...p}><Rect x="2" y="4" width="20" height="16" rx="2" /><Path d="M22 6l-10 7L2 6" /></Svg>;
    case "pricetag-outline":
      return <Svg {...p}><Path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><Line x1="7" y1="7" x2="7.01" y2="7" /></Svg>;
    case "trash-outline":
      return <Svg {...p}><Polyline points="3 6 5 6 21 6" /><Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Svg>;
    case "folder-open-outline":
      return <Svg {...p}><Path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></Svg>;
    case "cloud-upload-outline":
      return <Svg {...p}><Path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" /><Polyline points="16 16 12 12 8 16" /><Line x1="12" y1="12" x2="12" y2="21" /></Svg>;
    case "globe-outline":
      return <Svg {...p}><Circle cx="12" cy="12" r="10" /><Line x1="2" y1="12" x2="22" y2="12" /><Path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></Svg>;
    case "key-outline":
      return <Svg {...p}><Circle cx="7.5" cy="15.5" r="4.5" /><Path d="M10.7 12.3 19 4" /><Path d="M16 7l3 3" /><Path d="M14 9l3 3" /></Svg>;
    default:
      // Unknown name — render a neutral dot so layout never breaks.
      return <Svg {...p}><Circle cx="12" cy="12" r="9" /></Svg>;
  }
}
