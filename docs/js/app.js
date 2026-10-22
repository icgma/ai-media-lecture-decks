import {
  decryptBytes,
  decryptJson,
  deriveKey,
  importRawKey,
} from "./crypto.js";

const PAYLOAD = "./decks";
const STORE_KEY = "decks:rawkey";
const STORE_META = "decks:meta";

const gate = document.getElementById("gate");
const app = document.getElementById("app");
const form = document.getElementById("gate-form");
const input = document.getElementById("password");
const error = document.getElementById("gate-error");
const button = document.getElementById("gate-btn");
const remember = document.getElementById("remember");
const list = document.getElementById("cards");
const lockBtn = document.getElementById("lock");

let key = null;
let meta = null;

init();

async function init() {
  const saved = readSaved();
  if (!saved) return;

  try {
    key = await importRawKey(saved.rawKey);
    meta = await decryptJson(await fetchJson(`${PAYLOAD}/index.bin`), key);
    render();
    unlock();
  } catch {
    clearSaved();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.hidden = true;
  button.disabled = true;
  button.textContent = "解密中…";

  try {
    const manifestPayload = await fetchJson(`${PAYLOAD}/index.bin`);
    const derived = await deriveKey(
      input.value,
      manifestPayload.salt,
      manifestPayload.iter,
    );
    const data = await decryptJson(manifestPayload, derived.key);

    key = derived.key;
    meta = data;
    if (remember.checked) saveKey(derived.raw);
    render();
    unlock();
    input.value = "";
  } catch {
    error.hidden = false;
    clearSaved();
  } finally {
    button.disabled = false;
    button.textContent = "打开课件";
  }
});

lockBtn.addEventListener("click", () => {
  clearSaved();
  key = null;
  meta = null;
  list.replaceChildren();
  app.hidden = true;
  gate.hidden = false;
  input.focus();
});

function unlock() {
  gate.hidden = true;
  app.hidden = false;
}

function render() {
  const cards = meta.decks.map((deck) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    card.innerHTML = `
      <span class="week">W${String(deck.week).padStart(2, "0")}</span>
      <span class="size">${(deck.bytes / 1024 / 1024).toFixed(1)} MB</span>
    `;
    card.addEventListener("click", () => openDeck(deck, card));
    return card;
  });
  list.replaceChildren(...cards);
}

async function openDeck(deck, card) {
  card.disabled = true;
  card.classList.add("busy");

  try {
    const payload = await fetchJson(`${PAYLOAD}/${deck.file}`);
    const plain = new TextDecoder().decode(await decryptBytes(payload, key));

    // Render in a fresh top-level document so the deck's own styles and
    // scripts never collide with this page.
    const tab = window.open("", "_blank");
    if (!tab) throw new Error("popup blocked");
    tab.document.open();
    tab.document.write(plain);
    tab.document.close();
  } catch (err) {
    console.error(err);
    alert("打开失败：浏览器可能拦截了新窗口，请允许弹出窗口后重试。");
  } finally {
    card.disabled = false;
    card.classList.remove("busy");
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.json();
}

function saveKey(rawKey) {
  try {
    sessionStorage.setItem(STORE_KEY, rawKey);
  } catch {
    /* storage unavailable; user re-enters passphrase next time */
  }
}

function readSaved() {
  try {
    const rawKey = sessionStorage.getItem(STORE_KEY);
    return rawKey ? { rawKey } : null;
  } catch {
    return null;
  }
}

function clearSaved() {
  try {
    sessionStorage.removeItem(STORE_KEY);
    sessionStorage.removeItem(STORE_META);
  } catch {
    /* ignore */
  }
}
