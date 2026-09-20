// Checkout identity comes from the authenticated service, never the return URL.
const byId = (id) => document.getElementById(id);
const plans = Object.freeze({
  team: { name: "Team", price: "$399 USD / month" },
  business: { name: "Business", price: "$1,499 USD / month" },
  private: { name: "Private", price: "$24,000 USD / year" },
});
const status = byId("checkout-status");
const openButton = byId("checkout-open");
let pending = null;
let organization = null;
let active = true;
let initialized = false;
let loading = false;

async function getJSON(path) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: { Accept: "application/json" },
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("application/json")
  )
    throw new Error(
      "The account service could not confirm this checkout. Return to your account and try again.",
    );
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 65536) {
      await reader.cancel();
      throw new Error("The account response exceeded the supported size.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function clear(message) {
  pending = null;
  openButton.disabled = true;
  byId("checkout-review").hidden = true;
  status.textContent = message;
}

async function ownedCheckout(org) {
  const session = await getJSON("/auth/session");
  if (session.authenticated !== true)
    throw new Error("Sign in through your account before opening checkout.");
  if (
    !Number.isSafeInteger(session.expires_at) ||
    session.expires_at * 1000 <= Date.now()
  )
    throw new Error(
      "Your account session has expired. Sign in again before opening checkout.",
    );
  const owner = session.account?.organizations?.find((item) => item.id === org);
  if (!owner || owner.role !== "owner" || typeof owner.name !== "string")
    throw new Error(
      "Only the authenticated organization owner can open its checkout.",
    );
  const checkout = await getJSON(
    "/v1/orgs/" + encodeURIComponent(org) + "/billing/checkout",
  );
  if (checkout.checkout === null)
    throw new Error(
      "No pending checkout exists. Choose a plan from your organization’s account page.",
    );
  if (
    !Object.hasOwn(plans, checkout.plan) ||
    !/^txn_[a-z0-9]{26}$/.test(checkout.transaction_id || "") ||
    !["sandbox", "live"].includes(checkout.environment) ||
    checkout.entitlement_granted !== false
  )
    throw new Error("The service returned an unsupported checkout record.");
  const prefix = checkout.environment === "sandbox" ? "test_" : "live_";
  if (
    typeof checkout.client_token !== "string" ||
    !checkout.client_token.startsWith(prefix) ||
    !/^(test|live)_[a-zA-Z0-9]{15,100}$/.test(checkout.client_token)
  )
    throw new Error(
      "Checkout authentication does not match the payment environment.",
    );
  if (
    checkout.expires_at !== undefined &&
    (!Number.isSafeInteger(checkout.expires_at) ||
      checkout.expires_at * 1000 <= Date.now())
  )
    throw new Error(
      "This checkout has expired. Return to your account to start again.",
    );
  if (session.expires_at * 1000 <= Date.now())
    throw new Error(
      "Your account session has expired. Sign in again before opening checkout.",
    );
  return { checkout, owner, expires: session.expires_at };
}

async function confirmUnchanged(chosen) {
  try {
    const current = await ownedCheckout(organization.id);
    if (
      ["transaction_id", "plan", "environment", "client_token"].some(
        (key) => current.checkout[key] !== chosen[key],
      )
    )
      throw new Error(
        "The pending checkout changed. Return to your account and review the current subscription before paying.",
      );
  } catch (error) {
    if (active)
      clear(
        error instanceof Error
          ? error.message
          : "The account service could not confirm this checkout.",
      );
    throw error;
  }
}

async function load() {
  try {
    const query = new URLSearchParams(location.search);
    const org = query.get("org");
    if (
      query.getAll("org").length !== 1 ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(org || "")
    )
      throw new Error(
        "Choose a subscription from your organization’s account page.",
      );
    byId("checkout-back").href =
      "/gate/account/?org=" + encodeURIComponent(org);
    const current = await ownedCheckout(org);
    if (!active) return;
    const checkout = current.checkout;
    organization = current.owner;
    if (
      query.has("_ptxn") &&
      (query.getAll("_ptxn").length !== 1 ||
        query.get("_ptxn") !== checkout.transaction_id)
    )
      throw new Error(
        "The payment link does not match this organization’s pending transaction.",
      );
    pending = Object.freeze({ ...checkout });
    byId("checkout-organization").textContent = organization.name;
    byId("checkout-plan").textContent = plans[checkout.plan].name;
    byId("checkout-price").textContent = plans[checkout.plan].price;
    byId("checkout-environment").textContent =
      checkout.environment === "sandbox"
        ? "Sandbox test — no real payment. Use Paddle’s test card details only."
        : "Live subscription — confirming in Paddle will charge your payment method.";
    status.textContent =
      "Pending checkout confirmed. No payment has been taken by this page.";
    byId("checkout-review").hidden = false;
    openButton.disabled = false;
  } catch (error) {
    if (active)
      clear(
        error instanceof Error ? error.message : "Checkout is unavailable.",
      );
  }
}

async function paddleScript() {
  if (window.Paddle) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      script.remove();
      reject(
        new Error("Paddle did not load. Check your connection and try again."),
      );
    }, 10000);
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error("Paddle could not be loaded."));
    };
    document.head.append(script);
  });
}

openButton.addEventListener("click", async () => {
  if (!pending || loading || !active) return;
  loading = true;
  openButton.disabled = true;
  const chosen = pending;
  try {
    await confirmUnchanged(chosen);
    if (!active || pending !== chosen) return;
    await paddleScript();
    if (!active || pending !== chosen) return;
    await confirmUnchanged(chosen);
    if (!active || pending !== chosen) return;
    if (!window.Paddle?.Checkout?.open)
      throw new Error("The Paddle checkout library is unavailable.");
    if (!initialized) {
      if (chosen.environment === "sandbox")
        window.Paddle.Environment.set("sandbox");
      window.Paddle.Initialize({
        token: chosen.client_token,
        eventCallback: (event) => {
          if (!active || !event || typeof event.name !== "string") return;
          if (event.name === "checkout.completed") {
            if (event.data?.transaction_id !== chosen.transaction_id) return;
            status.textContent =
              "Checkout returned. The account service must confirm payment before changing access.";
            location.assign(byId("checkout-back").href + "&checkout=returned");
          } else if (
            event.name === "checkout.closed" ||
            event.name === "checkout.error"
          ) {
            loading = false;
            openButton.disabled = !pending;
            status.textContent =
              event.name === "checkout.closed"
                ? "Checkout closed. Your account service remains the authority for payment status."
                : "Paddle could not complete checkout. Return to your account to check its status before retrying.";
          }
        },
      });
      initialized = true;
    }
    window.Paddle.Checkout.open({
      transactionId: chosen.transaction_id,
      // The admission catalog uses fixed prices; coupon-bearing transactions
      // are intentionally not eligible for automatic entitlement issuance.
      settings: {
        displayMode: "overlay",
        allowLogout: false,
        showAddDiscounts: false,
      },
    });
  } catch (error) {
    if (active) {
      loading = false;
      openButton.disabled = !pending;
      status.textContent =
        error instanceof Error
          ? error.message
          : "Checkout could not be opened.";
    }
  }
});

window.addEventListener("pagehide", () => {
  active = false;
  clear("Checkout closed.");
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
load();
