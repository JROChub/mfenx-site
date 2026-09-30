import { NETWORK, pollStatus } from "./status-client.js?v=20260927-history1";

const set = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
const metrics = ["validators", "block-height", "sample-success", "sample-count", "sample-coverage", "client-version", "sampled-at", "last-finalized", "region", "quorum-state", "genesis-hash", "started-at"];
const stateNames = { starting: "STARTING", operational: "OPERATIONAL", degraded: "DEGRADED", unavailable: "UNAVAILABLE" };

function failure(message) {
  document.body.className = "outage";
  set("state-label", "UNAVAILABLE");
  set("rpc-state", "UNAVAILABLE");
  set("state-detail", `No current, identity-matched observation is available. ${message}`);
  set("campaign-state", "STATUS UNAVAILABLE");
  set("registration-state", "Enrollment unavailable");
  document.body.dataset.state = "stalled";
  for (const id of metrics) set(id, "Not available");
  set("updated-at", "No current observation");
  document.getElementById("validator-rows")?.replaceChildren();
}

function update(data) {
  document.body.className = data.status === "unavailable" ? "outage" : data.status;
  document.body.dataset.state = "not_started";
  set("state-label", stateNames[data.status]);
  set("state-detail", `${data.validators_healthy} of 3 validator processes are healthy in the latest reported sample. All run on one host in one failure domain.`);
  set("rpc-state", data.rpc.reachable ? "ONLINE" : "UNAVAILABLE");
  set("validators", `${data.validators_healthy} / 3`);
  set("block-height", data.block_height === null ? "Not observed" : data.block_height.toLocaleString("en-US"));
  set("client-version", data.client);
  set("genesis-hash", data.identity.genesis_hash);
  set("started-at", data.identity.started_at);
  set("sampled-at", data.sampled_at);
  set("updated-at", `Status generated ${data.generated_at}`);
  set("last-finalized", data.last_finalized_at || "No finalized block time observed");
  set("region", `${data.topology.regions[0]} / one host`);
  set("quorum-state", data.quorum_agreement ? "Agreement observed" : "No agreement observed");
  const sample = data.availability;
  set("sample-count", `${sample.successful_samples} / ${sample.sample_count}`);
  set("sample-success", sample.percent === null ? "Collecting" : `${sample.percent.toFixed(3)}% of observed samples`);
  set("sample-coverage", `${sample.observed_seconds.toLocaleString("en-US")} seconds observed / 86,400-second rolling window`);
  set("campaign-state", "NOT STARTED");
  set("registration-state", "Enrollment unavailable for this deployment");
  const rows = document.getElementById("validator-rows");
  if (rows) {
    rows.replaceChildren(...data.validators.map(validator => {
      const row = document.createElement("tr");
      for (const value of [validator.node_id, validator.healthy ? "Healthy sample" : "Unavailable sample", validator.height ?? "Not observed", validator.peer_id]) {
        const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
      }
      return row;
    }));
  }
}

set("network-name", NETWORK.name);
let stop = pollStatus(update, failure);
window.addEventListener("pagehide", () => {
  stop();
  failure("The page must obtain a new observation when reopened.");
});
window.addEventListener("pageshow", event => {
  if (event.persisted) stop = pollStatus(update, failure);
});
