import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/gate-legacy-links.js", import.meta.url), "utf8");
function redirect(url, script = source) {
  const destinations = [];
  vm.runInNewContext(script, {
    URL,
    window: { location: { href: url, replace: (destination) => destinations.push(destination) } },
  });
  assert.ok(destinations.length <= 1);
  return destinations[0] ?? null;
}
for (const path of ["/", "/index.html", "/?utm_source=docs", "/#main", "/#assurance", "/verify/?verify=x", "/labs/#sfcs", "/?redirect=https://outside.invalid"]) {
  assert.equal(redirect("https://mfenx.com" + path), null, path);
}
for (const hash of ["#sfcs", "#sfcs-run", "#verify"]) {
  assert.equal(redirect("https://mfenx.com/" + hash), "https://mfenx.com/labs/" + hash);
}
for (const key of ["mode", "city", "time", "panel", "verify", "portal"]) {
  assert.equal(redirect(`https://mfenx.com/?${key}=value&keep=1#detail`), `https://mfenx.com/labs/?${key}=value&keep=1#detail`);
}
assert.equal(redirect("http://127.0.0.1:4321/index.html?portal=1&verify=private%20input#verify"),
  "http://127.0.0.1:4321/labs/?portal=1&verify=private%20input#verify");
assert.equal(redirect("https://mfenx.com/?verify=https%3A%2F%2Foutside.invalid&next=%2F%2Foutside.invalid"),
  "https://mfenx.com/labs/?verify=https%3A%2F%2Foutside.invalid&next=%2F%2Foutside.invalid");
const powerHouseSource = readFileSync(new URL("../public/power-house/legacy-links.js", import.meta.url), "utf8");
const powerHouseRedirect = (url) => redirect(url, powerHouseSource);
for (const path of ["/power-house/", "/power-house/index.html", "/power-house/?utm_source=docs",
  "/power-house/#how", "/power-house/#evidence", "/power-house/?redirect=https://outside.invalid",
  "/?mode=research", "/verify/?verify=x", "/labs/#sfcs", "/power-house-other/?portal=1"]) {
  assert.equal(powerHouseRedirect("https://mfenx.com" + path), null, path);
}
for (const path of ["/power-house/", "/power-house/index.html"]) {
  for (const hash of ["#sfcs", "#sfcs-run", "#verify"]) {
    assert.equal(powerHouseRedirect("https://mfenx.com" + path + hash), "https://mfenx.com/labs/" + hash);
  }
  for (const key of ["mode", "city", "time", "panel", "verify", "portal"]) {
    assert.equal(powerHouseRedirect(`https://mfenx.com${path}?${key}=value&keep=1#detail`),
      `https://mfenx.com/labs/?${key}=value&keep=1#detail`);
  }
}
assert.equal(powerHouseRedirect("http://127.0.0.1:4321/power-house/index.html?portal=1&verify=private%20input#verify"),
  "http://127.0.0.1:4321/labs/?portal=1&verify=private%20input#verify");
assert.equal(powerHouseRedirect("https://mfenx.com/power-house/?verify=https%3A%2F%2Foutside.invalid&next=%2F%2Foutside.invalid"),
  "https://mfenx.com/labs/?verify=https%3A%2F%2Foutside.invalid&next=%2F%2Foutside.invalid");
console.log("legacy research deep links: PASS (49 home and Power House cases)");
