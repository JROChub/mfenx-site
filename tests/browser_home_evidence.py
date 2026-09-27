#!/usr/bin/env python3
"""Published-record explorer: actual fields, keyboard control and async safety."""
from __future__ import annotations

import argparse
import functools
import http.server
import json
from pathlib import Path
import threading

from playwright.sync_api import expect, sync_playwright

from browser_site_design import QuietHandler


SOURCES = {
    "receipt": "/verify/example/release-receipt.json",
    "execution": "/lightsout/evidence/v0.1.6/summary.json",
    "lineage": "/artifacts/rootprint-valid.json",
}


def values(root: Path) -> dict[str, list[dict[str, object]]]:
    receipt, execution, lineage = (json.loads((root / SOURCES[kind].lstrip("/")).read_text())
                                   for kind in ("receipt", "execution", "lineage"))
    statement = receipt["statement"]
    evaluation = statement["evaluation"]
    return {
        "receipt": [
            {"SHA-256": statement["parent_sha256"]},
            {"SHA-256": statement["artifact"]["sha256"], "Size, bytes": statement["artifact"]["bytes"], "Profile": statement["profile"]},
            {"Contract SHA-256": statement["contract_sha256"], "Report SHA-256": evaluation["report_sha256"],
             "Source correct": evaluation["source_correct"], "Candidate correct": evaluation["candidate_correct"],
             "Decision changes": evaluation["decision_changes"], "Reported decision": evaluation["decision"]},
            {"Root identity": receipt["root_id"], "Issuer": receipt["issuer"]["name"],
             "Algorithm": receipt["signature"]["algorithm"], "Issued": statement["issued_at"], "Expires": statement["expires_at"]},
        ],
        "execution": [
            {"Commit": execution["release_identity"]["commit"], "Source tree": execution["release_identity"]["root_tree"],
             "Power House tree": execution["release_identity"]["power_house_tree"]},
            {"File": execution["integrity"]["product_archive"]["filename"], "SHA-256": execution["integrity"]["product_archive"]["sha256"]},
            {"Accepted": execution["suite"]["accepted"], "Retained rejected": execution["suite"]["retained_rejected"],
             "Population": execution["suite"]["population"], "Total bundle records": execution["suite"]["bundle_record_count"]},
            {"Captured": execution["generated_at_utc"], "Suite SHA-256": execution["integrity"]["evidence_suite_sha256"],
             "Bundle SHA-256": execution["integrity"]["hpc_evidence"]["archive_sha256"],
             "Release workflow result": execution["verification"]["release_verification"]["conclusion"]},
        ],
        "lineage": [{"Identity": identifier, "Parents": "\n".join(branch["parents"]) or "None",
                     "Selected root": "Yes" if identifier == lineage["root_branch"] else "No",
                     "Artifact format": branch.get("artifact", {}).get("schema") or branch.get("artifact", {}).get("kind") or "Embedded artifact"}
                    for identifier, branch in sorted(lineage["branches"].items(), key=lambda item: (item[1]["sequence"], item[0]))],
    }


def ready(page, kind: str) -> None:
    expect(page.locator(f"#tab-{kind}")).to_have_attribute("aria-selected", "true")
    expect(page.locator("#evidence-panel")).to_have_attribute("aria-busy", "false")
    expect(page.locator("#record-status")).to_contain_text("Published record loaded.")
    expect(page.locator("#record-nodes [data-node]")).to_have_count(4)


