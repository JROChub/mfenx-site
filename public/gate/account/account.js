/* Account state is deliberately ephemeral. The server alone grants access. */
const $ = (id) => document.getElementById(id);
let epoch = 0;
let session = null;
let organization = null;
let organizations = [];
let nextBefore = null;
let expiryTimer;
let billingConfigured = false;
const pending = new Set();
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const initialQuery = new URLSearchParams(location.search);
const requestedOrganization = initialQuery.get("org");

function text(id, value) {
  $(id).textContent = value;
}
function notice(message, error = false) {
  text("operation-status", message);
  $("operation-status").dataset.error = String(error);
}
function clearSecret() {
  $("token-value").value = "";
  $("issued-token").hidden = true;
}
function invalidate() {
  epoch += 1;
  for (const controller of pending) controller.abort();
  pending.clear();
  clearSecret();
  return epoch;
}
class APIError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
async function request(path, options = {}) {
  if (!path.startsWith("/v1/") && path !== "/auth/logout")
    throw new Error("Invalid service path");
  const controller = new AbortController();
  const generation = epoch;
  pending.add(controller);
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const method = options.method || "GET";
    const headers = { Accept: "application/json" };
    if (method !== "GET") {
      if (!session?.csrf_token)
        throw new Error("Sign in again before making changes.");
      headers["X-CSRF-Token"] = session.csrf_token;
      if (options.body !== undefined)
        headers["Content-Type"] = "application/json";
      if (options.idempotency) headers["Idempotency-Key"] = options.idempotency;
    }
    const response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new APIError(
        "The account service is not available at this address.",
        response.status,
      );
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1048576) {
        await reader.cancel();
        throw new Error("The service response exceeded its size limit.");
      }
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    const data = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(buffer),
    );
    if (generation !== epoch)
      throw new DOMException("Stale request", "AbortError");
    if (!response.ok)
      throw new APIError(
        typeof data.detail === "string"
          ? data.detail.slice(0, 300)
          : "The request was not accepted.",
        response.status,
      );
    return data;
  } catch (error) {
    if (controller.signal.aborted && generation === epoch) {
      throw new APIError(
        "The service did not respond in time. Refresh the status before retrying a change.",
        503,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    pending.delete(controller);
  }
}
function orgPath(suffix) {
  if (!organization) throw new Error("Select an organization first.");
  return `/v1/orgs/${encodeURIComponent(organization.id)}${suffix}`;
}
function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = String(value);
  if (className) node.className = className;
  return node;
}
function date(value) {
  if (!Number.isSafeInteger(value)) return "Not recorded";
  return new Date(value * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC");
}
function isAdmin() {
  return organization && ["admin", "owner"].includes(organization.role);
}
function resetWorkspace() {
  nextBefore = null;
  billingConfigured = false;
  for (const id of ["token-list", "key-list", "receipt-list"])
    $(id).replaceChildren();
  for (const id of [
    "usage-plan",
    "usage-month",
    "usage-count",
    "billing-state",
  ])
    text(id, "—");
  $("policy-form").reset();
  $("key-form").reset();
  $("token-form").reset();
  text("policy-version", "No policy loaded.");
  text("policy-record", "No policy loaded.");
  $("more-receipts").hidden = true;
  $("billing-fields").disabled = true;
  $("billing-portal").disabled = true;
  $("offline-license").disabled = true;
  $("resume-checkout").hidden = true;
  $("refresh-workspace").disabled = false;
  $("token-form").querySelector('button[type="submit"]').disabled = false;
  for (const field of document.querySelectorAll(".admin-fields"))
    field.disabled = true;
}
function lockAccount(message) {
  invalidate();
  clearTimeout(expiryTimer);
  session = null;
  organization = null;
  organizations = [];
  resetWorkspace();
  $("organization").replaceChildren();
  $("organization-name").value = "";
  $("account").hidden = true;
  $("sign-out").hidden = true;
  $("sign-in").hidden = false;
  text("session-status", message);
}
async function perform(button, action) {
  const generation = epoch;
  button.disabled = true;
  notice("");
  try {
    await action();
  } catch (error) {
    if (generation !== epoch || error.name === "AbortError") return;
    if (error.status === 401)
      lockAccount("Your session ended. Sign in again to continue.");
    else notice(error.message || "The request could not be completed.", true);
  } finally {
    if (generation === epoch || button.closest("#organization-form"))
      button.disabled = false;
  }
}
function records(id, items, render, empty) {
  const target = $(id);
  target.replaceChildren();
  if (!items.length) target.append(element("p", empty, "note"));
  for (const item of items) target.append(render(item));
}
function revokeButton(label, path, refresh, confirmation) {
  const button = element("button", label);
  button.type = "button";
  button.addEventListener("click", () => {
    if (confirmation && !window.confirm(confirmation)) return;
    perform(button, async () => {
      await request(path, { method: "DELETE" });
      await refresh();
      notice("Revoked.");
    });
  });
  return button;
}
async function loadTokens() {
  const data = await request(orgPath("/tokens"));
  records(
    "token-list",
    data.tokens,
    (token) => {
      const article = element("article");
      article.append(
        element("h3", token.id),
        element("p", token.scopes.join(" · ")),
        element(
          "p",
          `${token.revoked ? "Revoked" : "Expires"} · ${date(token.expires)}`,
        ),
      );
      if (!token.revoked)
        article.append(
          revokeButton(
            "Revoke token",
            orgPath(`/tokens/${encodeURIComponent(token.id)}`),
            loadTokens,
          ),
        );
      return article;
    },
    "No CLI tokens recorded.",
  );
}
async function loadKeys() {
  const data = await request(orgPath("/issuer-keys"));
  records(
    "key-list",
    data.keys,
    (key) => {
      const article = element("article");
      article.append(
        element("h3", key.key_id),
        element(
          "p",
          `${key.revoked ? "Revoked" : "Active"} · ${date(key.created)}`,
        ),
      );
      if (!key.revoked && isAdmin())
        article.append(
          revokeButton(
            "Revoke public key",
            orgPath(`/issuer-keys/${encodeURIComponent(key.key_id)}`),
            loadKeys,
            "Revoke this trust key? Future registrations signed by it will be rejected. It cannot be restored.",
          ),
        );
      return article;
    },
    "No issuer public keys registered.",
  );
}
function populatePolicy(data) {
  const policy = data.policy;
  text("policy-version", `Version ${data.version} · ${data.sha256}`);
  text("policy-record", JSON.stringify(data, null, 2));
  $("contract-digest").value = policy.evaluation_contract_sha256;
  $("policy-keys").value = policy.allowed_issuer_key_ids.join("\n");
  $("parent-digests").value = policy.allowed_parent_sha256.join("\n");
  $("accuracy-limit").value = policy.max_accuracy_loss_ppm;
  $("decisions-limit").value = policy.max_decision_changes_ppm;
  $("require-artifact").checked = policy.require_artifact_binding;
  $("require-replay").checked = policy.require_behavioral_replay;
  for (const input of document.querySelectorAll('[name="format"]'))
    input.checked = policy.allowed_formats.includes(input.value);
}
async function loadPolicy() {
  try {
    populatePolicy(await request(orgPath("/policies/current")));
  } catch (error) {
    if (error.status !== 404) throw error;
    text("policy-version", "No release policy published.");
    text(
      "policy-record",
      "Register an issuer public key, then publish an approved evaluation policy.",
    );
  }
}
async function loadUsage() {
  const usage = await request(orgPath("/usage"));
  text("usage-plan", usage.plan);
  text("usage-month", usage.month_utc);
  text(
    "usage-count",
    `${usage.managed_registrations.toLocaleString()} / ${usage.allowance.toLocaleString()}`,
  );
  text(
    "billing-state",
    usage.billing_state ||
      (usage.plan === "developer"
        ? "No paid subscription"
        : "Service confirmed"),
  );
  const owner = organization.role === "owner";
  const configured = usage.billing_configured === true;
  billingConfigured = configured;
  $("resume-checkout").hidden = !owner || !configured;
  $("resume-checkout").href =
    `/gate/checkout/?org=${encodeURIComponent(organization.id)}`;
  $("billing-fields").disabled = !owner || !configured;
  $("billing-portal").disabled = !owner || !configured;
  $("offline-license").disabled = !owner || usage.plan !== "private";
  text(
    "billing-availability",
    !owner
      ? "Only the organization owner can manage its subscription."
      : configured
        ? "Payments are handled by Paddle. Review the complete order before paying."
        : "Purchases are not available from this service yet. Your local tools remain available.",
  );
}
function appendReceipts(data, reset) {
  const list = $("receipt-list");
  if (reset) list.replaceChildren();
  if (!data.receipts.length && reset)
    list.append(element("p", "No retained receipt records.", "note"));
  for (const receipt of data.receipts) {
    const article = element("article");
    article.append(
      element("h3", receipt.receipt_sha256),
      element(
        "p",
        `${date(receipt.created)} · Policy ${receipt.policy_version}`,
      ),
      element(
        "p",
        `Attestation: ${receipt.attestation_status}. Artifact: ${receipt.artifact_status}. Replay: ${receipt.replay_status}.`,
      ),
    );
    if (receipt.model_sha256)
      article.append(element("p", `Model commitment: ${receipt.model_sha256}`));
    list.append(article);
  }
  nextBefore = data.next_before;
  $("more-receipts").hidden = nextBefore === null;
}
async function loadReceipts(reset = true) {
  const cursor = reset ? "" : `&before=${encodeURIComponent(nextBefore)}`;
  appendReceipts(await request(orgPath(`/receipts?limit=20${cursor}`)), reset);
}
async function loadWorkspace() {
  const generation = epoch;
  const results = await Promise.allSettled([
    loadUsage(),
    loadTokens(),
    loadKeys(),
    loadPolicy(),
    loadReceipts(),
  ]);
  if (generation !== epoch) return;
  const failure = results.find(
    (result) =>
      result.status === "rejected" && result.reason.name !== "AbortError",
  );
  if (failure) {
    if (failure.reason.status === 401)
      lockAccount("Your session ended. Sign in again to continue.");
    else
      notice(
        `Some records could not be loaded: ${failure.reason.message}`,
        true,
      );
  }
}

async function refreshWorkspace() {
  const generation = epoch;
  if (organization?.role === "owner" && billingConfigured) {
    // A previously displayed paid state is not a fresh authorization. Keep
    // purchase/license controls closed until reconciliation and usage both pass.
    text("usage-plan", "Unconfirmed");
    text("billing-state", "Checking with Paddle…");
    $("billing-fields").disabled = true;
    $("billing-portal").disabled = true;
    $("offline-license").disabled = true;
    $("resume-checkout").hidden = true;
    try {
      await request(orgPath("/billing/refresh"), { method: "POST" });
    } catch (error) {
      if (generation !== epoch) throw error;
      text("billing-state", "Not confirmed");
      text(
        "billing-availability",
        "The current subscription could not be confirmed. Refresh again before starting checkout or requesting an offline license.",
      );
      if (error.status === 403) {
        await boot();
        notice(
          "Organization access changed. The workspace has been refreshed.",
          true,
        );
      }
      throw error;
    }
  }
  if (generation === epoch) await loadWorkspace();
}
async function selectOrganization() {
  invalidate();
  notice("");
  resetWorkspace();
  organization =
    organizations.find((item) => item.id === $("organization").value) || null;
  $("workspace").hidden = !organization;
  if (!organization) return;
  text("organization-role", `${organization.role} · ${organization.id}`);
  for (const field of document.querySelectorAll(".admin-fields"))
    field.disabled = !isAdmin();
  await loadWorkspace();
}
async function renderAccount(account, selected) {
  organizations = account.organizations;
  const select = $("organization");
  select.replaceChildren();
  for (const item of organizations) {
    const option = element("option", item.name);
    option.value = item.id;
    select.append(option);
  }
  select.disabled = !organizations.length;
  if (selected && organizations.some((item) => item.id === selected))
    select.value = selected;
  $("account").hidden = false;
  await selectOrganization();
}
async function boot() {
  invalidate();
  clearTimeout(expiryTimer);
  session = null;
  organization = null;
  organizations = [];
  resetWorkspace();
  $("account").hidden = true;
  $("sign-out").hidden = true;
  const generation = epoch;
  $("retry-session").hidden = true;
  $("sign-in").hidden = true;
  text("session-status", "Checking the account service…");
  try {
    const data = await request("/v1/session");
    if (data.authenticated !== true) {
      if (data.login_configured === true && data.login_url === "/auth/login") {
        lockAccount("Sign in to manage your organization’s releases.");
        $("sign-in").href = "/auth/login";
      } else {
        lockAccount(
          "Account sign-in is not available from this service yet. Local verification remains available.",
        );
        $("sign-in").hidden = true;
        $("retry-session").hidden = false;
      }
      return;
    }
    if (
      typeof data.csrf_token !== "string" ||
      !data.csrf_token ||
      !Array.isArray(data.account?.organizations)
    )
      throw new Error("The service returned an incomplete session.");
    session = data;
    if (
      !Number.isSafeInteger(data.expires_at) ||
      data.expires_at * 1000 <= Date.now()
    ) {
      lockAccount("Your session ended. Sign in again to continue.");
      return;
    }
    expiryTimer = setTimeout(
      () => lockAccount("Your session ended. Sign in again to continue."),
      Math.min(2147483647, data.expires_at * 1000 - Date.now()),
    );
    text(
      "session-status",
      data.email ? `Signed in as ${data.email}` : "Signed in.",
    );
    $("sign-out").hidden = false;
    $("sign-out").disabled = false;
    await renderAccount(data.account, requestedOrganization);
  } catch (error) {
    if (generation !== epoch || error.name === "AbortError") return;
    lockAccount(
      "The account service is not available at this address. Local evaluation and receipt verification remain available.",
    );
    $("sign-in").hidden = true;
    $("retry-session").hidden = false;
  }
}
function submit(id, action) {
  $(id).addEventListener("submit", (event) => {
    event.preventDefault();
    perform(event.submitter, action);
  });
}
function digests(id, required = false) {
  const values = $(id)
    .value.split(/\s+/)
    .filter(Boolean)
    .map((value) => (value.startsWith("sha256:") ? value : `sha256:${value}`));
  if (
    (required && !values.length) ||
    values.some((value) => !digestPattern.test(value)) ||
    new Set(values).size !== values.length
  )
    throw new Error("Use distinct SHA-256 values, one per line.");
  return values;
}
submit("organization-form", async () => {
  const body = { organization_name: $("organization-name").value.trim() };
  if (!body.organization_name) throw new Error("Enter an organization name.");
  const data = await request(
    organizations.length ? "/v1/orgs" : "/v1/account",
    { method: "POST", body },
  );
  const account = await request("/v1/account");
  $("organization-name").value = "";
  await renderAccount(account, data.id || data.organization_id);
  notice("Organization created. No paid subscription was started.");
});
submit("token-form", async () => {
  clearSecret();
  const scopes = [...document.querySelectorAll('[name="scope"]:checked')].map(
    (input) => input.value,
  );
  if (!scopes.length) throw new Error("Select at least one token permission.");
  const token = await request(orgPath("/tokens"), {
    method: "POST",
    body: { scopes, expires_in_days: Number($("token-days").value) },
  });
  $("token-value").value = token.token;
  $("issued-token").hidden = false;
  $("token-value").focus();
  await loadTokens();
});
submit("key-form", async () => {
  const generation = epoch;
  const publicKey = $("public-key").value.trim();
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey) ||
    publicKey.includes("PRIVATE")
  )
    throw new Error("Supply only a base64-encoded DER public key.");
  try {
    const bytes = Uint8Array.from(atob(publicKey), (value) =>
      value.charCodeAt(0),
    );
    await crypto.subtle.importKey(
      "spki",
      bytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    if (generation !== epoch)
      throw new DOMException("Stale public key", "AbortError");
    $("public-key").value = "";
    throw new Error(
      "This is not a P-256 SPKI public key. No key bytes were sent.",
    );
  }
  if (generation !== epoch)
    throw new DOMException("Stale public key", "AbortError");
  await request(orgPath("/issuer-keys"), {
    method: "POST",
    body: { public_key_spki_base64: publicKey },
  });
  $("key-form").reset();
  await loadKeys();
  notice(
    "Public key registered. Add its identifier to an approved release policy.",
  );
});
submit("policy-form", async () => {
  const contract = digests("contract-digest", true);
  if (contract.length !== 1)
    throw new Error("Supply one approved evaluation contract digest.");
  const formats = [...document.querySelectorAll('[name="format"]:checked')].map(
    (input) => input.value,
  );
  if (!formats.length) throw new Error("Select at least one model format.");
  const policy = await request(orgPath("/policies"), {
    method: "POST",
    body: {
      evaluation_contract_sha256: contract[0],
      allowed_issuer_key_ids: digests("policy-keys", true),
      allowed_parent_sha256: digests("parent-digests"),
      allowed_formats: formats,
      max_accuracy_loss_ppm: Number($("accuracy-limit").value),
      max_decision_changes_ppm: Number($("decisions-limit").value),
      require_artifact_binding: $("require-artifact").checked,
      require_behavioral_replay: $("require-replay").checked,
    },
  });
  populatePolicy(policy);
  notice(`Policy version ${policy.version} published.`);
});
function paymentURL(value, portal = false) {
  const url = new URL(value, location.origin);
  const ownCheckout =
    url.origin === location.origin &&
    ["/gate/account/", "/gate/checkout/"].includes(url.pathname);
  const paddlePortal =
    portal &&
    url.protocol === "https:" &&
    [
      "customer-portal.paddle.com",
      "sandbox-customer-portal.paddle.com",
    ].includes(url.hostname) &&
    !url.port;
  if (url.username || url.password || (!ownCheckout && !paddlePortal))
    throw new Error("The service returned an unapproved payment destination.");
  return url.href;
}
submit("checkout-form", async () => {
  const checkout = await request(orgPath("/billing/checkout"), {
    method: "POST",
    body: { plan: $("plan").value },
    idempotency: crypto.randomUUID(),
  });
  if (checkout.entitlement_granted !== false)
    throw new Error(
      "Checkout must not grant access before payment confirmation.",
    );
  notice(
    "Opening checkout. Your plan changes only after the service confirms payment.",
  );
  location.assign(`/gate/checkout/?org=${encodeURIComponent(organization.id)}`);
});
$("billing-portal").addEventListener("click", (event) =>
  perform(event.currentTarget, async () => {
    const portal = await request(orgPath("/billing/portal"), {
      method: "POST",
    });
    location.assign(paymentURL(portal.url, true));
  }),
);
$("offline-license").addEventListener("click", (event) =>
  perform(event.currentTarget, async () => {
    const entitlement = await request(orgPath("/entitlements/offline"), {
      method: "POST",
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(entitlement, null, 2) + "\n"], {
        type: "application/json",
      }),
    );
    const link = element("a");
    link.href = url;
    link.download = "mfenx-gate-offline-license.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice(
      "Offline license downloaded. Verify its signature with the independently trusted entitlement key before use.",
    );
  }),
);
$("organization").addEventListener("change", selectOrganization);
$("refresh-workspace").addEventListener("click", (event) =>
  perform(event.currentTarget, refreshWorkspace),
);
$("more-receipts").addEventListener("click", (event) =>
  perform(event.currentTarget, () => loadReceipts(false)),
);
$("retry-session").addEventListener("click", boot);
$("dismiss-token").addEventListener("click", clearSecret);
$("copy-token").addEventListener("click", (event) =>
  perform(event.currentTarget, async () => {
    if (!$("token-value").value) throw new Error("There is no token to copy.");
    await navigator.clipboard.writeText($("token-value").value);
    notice(
      "Token copied. Store it in your secret manager and clear your clipboard when finished.",
    );
  }),
);
$("sign-out").addEventListener("click", (event) =>
  perform(event.currentTarget, async () => {
    await request("/auth/logout", { method: "POST" });
    lockAccount("Signed out.");
  }),
);
if (initialQuery.has("_ptxn") || initialQuery.has("checkout")) {
  $("billing-return").hidden = false;
  history.replaceState(null, "", location.pathname);
}
window.addEventListener("pagehide", () => {
  lockAccount("Sign in to manage your organization’s releases.");
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) boot();
});
boot();
