// Encrypt the 16 lecture HTML decks and emit a static decryptor site.
// Only ciphertext is committed; plaintext HTML never enters git.
import { webcrypto as crypto } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_DIR = join(ROOT, "site");
const DIST_DIR = join(ROOT, "dist");
const PAYLOAD_DIR = "decks";

// 210k iterations matches skill-kit; the master key is derived once so the
// per-file cost is a single KDF, not one per deck.
const ITERATIONS = 210_000;

const DEFAULT_SRC = String.raw`D:\STU\01-教学\教学教改\智慧课程建设\智慧树交付_AI驱动传媒制作\02_智能体授课\授课PPT_离线版`;

loadEnv(join(ROOT, ".env"));

const password = process.env.DECKS_PASSWORD;
if (!password || password === "change-me") {
  console.error(
    "Missing DECKS_PASSWORD. Copy .env.example to .env and set a real passphrase.",
  );
  process.exit(1);
}

const srcDir = resolve(process.argv[2] || process.env.DECKS_SOURCE || DEFAULT_SRC);
if (!existsSync(srcDir)) {
  console.error(`Source directory not found: ${srcDir}`);
  process.exit(1);
}

const decks = readdirSync(srcDir)
  .filter((name) => name.toLowerCase().endsWith(".html"))
  .sort((a, b) => weekOf(a) - weekOf(b) || a.localeCompare(b, "zh"));

if (decks.length === 0) {
  console.error(`No .html files found in ${srcDir}`);
  process.exit(1);
}

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(join(DIST_DIR, PAYLOAD_DIR), { recursive: true });
copyDir(SITE_DIR, DIST_DIR);

const salt = crypto.getRandomValues(new Uint8Array(16));
const masterKey = await deriveKey(password, salt);

const manifest = [];
for (const name of decks) {
  const abs = join(srcDir, name);
  const plain = readFileSync(abs);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    plain,
  );
  const id = deckId(name);
  const file = `${id}.bin`;

  writeFileSync(
    join(DIST_DIR, PAYLOAD_DIR, file),
    JSON.stringify({
      v: 1,
      iter: ITERATIONS,
      salt: b64(salt),
      iv: b64(iv),
      data: b64(new Uint8Array(cipher)),
    }),
  );

  manifest.push({
    id,
    week: weekOf(name),
    file,
    bytes: plain.byteLength,
  });
}

// Encrypt the manifest too: deck titles are part of what the password protects.
const manifestIv = crypto.getRandomValues(new Uint8Array(12));
const manifestCipher = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv: manifestIv },
  masterKey,
  new TextEncoder().encode(JSON.stringify({ decks: manifest })),
);
writeFileSync(
  join(DIST_DIR, PAYLOAD_DIR, "index.bin"),
  JSON.stringify({
    v: 1,
    iter: ITERATIONS,
    salt: b64(salt),
    iv: b64(manifestIv),
    data: b64(new Uint8Array(manifestCipher)),
  }),
);

writeFileSync(join(DIST_DIR, "robots.txt"), "User-agent: *\nDisallow: /\n");

const totalMb = manifest.reduce((n, d) => n + d.bytes, 0) / 1024 / 1024;
console.log(
  `Encrypted ${manifest.length} deck(s), ${totalMb.toFixed(1)} MB plaintext -> dist/`,
);
console.log(`Source: ${srcDir}`);

async function deriveKey(pwd, saltBytes) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pwd),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function weekOf(name) {
  const m = name.match(/第\s*(\d+)\s*周/);
  return m ? Number(m[1]) : 999;
}

function deckId(name) {
  const m = name.match(/第\s*(\d+)\s*周-(.+)\.html$/i);
  if (m) return `w${String(m[1]).padStart(2, "0")}`;
  return basename(name, ".html").replace(/[^\w.-]+/g, "-");
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
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

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dest = join(to, name);
    if (statSync(src).isDirectory()) copyDir(src, dest);
    else {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
  }
}
