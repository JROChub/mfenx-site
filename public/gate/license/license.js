import {
  base64ToBytes,
  createIdentity,
  loadIdentity,
  restoreIdentity,
  sha256,
  signMessage,
  updateIdentity,
} from "./license-key.js";

const $ = (id) => document.getElementById(id);
const encode = new TextEncoder();
const plans = Object.freeze({
  team: "Team",
  business: "Business",
  private: "Private",
});
const licenseId = /^lic_[a-f0-9]{32}$/;
const transactionId = /^txn_[a-z0-9]{26}$/;
const keyId = /^[A-Za-z0-9_.:-]{1,128}$/;
let identity = null;
let config = null;
let issuerKey = null;
let current = null;
let busy = false;
let active = true;
let generation = 0;
let inventory = [];
let lifetime = new AbortController();

function canonical(value) {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (typeof value === "string")
    return JSON.stringify(value).replace(
      /[\u007f-\uffff]/g,
      (character) =>
        "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
    );
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => canonical(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  throw new Error("Unsupported license data.");
}

function downloadJSON(value, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function api(path, value) {
  const response = await fetch(path, {
    method: value === undefined ? "GET" : "POST",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(20000)]),
    headers: {
      Accept: "application/json",
      ...(value === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(value === undefined ? {} : { body: canonical(value) }),
  });
  if (
    !response.headers.get("content-type")?.startsWith("application/json") ||
    !response.body
  )
    throw new Error(
      "The licensing service is unavailable. No license status has been confirmed.",
    );
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    length += chunk.byteLength;
    if (length > 65536) {
      await reader.cancel();
      throw new Error("The licensing response exceeded the supported size.");
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let result;
  try {
    result = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new Error("The licensing service returned an unreadable response.");
  }
  if (!response.ok) {
    const messages = {
      401: "The license proof expired or was rejected. Try the operation again.",
      403: "A current paid license could not be confirmed. No new license was issued.",
      404: "This license was not found for the browser key.",
      409: "The purchase needs recovery. Refresh the license before preparing another checkout.",
      429: "Too many requests or unresolved purchases. Wait before trying again.",
    };
    const error = new Error(
      messages[response.status] ||
        "The licensing service could not complete the request. No new license was issued.",
    );
    error.status = response.status;
    if (licenseId.test(result?.detail?.license_id || ""))
      error.recovery_license_id = result.detail.license_id;
    throw error;
  }
  return result;
}

async function operation(action, request) {
  if (!config?.available || !identity)
    throw new Error(
      "A browser key and an available licensing service are required.",
    );
  const snapshot = identity;
  const token = generation;
  const challenge = await api("/v1/licenses/challenge", {
    public_key_spki_base64: snapshot.public_key_spki_base64,
    action,
    request,
  });
  if (
    !/^[a-f0-9]{64}$/.test(challenge.challenge_id || "") ||
    !Number.isSafeInteger(challenge.expires_at) ||
    challenge.expires_at * 1000 <= Date.now() ||
    challenge.expires_at * 1000 > Date.now() + 120000
  )
    throw new Error("The licensing challenge is invalid or expired.");
  const expected = canonical({
    domain: "mfenx.license.proof.v1",
    origin: location.origin,
    action,
    key_sha256: snapshot.key_id,
    request_sha256:
      "sha256:" + (await sha256(encode.encode(canonical(request)))),
    nonce: challenge.challenge_id,
    expires_at: challenge.expires_at,
  });
  if (challenge.message !== expected)
    throw new Error(
      "The licensing challenge does not match this key, website and requested operation.",
    );
  if (!active || token !== generation)
    throw new Error("The license workspace changed. Retry the operation.");
  const signature = await signMessage(snapshot, expected);
  if (
    !active ||
    token !== generation ||
    challenge.expires_at * 1000 <= Date.now()
  )
    throw new Error(
      "The license workspace or challenge expired. Retry the operation.",
    );
  return api("/v1/licenses/" + action, {
    public_key_spki_base64: snapshot.public_key_spki_base64,
    request,
    challenge_id: challenge.challenge_id,
    signature_base64: signature,
  });
}

function clearAuthorization(message) {
  current = null;
  $("license-details").hidden = true;
  $("license-details").replaceChildren();
  $("license-download").disabled = true;
  $("license-portal").hidden = true;
  $("portal-link").hidden = true;
  $("portal-link").href = "/gate/license/";
  $("checkout-link").hidden = true;
  $("checkout-link").href = "/gate/license/";
  if (message) $("document-status").textContent = message;
}

function controls() {
  const ready = Boolean(active && !busy && config?.available && identity);
  $("key-create").disabled =
    busy || !$("key-understood").checked || Boolean(identity);
  $("key-restore").disabled = busy || Boolean(identity);
  $("backup-download").disabled = busy || !identity?.backup;
  $("backup-saved").disabled = busy || !identity;
  $("license-plans").disabled =
    !ready || Boolean(identity?.license_id) || Boolean(identity?.request_id);
  $("license-buy").disabled =
    !ready ||
    !identity.backup_saved ||
    (Boolean(identity.license_id) && !identity.request_id) ||
    current?.state === "active" ||
    !Object.keys(config.plans).length;
  $("license-buy").textContent = identity?.request_id
    ? "Resume checkout"
    : "Prepare checkout";
  $("license-refresh").disabled = !ready;
  $("license-select").disabled = !ready;
  $("license-download").disabled =
    !ready ||
    current?.state !== "active" ||
    current.paid_until * 1000 <= Date.now();
  $("license-portal").disabled = $("license-download").disabled;
}

async function perform(work) {
  if (busy || !active) return;
  busy = true;
  controls();
  try {
    await work();
  } catch (error) {
    if (active) {
      clearAuthorization("Current license status is unconfirmed.");
      $("license-status").textContent =
        error instanceof Error
          ? error.message
          : "The operation could not be completed.";
    }
  } finally {
    busy = false;
    if (active) controls();
  }
}

function renderIdentity() {
  $("key-new").hidden = Boolean(identity);
  $("key-present").hidden = !identity;
  if (!identity) return;
  $("key-fingerprint").textContent = identity.key_id;
  $("backup-saved").checked = identity.backup_saved === true;
  $("key-storage").textContent =
    "Stored locally in this browser’s IndexedDB. The stored private key cannot be exported through WebCrypto.";
}

function hostedCheckout(value, transaction, environment) {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("Unsupported payment link.");
  const url = new URL(value);
  const hosts =
    environment === "sandbox"
      ? ["sandbox.pay.paddle.io", "sandbox-pay.paddle.io"]
      : ["pay.paddle.io"];
  if (
    url.protocol !== "https:" ||
    !hosts.includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/(?:checkout\/)?hsc_[a-z0-9]{26}_[a-zA-Z0-9_-]{16,256}$/.test(
      url.pathname,
    ) ||
    [...url.searchParams.keys()].length !== 1 ||
    url.searchParams.get("transaction_id") !== transaction
  )
    throw new Error(
      "The payment link is not the expected Paddle-hosted transaction.",
    );
  return url.href;
}

function portalURL(value, environment) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 1024)
    throw new Error("Unsupported subscription-management configuration.");
  const url = new URL(value);
  const host =
    environment === "sandbox"
      ? "sandbox-customer-portal.paddle.com"
      : "customer-portal.paddle.com";
  if (
    url.protocol !== "https:" ||
    url.host !== host ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/(?:cpl_[a-z0-9]+|[0-9]+)(?:\/login)?\/?$/.test(url.pathname)
  )
    throw new Error(
      "Subscription management must use Paddle’s public sign-in page.",
    );
  return url.href;
}

async function configure() {
  const result = await api("/v1/licenses/config");
  if (
    typeof result.available !== "boolean" ||
    !["sandbox", "live"].includes(result.environment) ||
    !result.plans ||
    typeof result.plans !== "object" ||
    Array.isArray(result.plans) ||
    Object.keys(result.plans).some((plan) => !Object.hasOwn(plans, plan))
  )
    throw new Error(
      "The licensing service returned unsupported configuration.",
    );
  for (const plan of Object.keys(result.plans)) {
    const entry = result.plans[plan];
    if (
      !entry ||
      !Number.isSafeInteger(entry.usd_minor) ||
      entry.usd_minor <= 0 ||
      entry.usd_minor > 100000000 ||
      !["month", "year"].includes(entry.interval)
    )
      throw new Error("The licensing service returned unsupported pricing.");
  }
  result.portal_url = portalURL(result.portal_url, result.environment);
  if (result.available) {
    if (
      result.issuer?.algorithm !== "Ed25519" ||
      !keyId.test(result.issuer?.key_id || "")
    )
      throw new Error("The licensing issuer is not configured.");
    issuerKey = await crypto.subtle.importKey(
      "spki",
      base64ToBytes(result.issuer.public_key_spki_base64, 128),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  }
  config = Object.freeze(result);
  $("plan-options").replaceChildren();
  for (const [plan, entry] of Object.entries(config.plans)) {
    const label = document.createElement("label");
    label.className = "license-plan";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "license-plan";
    input.value = plan;
    input.checked = identity?.plan
      ? identity.plan === plan
      : !$("plan-options").children.length;
    const name = document.createElement("span");
    name.textContent = plans[plan];
    const price = document.createElement("span");
    price.className = "license-plan-price";
    price.textContent =
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(entry.usd_minor / 100) +
      " USD / " +
      entry.interval +
      ", plus tax";
    label.append(input, name, price);
    $("plan-options").append(label);
  }
  $("license-plans").hidden = !config.available;
  $("purchase-status").textContent = !config.available
    ? "Checkout is not configured on this website. No purchase can be started here."
    : config.environment === "sandbox"
      ? "Sandbox — test payments only. No live subscription can be purchased here."
      : "Live subscription. Review the recurring terms and total on Paddle before paying.";
}

function validateState(result, expectedId) {
  if (
    !result ||
    result.license_id !== expectedId ||
    !Object.hasOwn(plans, result.plan) ||
    !["pending", "active", "inactive", "revoked"].includes(result.state) ||
    !Number.isSafeInteger(result.paid_until) ||
    result.paid_until < 0 ||
    result.paid_until > 8640000000000 ||
    (result.state === "active" && result.paid_until * 1000 <= Date.now())
  )
    throw new Error("The service returned an inconsistent license status.");
  return result;
}

function renderState(result) {
  current = result;
  const rows = [
    ["License", result.license_id],
    ["Plan", plans[result.plan]],
    ["State", result.state],
    [
      "Paid until",
      result.paid_until
        ? new Date(result.paid_until * 1000).toISOString()
        : "Not confirmed",
    ],
    ["Environment", config.environment],
  ];
  $("license-details").replaceChildren();
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    row.append(dt, dd);
    $("license-details").append(row);
  }
  $("license-details").hidden = false;
  $("document-status").textContent =
    result.state === "active"
      ? "Payment state confirmed. Download a newly signed license document."
      : "No active entitlement was confirmed. A checkout return is not evidence of payment.";
  $("license-portal").hidden = result.state !== "active" || !config.portal_url;
}

async function discover() {
  const result = await operation("inventory", {});
  if (!Array.isArray(result.licenses) || result.licenses.length > 100)
    throw new Error("Unsupported license inventory.");
  const seen = new Set();
  for (const row of result.licenses) {
    if (
      !licenseId.test(row?.license_id || "") ||
      seen.has(row.license_id) ||
      !Object.hasOwn(plans, row.plan) ||
      typeof row.request_id !== "string" ||
      !/^[a-f0-9]{32}$/.test(row.request_id) ||
      (row.transaction_id !== null &&
        !transactionId.test(row.transaction_id || ""))
    )
      throw new Error("Invalid license inventory record.");
    seen.add(row.license_id);
  }
  inventory = result.licenses;
  $("license-select").replaceChildren();
  for (const row of inventory) {
    const option = document.createElement("option");
    option.value = row.license_id;
    option.textContent = plans[row.plan] + " · " + row.license_id;
    $("license-select").append(option);
  }
  $("license-picker").hidden = inventory.length < 2;
  if (!inventory.length) {
    clearAuthorization("No purchase was found for this browser key.");
    return false;
  }
  const selected =
    inventory.find((row) => row.license_id === identity.license_id) ||
    inventory[inventory.length - 1];
  $("license-select").value = selected.license_id;
  identity = await updateIdentity(identity.key_id, {
    license_id: selected.license_id,
    transaction_id: selected.transaction_id,
    request_id: selected.request_id,
    plan: selected.plan,
  });
  return true;
}

async function refresh() {
  clearAuthorization("Checking the current license with the payment provider…");
  if (!(await discover())) return;
  const request = { license_id: identity.license_id };
  const result = validateState(
    await operation("refresh", request),
    identity.license_id,
  );
  if (!active) return;
  renderState(result);
  $("license-status").textContent =
    "License check complete. No purchaser details were requested by this page.";
}

async function verifyDocument(document) {
  const payload = document?.payload;
  if (
    !payload ||
    document.algorithm !== "Ed25519" ||
    document.key_id !== config.issuer.key_id ||
    payload.key_id !== config.issuer.key_id ||
    payload.schema !== "mfenx.gate.key-entitlement.v1" ||
    payload.license_id !== identity.license_id ||
    payload.holder_key_sha256 !== identity.key_id ||
    payload.issuer !== location.origin ||
    payload.environment !== config.environment ||
    payload.plan !== current?.plan ||
    payload.verification_metered !== false ||
    payload.usage_telemetry !== false ||
    !Number.isSafeInteger(payload.issued_at) ||
    payload.issued_at < 0 ||
    payload.issued_at * 1000 > Date.now() + 60000 ||
    !Number.isSafeInteger(payload.expires_at) ||
    payload.expires_at <= payload.issued_at ||
    payload.expires_at * 1000 <= Date.now() ||
    payload.expires_at > current.paid_until ||
    payload.expires_at - payload.issued_at > 366 * 86400 + 3600 ||
    (payload.plan !== "private" &&
      payload.expires_at - payload.issued_at > 86400)
  )
    throw new Error(
      "The signed license does not match this key, payment term and website.",
    );
  const signature = base64ToBytes(document.signature, 128);
  if (
    signature.length !== 64 ||
    !(await crypto.subtle.verify(
      { name: "Ed25519" },
      issuerKey,
      signature,
      encode.encode(canonical(payload)),
    ))
  )
    throw new Error(
      "The license signature could not be verified. No file was downloaded.",
    );
  return document;
}

$("key-understood").addEventListener("change", controls);
$("key-create").addEventListener("click", () =>
  perform(async () => {
    const password = $("backup-password").value;
    if (password !== $("backup-confirm").value)
      throw new Error("The recovery passphrases do not match.");
    $("backup-password").value = "";
    $("backup-confirm").value = "";
    $("license-status").textContent =
      "Creating and encrypting the recovery file locally…";
    identity = await createIdentity(password);
    renderIdentity();
    downloadJSON(identity.backup, "mfenx-license-key-recovery.json");
    $("license-status").textContent =
      "Browser key created. Save the encrypted recovery file and its passphrase, then confirm below.";
    if (navigator.storage?.persist) {
      const persisted = await navigator.storage.persist().catch(() => false);
      $("key-storage").textContent += persisted
        ? " Persistent storage was granted; manual clearing can still remove the key."
        : " Persistent storage was not granted; keep the recovery file.";
    }
  }),
);

$("key-restore").addEventListener("click", () =>
  perform(async () => {
    const file = $("restore-file").files[0];
    const password = $("restore-password").value;
    $("restore-password").value = "";
    if (!file || file.size > 16384)
      throw new Error("Choose an encrypted recovery file smaller than 16 KiB.");
    identity = await restoreIdentity(await file.text(), password);
    $("restore-file").value = "";
    renderIdentity();
    $("license-status").textContent =
      "Browser key restored locally. Refresh to find its licenses; the recovery file was not uploaded.";
  }),
);

$("backup-download").addEventListener("click", () => {
  if (identity?.backup)
    downloadJSON(identity.backup, "mfenx-license-key-recovery.json");
});
$("backup-saved").addEventListener("change", () =>
  perform(async () => {
    identity = await updateIdentity(identity.key_id, {
      backup_saved: $("backup-saved").checked,
    });
  }),
);

$("license-buy").addEventListener("click", () =>
  perform(async () => {
    if (
      !identity?.backup_saved ||
      (identity.license_id && !identity.request_id) ||
      current?.state === "active"
    )
      throw new Error(
        "Save the key recovery file and use the original purchase reference before continuing.",
      );
    const plan = identity.request_id
      ? identity.plan
      : document.querySelector('input[name="license-plan"]:checked')?.value;
    if (!Object.hasOwn(config.plans, plan))
      throw new Error("Choose an available license plan.");
    if (!identity.request_id) {
      const requestId = [...crypto.getRandomValues(new Uint8Array(16))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      identity = await updateIdentity(identity.key_id, {
        request_id: requestId,
        plan,
      });
    }
    $("checkout-link").hidden = true;
    $("license-status").textContent =
      "Preparing the requested purchase. Do not start a second checkout while this is pending.";
    let result;
    try {
      result = await operation("checkout", {
        plan,
        request_id: identity.request_id,
      });
    } catch (error) {
      if (error.recovery_license_id)
        identity = await updateIdentity(identity.key_id, {
          license_id: error.recovery_license_id,
        });
      throw error;
    }
    if (
      !licenseId.test(result.license_id || "") ||
      (identity.license_id && result.license_id !== identity.license_id) ||
      !transactionId.test(result.transaction_id || "") ||
      result.environment !== config.environment ||
      result.entitlement_granted !== false
    )
      throw new Error("The service returned an invalid purchase binding.");
    const url =
      result.url === null
        ? null
        : hostedCheckout(result.url, result.transaction_id, result.environment);
    identity = await updateIdentity(identity.key_id, {
      license_id: result.license_id,
      transaction_id: result.transaction_id,
      plan,
    });
    if (url) {
      $("checkout-link").href = url;
      $("checkout-link").hidden = false;
    }
    $("license-status").textContent = url
      ? "Purchase prepared. Open Paddle to review and pay. Return here and refresh the license afterward."
      : "This transaction is no longer awaiting checkout. Refresh to check its current payment state.";
  }),
);

$("license-refresh").addEventListener("click", () => perform(refresh));
$("license-select").addEventListener("change", () =>
  perform(async () => {
    generation += 1;
    clearAuthorization("Checking the selected license…");
    const selected = inventory.find(
      (row) => row.license_id === $("license-select").value,
    );
    if (!selected) throw new Error("Choose a known license.");
    identity = await updateIdentity(identity.key_id, {
      license_id: selected.license_id,
      transaction_id: selected.transaction_id,
      request_id: selected.request_id,
      plan: selected.plan,
    });
    renderState(
      validateState(
        await operation("refresh", { license_id: selected.license_id }),
        selected.license_id,
      ),
    );
  }),
);

$("license-download").addEventListener("click", () =>
  perform(async () => {
    if (current?.state !== "active")
      throw new Error("Refresh and confirm the license before downloading.");
    const document = await verifyDocument(
      await operation("download", { license_id: identity.license_id }),
    );
    if (!active) return;
    identity = await updateIdentity(identity.key_id, { license: document });
    downloadJSON(document, "mfenx-license-" + identity.license_id + ".json");
    $("license-status").textContent =
      "Signed license verified and downloaded. Keep the recovery file separately; this license is not a private-key backup.";
  }),
);

$("license-portal").addEventListener("click", () => {
  if (
    current?.state !== "active" ||
    current.paid_until * 1000 <= Date.now() ||
    !config?.portal_url
  )
    return;
  $("portal-link").href = config.portal_url;
  $("portal-link").hidden = false;
  $("portal-link").focus();
});

window.addEventListener("pagehide", () => {
  active = false;
  generation += 1;
  lifetime.abort();
  identity = null;
  current = null;
  $("backup-password").value = "";
  $("backup-confirm").value = "";
  $("restore-password").value = "";
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});

async function start() {
  try {
    if (!isSecureContext || !crypto?.subtle || !window.indexedDB)
      throw new Error(
        "Use an HTTPS browser with WebCrypto and IndexedDB to manage a local license.",
      );
    // Return parameters never select a key, transaction or entitlement.
    if (location.search || location.hash)
      history.replaceState(null, "", location.pathname);
    identity = await loadIdentity();
    renderIdentity();
    await configure();
    $("license-status").textContent = config.available
      ? "Local license workspace ready. No MFENX sign-in is required."
      : "The licensing service is not configured for purchases on this website.";
    if (identity?.license_id)
      $("document-status").textContent =
        "A local purchase reference is saved. Refresh to confirm its current state.";
  } catch (error) {
    config = null;
    $("license-status").textContent =
      error instanceof Error
        ? error.message
        : "The local license workspace is unavailable.";
  }
  controls();
}
start();