def run(root: Path, chromium: str | None, output: Path | None) -> None:
    root = root.resolve()
    expected = values(root)
    if output:
        output.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(root)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    failures = []
    requests = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium, headless=True)
            context = browser.new_context(service_workers="block", reduced_motion="reduce")

            def local_only(route):
                request = route.request
                requests.append((request.method, request.url))
                if not request.url.startswith(origin + "/") or request.method not in {"GET", "HEAD"}:
                    failures.append(f"Unexpected request: {request.method} {request.url}")
                    route.abort()
                else:
                    route.continue_()

            context.route("**/*", local_only)
            page = context.new_page()
            page.on("pageerror", lambda error: failures.append(str(error)))
            for width in (320, 390, 768, 1440):
                page.set_viewport_size({"width": width, "height": 1000})
                page.goto(origin + "/", wait_until="networkidle")
                ready(page, "receipt")
                for kind in SOURCES:
                    page.locator(f"#tab-{kind}").click()
                    ready(page, kind)
                    expect(page.locator("#record-source")).to_have_attribute("href", SOURCES[kind])
                    expect(page.locator("#evidence-panel")).to_have_attribute("aria-labelledby", f"tab-{kind}")
                    assert "verified" not in page.locator("#record-status").inner_text().lower(), "Inspection must not claim verification"
                    for index, fields in enumerate(expected[kind]):
                        node = page.locator(f"#record-nodes [data-node='{index}']")
                        node.focus()
                        page.keyboard.press("Enter")
                        expect(node).to_have_attribute("aria-pressed", "true")
                        expect(page.locator("#record-nodes [aria-pressed='true']")).to_have_count(1)
                        rendered = page.locator("#record-inspector dl").evaluate("node => Object.fromEntries([...node.children].map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]))")
                        assert rendered == {key: str(value) for key, value in fields.items()}, (kind, index, rendered, fields)
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width, kind)
                    if output and width in (390, 1440):
                        page.screenshot(path=str(output / f"home-{kind}-{width}.png"), full_page=True)
                page.locator("#tab-receipt").focus()
                for key, kind in (("ArrowDown", "execution"), ("ArrowRight", "lineage"), ("Home", "receipt"), ("End", "lineage"), ("ArrowUp", "execution"), ("ArrowLeft", "receipt")):
                    page.keyboard.press(key)
                    ready(page, kind)
                    expect(page.locator(f"#tab-{kind}")).to_be_focused()
                print(f"PASS homepage real artifact fields, component inspection and tab keyboard contract at {width}px", flush=True)

            source = origin + SOURCES["receipt"]
            for bad in (None, {}, {"schema": "mfenx/release-receipt/v1", "statement": {}}):
                page.route(source, lambda route, _request, bad=bad: route.fulfill(status=503 if bad is None else 200,
                    content_type="application/json", body=json.dumps(bad)))
                page.locator("#tab-execution").click()
                ready(page, "execution")
                page.locator("#tab-receipt").click()
                expect(page.locator("#record-status")).to_contain_text("could not be loaded")
                expect(page.locator("#evidence-panel")).to_have_attribute("aria-busy", "false")
                expect(page.locator("#record-nodes [data-node]")).to_have_count(0)
                expect(page.locator("#record-inspector")).to_be_empty()
                expect(page.locator("#record-retry")).to_be_visible()
                page.unroute(source)
                page.locator("#record-retry").click()
                ready(page, "receipt")

            # Hold a real fetch response, then change records. A late result
            # must not overwrite the newer selection or expose stale fields.
            page.add_init_script("""(() => {
              const original = window.fetch;
              window.fetch = async (...args) => {
                const response = await original(...args);
                if (String(args[0]).endsWith('/verify/example/release-receipt.json')) {
                  window.__receiptHeld = true;
                  await new Promise(resolve => {window.__releaseReceipt = resolve;});
                }
                return response;
              };
            })();""")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_function("window.__receiptHeld === true")
            page.locator("#tab-execution").click()
            ready(page, "execution")
            page.evaluate("async () => {window.__releaseReceipt(); await new Promise(resolve => setTimeout(resolve, 0));}")
            ready(page, "execution")
            expect(page.locator("#record-source")).to_have_attribute("href", SOURCES["execution"])
            assert page.evaluate("localStorage.length + sessionStorage.length") == 0
            assert not failures, failures
            no_script = browser.new_context(java_script_enabled=False, service_workers="block")
            no_script.route("**/*", local_only)
            document = no_script.new_page()
            document.goto(origin + "/")
            for source_path in SOURCES.values():
                expect(document.locator(f"noscript a[href='{source_path}']")).to_be_visible()
            no_script.close()
            context.close()
            browser.close()
            print("PASS homepage HTTP/schema failures, explicit retry, late-response rejection, no browser persistence or uploads, and no-JavaScript sources")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("public"))
    parser.add_argument("--chromium")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    run(args.root, args.chromium, args.output)
