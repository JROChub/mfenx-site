/* Published artifact inspection. Verification belongs to the linked verifiers. */
"use strict";
(() => {
  const tabs = [...document.querySelectorAll("#evidence-tabs [role=tab]")];
  const panel = document.getElementById("evidence-panel");
  if (!panel || !tabs.length) return;
  const nodes = document.getElementById("record-nodes");
  const inspector = document.getElementById("record-inspector");
  const status = document.getElementById("record-status");
  const retry = document.getElementById("record-retry");
  const diagram = document.getElementById("record-diagram");
  const connections = diagram.querySelector("svg");
  const path = document.getElementById("record-path");
  let edges = [];
  function drawConnections() {
    const bounds = diagram.getBoundingClientRect();
    connections.setAttribute(
      "viewBox",
      "0 0 " + bounds.width + " " + bounds.height,
    );
    path.setAttribute(
      "d",
      edges
        .map(([from, to]) => {
          const a = nodes.children[from]?.getBoundingClientRect();
          const b = nodes.children[to]?.getBoundingClientRect();
          if (!a || !b) return "";
          const ax = a.x + a.width / 2 - bounds.x,
            ay = a.y + a.height / 2 - bounds.y;
          const bx = b.x + b.width / 2 - bounds.x,
            by = b.y + b.height / 2 - bounds.y;
          return "M" + ax + " " + ay + "L" + bx + " " + by;
        })
        .join(" "),
    );
  }
  if (typeof ResizeObserver !== "undefined")
    new ResizeObserver(drawConnections).observe(diagram);
  else window.addEventListener("resize", drawConnections);
  const formats = {
    receipt: {
      path: "/verify/example/release-receipt.json",
      title: "Optdigits / ONNX",
      format: "Release receipt",
      verify: "/verify/",
      action: "Open the receipt verifier",
    },
    execution: {
      path: "/lightsout/evidence/v0.1.6/summary.json",
      title: "Lights Out / v0.1.6",
      format: "Scientific evidence",
      verify: "/lightsout/#verify",
      action: "Verify published evidence",
    },
    lineage: {
      path: "/artifacts/rootprint-valid.json",
      title: "Power House / Rootprint",
      format: "Lineage example",
      verify: "/labs/",
      action: "Open the lineage verifier",
    },
  };
  const short = (value) =>
    typeof value === "string" && value.length > 30
      ? value.slice(0, 18) + "…" + value.slice(-8)
      : String(value);
  const cell = (title, subtitle, fields) => ({ title, subtitle, fields });
  function components(kind, record) {
    if (kind === "receipt") {
      if (record.schema !== "mfenx/release-receipt/v1")
        throw new Error("Unexpected receipt schema");
      const s = record.statement,
        e = s.evaluation;
      return [
        cell("Source", "Parent artifact", { "SHA-256": s.parent_sha256 }),
        cell("Candidate", s.artifact.format.toUpperCase(), {
          "SHA-256": s.artifact.sha256,
          "Size, bytes": s.artifact.bytes,
          Profile: s.profile,
        }),
        cell("Evaluation", e.samples.toLocaleString("en-US") + " samples", {
          "Contract SHA-256": s.contract_sha256,
          "Report SHA-256": e.report_sha256,
          "Source correct": e.source_correct,
          "Candidate correct": e.candidate_correct,
          "Decision changes": e.decision_changes,
          "Reported decision": e.decision,
        }),
        cell("Receipt", "Signed statement", {
          "Root identity": record.root_id,
          Issuer: record.issuer.name,
          Algorithm: record.signature.algorithm,
          Issued: s.issued_at,
          Expires: s.expires_at,
        }),
      ];
    }
    if (kind === "execution") {
      if (record.schema !== "mfenx.lightsout.scientific-evidence-summary.v2")
        throw new Error("Unexpected evidence schema");
      const r = record.release_identity,
        i = record.integrity,
        s = record.suite;
      return [
        cell("Source", r.tag, {
          Commit: r.commit,
          "Source tree": r.root_tree,
          "Power House tree": r.power_house_tree,
        }),
        cell("Build", "Versioned archive", {
          File: i.product_archive.filename,
          "SHA-256": i.product_archive.sha256,
        }),
        cell("Measurements", s.measured + " active runs", {
          Accepted: s.accepted,
          "Retained rejected": s.retained_rejected,
          Population: s.population,
          "Total bundle records": s.bundle_record_count,
        }),
        cell("Evidence", "Published suite", {
          Captured: record.generated_at_utc,
          "Suite SHA-256": i.evidence_suite_sha256,
          "Bundle SHA-256": i.hpc_evidence.archive_sha256,
          "Release workflow result":
            record.verification.release_verification.conclusion,
        }),
      ];
    }
    if (record.schema !== "power-house/rootprint/v1")
      throw new Error("Unexpected lineage schema");
    const entries = Object.entries(record.branches);
    if (entries.length !== 4) throw new Error("Unexpected lineage structure");
    return entries
      .sort((a, b) => a[1].sequence - b[1].sequence || a[0].localeCompare(b[0]))
      .map(([id, branch]) =>
        cell(
          branch.label ||
            branch.name ||
            (id === record.root_branch ? "Accepted" : "Branch"),
          "Sequence " + branch.sequence,
          {
            Identity: id,
            Parents: branch.parents.join("\n") || "None",
            "Selected root": id === record.root_branch ? "Yes" : "No",
            "Artifact format":
              branch.artifact?.schema ||
              branch.artifact?.kind ||
              "Embedded artifact",
          },
        ),
      );
  }
  function inspect(component, button) {
    for (const item of nodes.children)
      item.setAttribute("aria-pressed", String(item === button));
    const title = document.createElement("h3");
    title.textContent = component.title;
    const dl = document.createElement("dl");
    for (const [key, value] of Object.entries(component.fields)) {
      if (value === undefined || value === null)
        throw new Error("Missing record field");
      const row = document.createElement("div"),
        term = document.createElement("dt"),
        data = document.createElement("dd");
      term.textContent = key;
      data.textContent = String(value);
      row.append(term, data);
      dl.append(row);
    }
    inspector.replaceChildren(title, dl);
  }
  let controller,
    current = "receipt",
    request = 0;
  async function select(kind) {
    const generation = ++request;
    controller?.abort();
    controller = new AbortController();
    const activeController = controller;
    current = kind;
    const config = formats[kind];
    tabs.forEach((tab) => {
      const selected = tab.dataset.record === kind;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", "tab-" + kind);
    panel.setAttribute("aria-busy", "true");
    document.getElementById("record-title").textContent = config.title;
    document.getElementById("record-format").textContent = config.format;
    document.getElementById("record-source").href = config.path;
    const verify = document.getElementById("record-verify");
    verify.href = config.verify;
    verify.textContent = config.action;
    nodes.replaceChildren();
    inspector.replaceChildren();
    edges = [];
    path.setAttribute("d", "");
    retry.hidden = true;
    status.textContent = "Loading the published record.";
    const timeout = setTimeout(() => activeController.abort(), 10000);
    try {
      const response = await fetch(config.path, {
        signal: activeController.signal,
        credentials: "omit",
      });
      if (!response.ok) throw new Error("Unavailable record");
      const data = await response.json();
      if (generation !== request) return;
      const items = components(kind, data);
      // Validate before rendering so malformed records cannot leave partial success UI.
      if (
        items.some((item) =>
          Object.values(item.fields).some(
            (value) => value === undefined || value === null,
          ),
        )
      )
        throw new Error("Incomplete record");
      items.forEach((item, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.node = String(index);
        button.setAttribute("aria-pressed", "false");
        const label = document.createElement("span"),
          detail = document.createElement("span");
        label.textContent = item.title;
        detail.textContent = short(item.subtitle);
        button.append(label, detail);
        button.addEventListener("click", () => inspect(item, button));
        nodes.append(button);
      });
      edges =
        kind === "receipt"
          ? [
              [0, 2],
              [1, 2],
              [2, 3],
            ]
          : kind === "lineage"
            ? [
                [0, 1],
                [0, 2],
                [1, 3],
                [2, 3],
              ]
            : [
                [0, 1],
                [1, 2],
                [2, 3],
              ];
      diagram.dataset.record = kind;
      drawConnections();
      inspect(items[0], nodes.firstElementChild);
      status.textContent =
        "Published record loaded. Select a component to inspect its fields.";
    } catch (error) {
      if (generation !== request) return;
      nodes.replaceChildren();
      inspector.replaceChildren();
      status.textContent =
        "The record could not be loaded. Retry or open the source directly.";
      retry.hidden = false;
    } finally {
      clearTimeout(timeout);
      if (generation === request) panel.setAttribute("aria-busy", "false");
    }
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab.dataset.record));
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowDown" || event.key === "ArrowRight")
        next = (index + 1) % tabs.length;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft")
        next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      tabs[next].focus();
      select(tabs[next].dataset.record);
    });
  });
  retry.addEventListener("click", () => select(current));
  select(current);
})();
