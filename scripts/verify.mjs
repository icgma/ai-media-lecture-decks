// Round-trip check: decrypt every payload and byte-compare against source.
import { webcrypto as crypto } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const SRC = resolve(
  process.argv[2] ||
    process.env.DECKS_SOURCE ||
    String.raw`D:\STU\01-教学\教学教改\智慧课程建设\智慧树交付_AI驱动传媒制作\02_智能体授课\授课PPT_离线版`,
);

loadEnv(join(ROOT, ".env"));
const password = process.env.DECKS_PASSWORD;
if (!password) {
  console.error("Missing DECKS_PASSWORD in .env");
  process.exit(1);
}

const manifestPayload = JSON.parse(
  readFileSync(join(DIST, "decks", "index.bin"), "utf8"),
);
const key = await deriveKey(password, manifestPayload.salt, manifestPayload.iter);
const manifest = await decryptJson(manifestPayload, key);

let pass = 0;
let fail = 0;

for (const deck of manifest.decks) {
  const payload = JSON.parse(
    readFileSync(join(DIST, "decks", deck.file), "utf8"),
  );
  const plain = Buffer.from(await decryptBytes(payload, key));

  const source = readdirSync(SRC).find((n) => {
    const m = n.match(/第\s*(\d+)\s*周/);
    return m && Number(m[1]) === deck.week && n.endsWith(".html");
  });

  if (!source) {
    console.log(`FAIL ${deck.file}: no source for week ${deck.week}`);
    fail++;
    continue;
  }

  const original = readFileSync(join(SRC, source));
  if (plain.equals(original)) {
    console.log(`OK   ${deck.file} <- ${source} (${original.length} bytes)`);
    pass++;
  } else {
    console.log(
      `FAIL ${deck.file}: size ${plain.length} vs ${original.length}`,
    );
    fail++;
  }
}

// Wrong passphrase must not decrypt.
let rejected = false;
try {
  const wrong = await deriveKey("definitely-wrong", manifestPayload.salt, manifestPayload.iter);
  await decryptJson(manifestPayload, wrong);
} catch {
  rejected = true;
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`wrong passphrase rejected: ${rejected ? "YES" : "NO — SECURITY BUG"}`);

if (fail > 0 || !rejected) process.exit(1);

async function deriveKey(pwd, saltB64, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pwd),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64bytes(saltB64), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

async function decryptBytes(payload, k) {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64bytes(payload.iv) },
    k,
    b64bytes(payload.data),
  );
}

async function decryptJson(payload, k) {
  return JSON.parse(
    new TextDecoder().decode(await decryptBytes(payload, k)),
  );
}

function b64bytes(str) {
  return new Uint8Array(Buffer.from(str, "base64"));
}

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
