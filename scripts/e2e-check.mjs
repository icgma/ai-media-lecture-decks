// End-to-end check against real Chrome over CDP: enter passphrase, open a deck,
// confirm the decrypted document is the original lecture HTML.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 9222;
const BASE = "http://localhost:8080/";
const PASSWORD = process.argv[2];
const ROOT_SHOTS = join(process.env.TEMP || ".", "deck-e2e-shots");

if (!PASSWORD) {
  console.error("usage: node scripts/e2e-check.mjs <passphrase>");
  process.exit(1);
}

mkdirSync(ROOT_SHOTS, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "deck-e2e-"));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "about:blank",
], { stdio: "ignore" });

const cleanup = () => {
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
};
process.on("exit", cleanup);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

try {
  const target = await waitForTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");

  // 1. Gate renders, app hidden.
  await send("Page.navigate", { url: BASE });
  await sleep(1200);
  check("gate visible on load", await evaluate(`!document.getElementById('gate').hidden`));
  check("app hidden before unlock", await evaluate(`document.getElementById('app').hidden`));

  // 2. Wrong passphrase shows error, does not unlock.
  await evaluate(`document.getElementById('password').value = 'wrong-passphrase'`);
  await evaluate(`document.getElementById('gate-form').requestSubmit()`);
  await sleep(2500);
  check("wrong passphrase rejected", await evaluate(`!document.getElementById('gate-error').hidden`));
  check("still locked after wrong passphrase", await evaluate(`document.getElementById('app').hidden`));

  // 3. Correct passphrase unlocks and lists 16 decks.
  await evaluate(`document.getElementById('password').value = ${JSON.stringify(PASSWORD)}`);
  await evaluate(`document.getElementById('gate-form').requestSubmit()`);
  await sleep(3000);
  check("unlocked with correct passphrase", await evaluate(`!document.getElementById('app').hidden`));
  const count = await evaluate(`document.querySelectorAll('#cards .card').length`);
  check("16 deck cards rendered", count === 16, `got ${count}`);

  // 4. Open deck W01 and confirm the decrypted document is the lecture.
  // Dispatch a real trusted mouse event so popup blocking behaves as it would
  // for a user click.
  const box = await evaluate(`(() => {
    const r = document.querySelectorAll('#cards .card')[0].getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  })()`);
  const { x, y } = JSON.parse(box);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(5000);

  const pages = await send("Target.getTargets");
  console.log("   targets:", pages.targetInfos.map((t) => `${t.type}:${t.url}`).join(" | "));
  const deckPage = pages.targetInfos.find(
    (t) => t.type === "page" && t.targetId !== target.id,
  );
  check("deck opened in a new tab", Boolean(deckPage));

  if (deckPage) {
    const att = await send("Target.attachToTarget", {
      targetId: deckPage.targetId,
      flatten: true,
    });
    const sessionId = att.sessionId;
    const sendSession = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    const evalSession = async (expression) => {
      const r = await sendSession("Runtime.evaluate", {
        expression,
        returnByValue: true,
      });
      return r.result?.value;
    };

    await sendSession("Runtime.enable");
    await sleep(3000);

    const probe = await evalSession(`JSON.stringify({
      title: document.title,
      textContentLen: (document.body?.textContent || '').length,
      slides: document.querySelectorAll('section').length,
      svgs: document.querySelectorAll('svg').length,
      canvases: document.querySelectorAll('canvas').length,
      stillUnpacking: Boolean(document.getElementById('__bundler_loading')),
      firstSlideText: (document.querySelector('section')?.textContent || '').replace(/\\s+/g, ' ').slice(0, 80),
    })`);
    console.log("   deck probe:", probe);
    const p = JSON.parse(probe);

    check("deck title is the real lecture title", /第1讲|课程导论/.test(p.title || ""), p.title);
    check("unpacking finished", !p.stillUnpacking);
    check("deck content present", p.textContentLen > 2000, `textContent=${p.textContentLen}`);
    check("slides rendered", p.slides > 10, `sections=${p.slides} svgs=${p.svgs} canvas=${p.canvases}`);
    console.log(`   first slide: ${p.firstSlideText}`);

    const shot = await sendSession("Page.captureScreenshot", { format: "png" });
    if (shot?.data) {
      writeFileSync(join(ROOT_SHOTS, "deck-w01.png"), Buffer.from(shot.data, "base64"));
      console.log(`   screenshot: ${join(ROOT_SHOTS, "deck-w01.png")}`);
    }
  }

  ws.close();
} catch (err) {
  console.error("E2E ERROR:", err.message);
  failures++;
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

async function waitForTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("Chrome DevTools endpoint never came up");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
