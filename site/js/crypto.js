const enc = new TextEncoder();

export async function decryptBytes(payload, key) {
  const iv = b64bytes(payload.iv);
  const data = b64bytes(payload.data);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
}

export async function decryptJson(payload, key) {
  const plain = await decryptBytes(payload, key);
  return JSON.parse(new TextDecoder().decode(plain));
}

// Returns { key, raw } — raw is the exportable AES key so "remember" can
// restore it without asking for the passphrase again on this tab.
export async function deriveKey(password, saltB64, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64bytes(saltB64), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    true,
    ["decrypt"],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return { key, raw: toB64(raw) };
}

export async function importRawKey(rawB64) {
  return crypto.subtle.importKey(
    "raw",
    b64bytes(rawB64),
    { name: "AES-GCM", length: 256 },
    true,
    ["decrypt"],
  );
}

export function b64bytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
