// This origin handles payment only. License keys and fulfillment stay elsewhere.
let fragment = location.hash;
const hadQuery = location.search !== "";
let cleaned = false;
try {
  history.replaceState(null, "", location.pathname);
  cleaned = location.hash === "" && location.search === "";
} catch {
  // Never contact configuration or payment services if URL cleanup fails.
}

const PAYMENT_ORIGIN = "https://pay.mfenx.com";
const LICENSE_ORIGIN = "https://license.mfenx.com";
const PADDLE_SCRIPT = "https://cdn.paddle.com/paddle/v2/paddle.js";
const MAX_DOCUMENT = 4096;
const byId = (id) => document.getElementById(id);
const status = byId("payment-status");
const button = byId("payment-open");
const plans = Object.freeze({
  team: { name: "Team", price: 39900, interval: "month", label: "$399 USD / month" },
  business: { name: "Business", price: 149900, interval: "month", label: "$1,499 USD / month" },
  private: { name: "Private", price: 2400000, interval: "year", label: "$24,000 USD / year" },
});
const envelopeKeys = ["algorithm", "key_id", "payload", "signature"];
const payloadKeys = ["schema", "issuer", "audience", "environment", "key_id", "transaction_id", "plan", "currency", "unit_price_minor", "interval", "quantity", "issued_at", "expires_at"];
const configKeys = ["schema", "enabled", "environment", "issuer", "origin", "paddle_client_token", "key_id", "public_key_spki_base64"];
let pending = null;
let expiryTimer = null;
let active = true;
let opening = false;

