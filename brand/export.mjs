/* Renders the logo reveal to MP4 with headless Chrome (frame-exact, 1920x1080, 60fps).
     1) node brand/serve.mjs          (keep running)
     2) node brand/export.mjs [page]  (default: sol-eclipse-reveal.html)
   The page encodes every frame with WebCodecs and uploads the file to serve.mjs,
   which saves it in brand/. Prints the page's console so failures are visible. */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PAGE = process.argv[2] || "sol-eclipse-reveal.html";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9339;
const profile = mkdtempSync(join(tmpdir(), "sol-export-"));

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1920,1080", "--hide-scrollbars", "--enable-features=WebCodecs",
  "about:blank"
], { stdio: "ignore" });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await wait(200);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page"); } catch {}
}
if (!target) { console.error("Chrome didn't start"); chrome.kill(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === "Runtime.consoleAPICalled") console.log("[page]", msg.params.args.map((a) => a.value ?? a.description).join(" "));
  if (msg.method === "Runtime.exceptionThrown") console.log("[page error]", msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: `http://localhost:8790/${PAGE}?export=1` });

const started = Date.now();
let state = "running";
while (Date.now() - started < 10 * 60 * 1000) {
  await wait(1500);
  const r = await send("Runtime.evaluate", { expression: "window.__exportState || 'loading'", returnByValue: true });
  state = r?.result?.value;
  if (state && state !== "running" && state !== "loading") break;
}
console.log("export:", state, `(${((Date.now() - started) / 1000).toFixed(0)}s)`);
ws.close();
chrome.kill();
process.exit(state === "done" ? 0 : 1);
