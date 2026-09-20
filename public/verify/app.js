import { verifyReceipt } from "./receipt.js";

const get = (id) => document.getElementById(id);
const form = get("verify-form");
const result = get("result");
const fields = ["receipt", "trust-key", "model", "contract-digest"];
const statuses = ["signature", "artifact", "contract", "behavior", "replay"];
let generation = 0;
let example = null;
let loading = null;

function clearResult() {
  result.classList.remove("result-error");
  get("result-state").textContent = "LOCAL VERIFIER";
  get("result-title").textContent = "Awaiting a receipt.";
  get("result-summary").textContent =
    "Choose a receipt and a trusted key. The result will separate signature authentication, model binding and behavioral evidence.";
  for (const name of statuses) {
    get(`check-${name}`).textContent =
      name === "replay" ? "Not performed" : "Not checked";
    get(`check-${name}`).className = "";
  }
  get("result-root").hidden = true;
  get("result-root").textContent = "";
  get("receipt-details").hidden = true;
  get("receipt-details").open = false;
  get("receipt-json").textContent = "";
}

function invalidate(keepExample = false) {
  generation++;
  if (!keepExample) example = null;
  get("receipt").required = !example;
  get("trust-key").required = !example;
  loading?.abort();
  loading = null;
  get("verify-button").disabled = false;
  get("load-example").disabled = false;
  get("input-note").textContent =
    "Files stay in browser memory. Nothing is saved to an account or sent to a server. Reloading clears the inputs.";
  clearResult();
}

for (const name of fields)
  get(name).addEventListener("input", () =>
    invalidate(name === "contract-digest"),
  );
get("clear-button").addEventListener("click", () => {
  form.reset();
  invalidate();
});

function reject(error) {
  clearResult();
  result.classList.add("result-error");
  get("result-state").textContent = "CHECK REJECTED";
  get("result-title").textContent = "Not verified.";
  get("result-summary").textContent =
    error instanceof Error
      ? error.message
      : "The local check could not complete.";
}

async function read(file, limit, label) {
  if (!file) throw new Error(`Select ${label}.`);
  if (!file.size || file.size > limit)
    throw new Error(`${label} exceeds the supported size or is empty.`);
  return new Uint8Array(await file.arrayBuffer());
}

function check(name, text, good = false) {
  get(`check-${name}`).textContent = text;
  get(`check-${name}`).className = good ? "status-good" : "";
}

function show(verified, isExample) {
  const { receipt } = verified;
  result.classList.remove("result-error");
  get("result-state").textContent = isExample
    ? "MEASURED EXAMPLE · DEMONSTRATION KEY"
    : "ISSUER ATTESTATION";
  get("result-title").textContent = "Signature verified.";
  get("result-summary").textContent =
    `${receipt.issuer.name} signed this receipt. Its structure, commitments and validity passed the local check. This is not an independent replay of the evaluation.`;
  check("signature", "Trusted-key match", true);
  check(
    "artifact",
    verified.artifactStatus === "MATCH"
      ? "Exact artifact match"
      : "Model not supplied",
    verified.artifactStatus === "MATCH",
  );
  check(
    "contract",
    verified.contractStatus === "MATCH"
      ? "Approved digest match"
      : verified.contractStatus === "NOT_APPLICABLE"
        ? "Integrity profile"
        : "Not independently pinned",
    verified.contractStatus === "MATCH",
  );
  check(
    "behavior",
    verified.behavioralStatus === "ISSUER_ATTESTED_FINITE_EVALUATION"
      ? "Issuer-attested finite evaluation"
      : "Not evaluated",
  );
  check("replay", "Not performed");
  get("result-root").textContent =
    `Receipt root\n${receipt.root_id}\n\nTrusted key\n${receipt.issuer.key_id}\n\nValid until ${receipt.statement.expires_at}`;
  get("result-root").hidden = false;
  get("receipt-json").textContent = JSON.stringify(receipt, null, 2);
  get("receipt-details").hidden = false;
}

async function verify(inputs, isExample, turn) {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Web Crypto requires a secure browser context. Use HTTPS or the offline CLI.",
    );
  const options = {};
  if (inputs.artifact) options.artifactBytes = inputs.artifact;
  const expected = get("contract-digest").value.trim();
  if (expected) options.expectedContractDigest = expected;
  const verified = await verifyReceipt(inputs.receipt, inputs.key, options);
  if (generation === turn) show(verified, isExample);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const turn = ++generation;
  const currentExample = example;
  clearResult();
  get("result-title").textContent = "Checking locally…";
  get("verify-button").disabled = true;
  try {
    const inputs = currentExample ?? {
      receipt: await read(get("receipt").files[0], 65536, "a release receipt"),
      key: await read(get("trust-key").files[0], 4096, "a trusted issuer key"),
      artifact: get("model").files[0]
        ? await read(get("model").files[0], 64 * 1024 * 1024, "the model")
        : undefined,
    };
    await verify(inputs, !!currentExample, turn);
  } catch (error) {
    if (generation === turn) reject(error);
  } finally {
    if (generation === turn) get("verify-button").disabled = false;
  }
});

// Only the explicitly selected public example is fetched. User input is never
// put in a URL, request body, storage entry, analytics event or exception log.
get("load-example").addEventListener("click", async () => {
  form.reset();
  invalidate();
  const turn = generation;
  loading = new AbortController();
  get("load-example").disabled = true;
  get("verify-button").disabled = true;
  get("result-title").textContent = "Opening the measured example…";
  try {
    async function load(name, max) {
      const response = await fetch(`/verify/example/${name}`, {
        signal: loading.signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok)
        throw new Error(
          "The example is unavailable. You can still verify local files.",
        );
      const data = new Uint8Array(await response.arrayBuffer());
      if (!data.length || data.length > max)
        throw new Error("The example asset has an invalid size.");
      return data;
    }
    const [receipt, key, artifact] = await Promise.all([
      load("release-receipt.json", 65536),
      load("issuer-public.der", 4096),
      load("model.onnx", 64 * 1024 * 1024),
    ]);
    if (generation !== turn) return;
    example = { receipt, key, artifact };
    get("receipt").required = false;
    get("trust-key").required = false;
    get("input-note").textContent =
      "The included Optdigits example uses a demonstration key. The model, receipt and public key are downloaded—not your files uploaded. Select your own receipt to leave example mode.";
    await verify(example, true, turn);
  } catch (error) {
    if (generation === turn && error.name !== "AbortError") reject(error);
  } finally {
    if (generation === turn) {
      get("load-example").disabled = false;
      get("verify-button").disabled = false;
      loading = null;
    }
  }
});