function require(condition) {
  if (!condition) throw new Error("invalid checkout");
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function canonical(value) {
  if (value !== null && typeof value === "object") {
    require(!Array.isArray(value));
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function canonicalDocument(text) {
  require(typeof text === "string" && text.length <= MAX_DOCUMENT && /^[\x20-\x7e]+$/.test(text));
  const value = JSON.parse(text);
  // A duplicate key, alternate escape, whitespace or number spelling cannot round-trip.
  require(canonical(value) === text);
  return value;
}

function base64(text, size) {
  require(typeof text === "string" && text.length === Math.ceil(size / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(text));
  const decoded = atob(text);
  require(decoded.length === size && btoa(decoded) === text);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function current(payload) {
  const now = Math.floor(Date.now() / 1000);
  require(Number.isSafeInteger(now) && Number.isSafeInteger(payload.issued_at) &&
    Number.isSafeInteger(payload.expires_at) && payload.issued_at > 0 &&
    payload.expires_at - payload.issued_at === 300 && payload.issued_at <= now + 60 &&
    payload.expires_at > now);
}

function parseTicket(raw) {
  require(raw.length <= MAX_DOCUMENT + 8 && /^#ticket=[A-Za-z0-9_-]+$/.test(raw));
  const encoded = raw.slice(8);
  require(encoded.length <= MAX_DOCUMENT && encoded.length % 4 !== 1);
  const decoded = atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - encoded.length % 4) % 4));
  require(btoa(decoded).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === encoded);
  const envelope = canonicalDocument(decoded);
  require(exactKeys(envelope, envelopeKeys) && envelope.algorithm === "Ed25519" &&
    typeof envelope.key_id === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(envelope.key_id));
  const payload = envelope.payload;
  require(exactKeys(payload, payloadKeys) && payload.schema === "mfenx.gate.checkout.v1" &&
    payload.issuer === LICENSE_ORIGIN && payload.audience === PAYMENT_ORIGIN &&
    ["sandbox", "live"].includes(payload.environment) && payload.key_id === envelope.key_id &&
    typeof payload.transaction_id === "string" && /^txn_[a-z0-9]{26}$/.test(payload.transaction_id) &&
    typeof payload.plan === "string" && Object.hasOwn(plans, payload.plan) &&
    payload.currency === "USD" && payload.quantity === 1);
  const offer = plans[payload.plan];
  require(payload.unit_price_minor === offer.price && payload.interval === offer.interval);
  current(payload);
  return { payload, signature: base64(envelope.signature, 64), keyId: envelope.key_id };
}

async function configuration() {
  const response = await fetch("/checkout-config.json", {
    credentials: "omit", mode: "same-origin", cache: "no-store", redirect: "error",
    referrerPolicy: "no-referrer", signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" },
  });
  require(response.ok && response.url === PAYMENT_ORIGIN + "/checkout-config.json" &&
    response.headers.get("content-type")?.split(";")[0].trim() === "application/json");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_DOCUMENT) {
      await reader.cancel();
      throw new Error("oversized configuration");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const config = canonicalDocument(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  require(exactKeys(config, configKeys) && config.schema === "mfenx.gate.checkout-config.v1" &&
    typeof config.enabled === "boolean" && config.enabled &&
    config.origin === PAYMENT_ORIGIN && location.origin === config.origin &&
    config.issuer === LICENSE_ORIGIN && ["sandbox", "live"].includes(config.environment) &&
    typeof config.key_id === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(config.key_id) &&
    typeof config.paddle_client_token === "string" &&
    /^(test|live)_[A-Za-z0-9]{15,100}$/.test(config.paddle_client_token) &&
    config.paddle_client_token.startsWith(config.environment === "sandbox" ? "test_" : "live_"));
  return config;
}

async function authenticate(ticket, config) {
  require(ticket.keyId === config.key_id && ticket.payload.environment === config.environment);
  const spki = base64(config.public_key_spki_base64, 44);
  // RFC 8410 Ed25519 SubjectPublicKeyInfo: absent algorithm parameters, 32-byte key.
  const prefix = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
  require(prefix.every((byte, index) => spki[index] === byte));
  const key = await crypto.subtle.importKey("spki", spki, { name: "Ed25519" }, true, ["verify"]);
  const exported = new Uint8Array(await crypto.subtle.exportKey("spki", key));
  require(exported.length === spki.length && exported.every((byte, index) => byte === spki[index]));
  require(await crypto.subtle.verify("Ed25519", key, ticket.signature,
    new TextEncoder().encode(canonical(ticket.payload))));
  current(ticket.payload);
}

function fail(message) {
  pending = null;
  clearTimeout(expiryTimer);
  button.disabled = true;
  byId("payment-review").hidden = true;
  status.textContent = message;
}

async function loadPaddle() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let complete = false;
    const finish = (ok) => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (ok) resolve();
      else { script.remove(); reject(new Error("checkout unavailable")); }
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
    current(chosen.ticket.payload);
    require(location.origin === PAYMENT_ORIGIN && location.hash === "" && location.search === "");
    status.textContent = "Opening Paddle. Review the final total before paying.";
    await loadPaddle();
    require(active && pending === chosen);
    current(chosen.ticket.payload);
    require(location.origin === PAYMENT_ORIGIN && location.hash === "" && location.search === "" &&
      typeof window.Paddle?.Initialize === "function" && typeof window.Paddle?.Checkout?.open === "function");
    if (chosen.config.environment === "sandbox") window.Paddle.Environment.set("sandbox");
    window.Paddle.Initialize({ token: chosen.config.paddle_client_token });
    current(chosen.ticket.payload);
    // No customer data, callback, items or fulfillment decision crosses this boundary.
    window.Paddle.Checkout.open({
      transactionId: chosen.ticket.payload.transaction_id,
      settings: { displayMode: "overlay", theme: "light", showAddDiscounts: false,
        successUrl: LICENSE_ORIGIN + "/gate/license/" },
    });
    clearTimeout(expiryTimer);
    pending = null;
    button.textContent = "Checkout opened";
    status.textContent = "Paddle checkout opened. Return to licensing after payment to check the confirmed result.";
  } catch {
    fail("Checkout could not be opened safely. Return to licensing and prepare a new request.");
  }
});

document.querySelector(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  byId("main").focus();
  byId("main").scrollIntoView();
});

addEventListener("pagehide", () => {
  active = false;
  fail("Return to licensing to prepare a new checkout request.");
});

async function start() {
  try {
    require(cleaned && !hadQuery && location.origin === PAYMENT_ORIGIN && window.top === window.self && crypto.subtle);
    const ticket = parseTicket(fragment);
    fragment = "";
    const config = await configuration();
    await authenticate(ticket, config);
    require(active);
    pending = { ticket, config };
    byId("payment-plan").textContent = plans[ticket.payload.plan].name;
    byId("payment-price").textContent = plans[ticket.payload.plan].label;
    byId("payment-environment").textContent = config.environment === "sandbox"
      ? "Sandbox test. No real payment is collected."
      : "Live purchase. This is a recurring subscription.";
    byId("payment-review").hidden = false;
    button.disabled = false;
    status.textContent = "Checkout request verified. Review the order before continuing.";
    expiryTimer = setTimeout(() => fail("This checkout request has expired. Return to licensing to prepare another."),
      Math.max(0, ticket.payload.expires_at * 1000 - Date.now()));
  } catch {
    fragment = "";
    fail("A current, verified checkout request is required. Return to licensing to prepare your purchase.");
  }
}

void start();
