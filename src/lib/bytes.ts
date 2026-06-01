// Base64 → bytes, dependency-free (no expo-file-system / base64-arraybuffer,
// so it stays OTA-safe and avoids SDK version traps).
//
// Why this exists: React Native's `fetch(file://).blob()` hands the Supabase
// client a Blob whose bytes never cross the JS bridge, so storage.upload()
// stores a 0-byte object. The fix is to upload REAL bytes — we decode the
// (already-compressed) image's base64 to a Uint8Array and upload that.

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < CHARS.length; i++) t[CHARS.charCodeAt(i)] = i;
  return t;
})();

/**
 * Decode a base64 string (optionally a data: URI) to an exact-length
 * Uint8Array. Ignores whitespace, newlines and '=' padding. Streaming
 * 6-bits-at-a-time decode — correct for any input length.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const s = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const len = s.length;
  let valid = 0;
  for (let i = 0; i < len; i++) if (LOOKUP[s.charCodeAt(i)] >= 0) valid++;
  const out = new Uint8Array(Math.floor((valid * 3) / 4));
  let acc = 0, bits = 0, p = 0;
  for (let i = 0; i < len; i++) {
    const v = LOOKUP[s.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
