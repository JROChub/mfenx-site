// Real-browser journey for tweek-ing: protect a sample image + a source file, download the outputs,
// then verify them on /tweek/verify/. Serves public/ from a local static server.
// Run: node tests/browser_tweek.mjs [--chromium /usr/bin/chromium] [--shots /tmp/tweek-shots]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1]] : [])).filter((x) => x.length));
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "public");
const SHOTS = args.shots || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const require = createRequire(path.join(execSync("npm root -g").toString().trim(), "x.js"));
let pw; try { pw = require("playwright"); } catch { pw = require("@playwright/test"); }
const { chromium } = pw;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tweek-"));
const consoleErrors = [];

const browser = await chromium.launch({ executablePath: args.chromium || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 1000 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: true }); };
const saveDownload = async (d) => { const p = path.join(tmp, d.suggestedFilename()); await d.saveAs(p); return p; };

let step = "";
try {
  // ── protect page ──
  step = "load /tweek/";
  await page.goto(base + "/tweek/", { waitUntil: "load" });
  await page.waitForFunction(() => /^tweek:[a-z2-7]+ · (Ed25519|ES256)$/.test(document.getElementById("identity").textContent), null, { timeout: 15000 });
  const identity = await page.textContent("#identity");
  console.log("  ok  signing identity generated:", identity);
  await shot("01-protect-empty");

  step = "sample run (timestamp off for determinism)";
  await page.uncheck("#opt-timestamp");
  await page.fill("#creator", "Browser Test Creator");
  await page.click("#load-example");
  await page.waitForSelector(".result-card:not(.pending):not(.error)", { timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll(".result-card:not(.pending):not(.error)").length >= 2 && !document.querySelector(".result-card.pending"), null, { timeout: 90000 });
  const cards = await page.$$(".result-card");
  assert.ok(cards.length >= 2, "two result cards");
  const cardText = await page.textContent("#results");
  assert.match(cardText, /tw1_[a-z2-7]{8}/); assert.match(cardText, /tweek-dct-qim-v1 · \d+(\.\d)? dB/); assert.match(cardText, /tweek-zw-v1/);
  const psnr = parseFloat(/tweek-dct-qim-v1 · (\d+(?:\.\d)?) dB/.exec(cardText)[1]);
  assert.ok(psnr > 40, `PSNR ${psnr} > 40 dB`);
  console.log(`  ok  sample image + idea text protected (image PSNR ${psnr} dB)`);
  await shot("02-protect-results");

  step = "download outputs";
  const dls = {};
  for (const card of await page.$$(".result-card")) {
    for (const a of await card.$$(".downloads a[download]")) {
      const [d] = await Promise.all([page.waitForEvent("download"), a.click()]);
      dls[d.suggestedFilename()] = await saveDownload(d);
    }
  }
  const pngName = Object.keys(dls).find((n) => n.endsWith(".tweek.png")); const pngJson = Object.keys(dls).find((n) => n === pngName.replace(".tweek.png", ".tweek.json"));
  const txtName = Object.keys(dls).find((n) => /\.tweek\.(txt|md)$/.test(n)); const txtJson = Object.keys(dls).find((n) => n.startsWith("idea-") && n.endsWith(".tweek.json"));
  assert.ok(pngName && pngJson && txtName && txtJson, "downloads present: " + Object.keys(dls).join(", "));
  console.log("  ok  downloads:", Object.keys(dls).join(", "));

  step = "protect a source file via file input";
  const py = path.join(tmp, "idea.py"); fs.writeFileSync(py, "#!/usr/bin/env python3\n\ndef fold_laundry():\n    return 'poem'\n");
  await page.setInputFiles("#files", py);
  await page.click("#protect-button");
  await page.waitForFunction(() => document.querySelectorAll(".result-card:not(.pending):not(.error)").length >= 3 && !document.querySelector(".result-card.pending"), null, { timeout: 30000 });
  const first = await page.$(".result-card:has(h2:text-is(\"idea.py\"))");
  assert.ok(first, "card for idea.py");
  for (const a of await first.$$(".downloads a[download]")) { const [d] = await Promise.all([page.waitForEvent("download"), a.click()]); dls[d.suggestedFilename()] = await saveDownload(d); }
  assert.ok(dls["idea.tweek.py"] && dls["idea.tweek.json"]);
  const pyOut = fs.readFileSync(dls["idea.tweek.py"], "utf8");
  assert.ok(pyOut.startsWith("#!/usr/bin/env python3\n# ═══ tweek-ing provenance"), "shebang preserved, header follows");
  assert.ok(pyOut.endsWith("def fold_laundry():\n    return 'poem'\n"));
  execSync(`python3 -I -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "${dls["idea.tweek.py"]}"`); // still valid Python
  console.log("  ok  idea.py protected; output still parses as Python");

  // ── verify page ──
  step = "verify protected PNG with sidecar";
  await page.goto(base + "/tweek/verify/", { waitUntil: "load" });
  await page.setInputFiles("#file", dls[pngName]);
  await page.setInputFiles("#sidecar", dls[pngJson]);
  await page.waitForFunction(() => document.getElementById("result-state").textContent === "VERIFIED", null, { timeout: 60000 });
  let checks = await page.$$eval("#checks li", (els) => els.map((e) => e.textContent));
  assert.ok(checks.some((c) => /Content integrity.*Pass$/.test(c)), checks.join("\n"));
  assert.ok(checks.some((c) => /^Signature.*Pass$/.test(c)));
  assert.ok(checks.some((c) => /Invisible watermark.*matching the manifest.*Pass$/.test(c)));
  assert.ok(checks.some((c) => /Declared AI policy.*Pass$/.test(c)));
  console.log("  ok  PNG verified: signature, digest, policy, watermark all pass");
  await shot("03-verify-png");

  step = "verify PNG after metadata strip (watermark-only)";
  const { containers } = await import("../public/tweek/engine/containers.mjs");
  const naked = containers.png.strip(new Uint8Array(fs.readFileSync(dls[pngName])));
  const nakedPath = path.join(tmp, "naked.png"); fs.writeFileSync(nakedPath, naked);
  await page.click("#clear-button");
  await page.setInputFiles("#file", nakedPath);
  await page.waitForFunction(() => document.getElementById("result-state").textContent === "WATERMARK FOUND", null, { timeout: 60000 });
  const meta = await page.textContent("#meta");
  assert.match(meta, /tw1_[a-z2-7]{8}/);
  console.log("  ok  stripped PNG still identified by watermark");
  await shot("04-verify-watermark-only");

  step = "verify tampered PNG fails";
  const t = new Uint8Array(fs.readFileSync(dls[pngName])); const i = Buffer.from(t).indexOf("IDAT"); t[i + 30] ^= 0xff;
  const tPath = path.join(tmp, "tampered.png"); fs.writeFileSync(tPath, t);
  await page.click("#clear-button");
  await page.setInputFiles("#file", tPath);
  await page.waitForFunction(() => ["FAILED", "VERIFIED", "WATERMARK FOUND", "NOTHING FOUND"].includes(document.getElementById("result-state").textContent), null, { timeout: 60000 });
  assert.equal(await page.textContent("#result-state"), "FAILED");
  checks = await page.$$eval("#checks li", (els) => els.map((e) => e.textContent));
  assert.ok(checks.some((c) => /Content integrity.*Fail$/.test(c)));
  console.log("  ok  tampered PNG reported as FAILED on content integrity");

  step = "verify protected .py with sidecar";
  await page.click("#clear-button");
  await page.setInputFiles("#file", dls["idea.tweek.py"]);
  await page.setInputFiles("#sidecar", dls["idea.tweek.json"]);
  await page.waitForFunction(() => document.getElementById("result-state").textContent === "VERIFIED", null, { timeout: 60000 });
  console.log("  ok  idea.tweek.py verified with sidecar");
  await shot("05-verify-py");

  step = "policy page renders";
  const r = await page.goto(base + "/tweek/policy/no-ai/"); assert.equal(r.status(), 200);
  assert.match(await page.textContent("h1"), /Prohibit all AI\/ML training/);
  console.log("  ok  policy page");

  step = "responsive layout of tweek routes (same rules as browser_site_design.py)";
  for (const route of ["/tweek/", "/tweek/verify/", "/tweek/policy/no-ai/"]) for (const width of [320, 390, 768, 1440]) {
    const p2 = await ctx.newPage(); await p2.setViewportSize({ width, height: 1000 });
    const errs = []; p2.on("pageerror", (e) => errs.push(e.message));
    const resp = await p2.goto(base + route, { waitUntil: "networkidle" });
    assert.equal(resp.status(), 200, route);
    assert.equal(await p2.title(), "MFENX", route + " title");
    assert.equal(await p2.locator("h1:visible").count(), 1, route + " one h1");
    assert.ok(await p2.evaluate("document.documentElement.scrollWidth <= innerWidth"), `${route} at ${width}px: horizontal overflow`);
    const clipped = await p2.evaluate(`(() => [...document.querySelectorAll('h1, .site-header a')].filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.left < -1 || r.right > innerWidth + 1); }).map(n => n.textContent.trim()))()`);
    assert.deepEqual(clipped, [], `${route} at ${width}px: clipped ${clipped}`);
    assert.deepEqual(errs, [], `${route} at ${width}px: page errors`);
    await p2.close();
  }
  console.log("  ok  tweek routes: title, single h1, no overflow, no clipped nav at 320/390/768/1440");

  step = "homepage links";
  await page.goto(base + "/"); assert.ok(await page.$('a[href="/tweek/"]'));
  console.log("  ok  homepage links to /tweek/");

  const realErrors = consoleErrors.filter((e) => !/favicon/.test(e));
  assert.deepEqual(realErrors, [], "no console errors");
  console.log("\nbrowser journey: PASS");
} catch (e) {
  await shot("99-failure");
  console.error(`\nFAIL at step: ${step}\n`, e.message || e);
  if (consoleErrors.length) console.error("console:", consoleErrors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
