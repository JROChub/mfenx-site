// Paddle billing links are not signed MFENX offers or license authorization.
let query = location.search;
const hadFragment = location.href.includes("#");
let cleaned = false;
try {
  history.replaceState(null, "", location.pathname);
  cleaned = location.search === "" && location.hash === "";
} catch {
  // No configuration or provider request is made without URL cleanup.
}

const PAYMENT_ORIGIN = "https://pay.mfenx.com";
const LICENSE_ORIGIN = "https://license.mfenx.com";
const PADDLE_SCRIPT = "https://cdn.paddle.com/paddle/v2/paddle.js";
const MAX_CONFIG = 4096;
const configKeys = ["schema", "enabled", "environment", "issuer", "origin", "paddle_client_token", "key_id", "public_key_spki_base64"];
const byId = (id) => document.getElementById(id);
const status = byId("payment-status");
const button = byId("payment-open");
let pending = null;
let active = true;
let opening = false;

function require(condition) {
  if (!condition) throw new Error("billing unavailable");
}

function localBoundary() {
  require(cleaned && active && location.origin === PAYMENT_ORIGIN && window.top === window.self &&
    ["/billing/", "/billing/index.html"].includes(location.pathname) &&
    location.search === "" && location.hash === "");
}

function canonical(value) {
  if (value !== null && typeof value === "object") {
    require(!Array.isArray(value));
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function parseConfig(text) {
  require(text.length <= MAX_CONFIG && /^[\x20-\x7e]+$/.test(text));
  const config = JSON.parse(text);
  require(config !== null && typeof config === "object" && !Array.isArray(config) &&
    Object.keys(config).length === configKeys.length && configKeys.every((key) => Object.hasOwn(config, key)) &&
    canonical(config) === text);
  require(config.schema === "mfenx.gate.checkout-config.v1" && config.enabled === true &&
    config.origin === PAYMENT_ORIGIN && config.issuer === LICENSE_ORIGIN &&
    ["sandbox", "live"].includes(config.environment) &&
    typeof config.key_id === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(config.key_id) &&
    typeof config.paddle_client_token === "string" &&
    /^(test|live)_[A-Za-z0-9]{15,100}$/.test(config.paddle_client_token) &&
    config.paddle_client_token.startsWith(config.environment === "sandbox" ? "test_" : "live_"));
  // Validate the shared public configuration's canonical Ed25519 SPKI shape.
  // No signature or ownership is inferred from the provider's transaction link.
  require(typeof config.public_key_spki_base64 === "string" &&
    /^[A-Za-z0-9+/]{59}=$/.test(config.public_key_spki_base64));
  const key = atob(config.public_key_spki_base64);
  require(key.length === 44 && btoa(key) === config.public_key_spki_base64 &&
    [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]
      .every((value, index) => key.charCodeAt(index) === value));
  return config;
}

async function configuration() {
  localBoundary();
  const response = await fetch("/checkout-config.json", {
    credentials: "omit", mode: "same-origin", cache: "no-store", redirect: "error",
    referrerPolicy: "no-referrer", signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" },
  });
  require(response.ok && response.url === PAYMENT_ORIGIN + "/checkout-config.json" &&
    response.headers.get("content-type")?.split(";")[0].trim() === "application/json");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_CONFIG) {
      await reader.cancel();
      throw new Error("billing unavailable");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  localBoundary();
  return parseConfig(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function fail(message) {
  pending = null;
  button.disabled = true;
  byId("payment-review").hidden = true;
  status.textContent = message;
}

function loadPaddle() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let finished = false;
    const finish = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (ok) resolve();
      else { script.remove(); reject(new Error("billing unavailable")); }
    };
    const timeout = setTimeout(() => finish(false), 15000);
    script.src = PADDLE_SCRIPT;
    script.referrerPolicy = "no-referrer";
    script.async = true;
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.append(script);
  });
}

button.addEventListener("click", async () => {
  if (!pending || opening || !active) return;
  opening = true;
  button.disabled = true;
  const chosen = pending;
  try {
    localBoundary();
    // Closing the shared payment configuration also closes billing continuation.
    require(canonical(await configuration()) === canonical(chosen.config));
    require(active && pending === chosen);
    status.textContent = "Opening Paddle. Review the purpose and any amount due before confirming.";
    await loadPaddle();
    localBoundary();
    require(pending === chosen && typeof window.Paddle?.Initialize === "function" &&
      typeof window.Paddle?.Checkout?.open === "function");
    if (chosen.config.environment === "sandbox") window.Paddle.Environment.set("sandbox");
    window.Paddle.Initialize({ token: chosen.config.paddle_client_token });
    // Only the already-created transaction is passed. No customer, items,
    // callbacks, purchase credentials or fulfillment authority are introduced.
    window.Paddle.Checkout.open({
      transactionId: chosen.transaction,
      settings: { displayMode: "overlay", theme: "light", allowLogout: false,
        showAddDiscounts: false, successUrl: LICENSE_ORIGIN + "/gate/license/" },
    });
    pending = null;
    button.textContent = "Paddle opened";
    status.textContent = "Paddle opened. Complete or close the request there; this page does not confirm its result.";
  } catch {
    fail("Billing could not be opened safely. Reopen your Paddle billing link or use the customer portal from your receipt.");
  }
});

document.querySelector(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  byId("main").focus();
  byId("main").scrollIntoView();
});

addEventListener("pagehide", () => {
  active = false;
  query = "";
  fail("Reopen your Paddle billing link to continue.");
});

async function start() {
  try {
    localBoundary();
    require(!hadFragment && query.length <= 64 && /^\?_ptxn=txn_[a-z0-9]{26}$/.test(query));
    const transaction = query.slice(7);
    query = "";
    const config = await configuration();
    localBoundary();
    pending = { transaction, config };
    byId("payment-environment").textContent = config.environment === "sandbox"
      ? "Sandbox test. No real payment is collected."
      : "Live billing. Paddle will display any amount due.";
    byId("payment-review").hidden = false;
    button.disabled = false;
    status.textContent = "Billing link ready. Review the request in Paddle before confirming.";
  } catch {
    query = "";
    fail("A complete Paddle billing link and an available payment workspace are required. Use the link from your receipt or subscription email.");
  }
}

void start();
