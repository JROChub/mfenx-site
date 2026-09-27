#!/usr/bin/env python3
"""Exercise retained research controls without contacting operational services."""
from __future__ import annotations

import argparse
import functools
import http.server
import json
from pathlib import Path
import threading

from playwright.sync_api import expect, sync_playwright

from browser_site_design import NETWORK_STATUS, QuietHandler, prepare_page


def run(root: Path, chromium: str | None, output: Path | None) -> None:
    root = root.resolve()
    if output:
        output.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(root)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    failures: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium, headless=True)
            context = browser.new_context(service_workers="block", reduced_motion="reduce", accept_downloads=True)
            context.add_init_script("""Object.defineProperty(navigator, 'clipboard', {
                value: {writeText: async value => {window.__copiedText = value;}}
            });""")

            def local_only(route):
                request = route.request
                if request.url == NETWORK_STATUS and request.method == "GET":
                    route.fulfill(status=503, content_type="application/json", body='{"error":"Unavailable local test fixture"}')
                elif request.url == "https://sain-mfenx-gateway.jrochub-resonance.workers.dev/auth" and request.method == "POST":
                    assert request.post_data_json == {"password": "synthetic-rejected-key"}
                    route.fulfill(status=401, content_type="application/json", body='{"ok":false,"error":"Rejected local browser fixture"}')
                elif request.url.startswith(origin + "/") and request.method in {"GET", "HEAD"}:
                    route.continue_()
                else:
                    failures.append(f"Unexpected request: {request.method} {request.url}")
                    route.abort()

            context.route("**/*", local_only)
            sidecar = json.loads((root / "artifacts/luminous-valid.json").read_text())
            for width in (390, 1440):
                page = context.new_page()
                page.set_viewport_size({"width": width, "height": 1000})
                page.on("pageerror", lambda error: failures.append(str(error)))

                page.goto(origin + "/labs/", wait_until="networkidle")
                prepare_page(page, "/labs/")
                for mode in ("rootprint", "sfcs", "constant", "affine", "sparse", "committed"):
                    control = page.locator(f".proof-mode[data-mode='{mode}']")
                    control.click()
                    expect(control).to_have_attribute("aria-pressed", "true")
                    expect(page.locator(".proof-mode[aria-pressed='true']")).to_have_count(1)
                    expect(page.locator("#mode-value")).to_have_text(mode.upper())
                page.locator(".proof-mode[data-mode='rootprint']").click()
                page.locator("#verify-button").click()
                expect(page.locator("#verification-status")).to_have_text("VERIFICATION COMPLETE", timeout=30_000)
                expect(page.locator("#luminous-core-state")).to_have_text("VERIFIED")
                page.locator("#luminous-toggle").click()
                expect(page.locator("#luminous-toggle")).to_have_attribute("aria-expanded", "true")
                expect(page.locator(".luminous-edges")).to_have_attribute("preserveAspectRatio", "none")
                expect(page.locator(".luminous-node")).to_have_count(len(sidecar["nodes"]))
                for node in page.locator(".luminous-node").all():
                    branch = node.get_attribute("data-branch-id")
                    node.focus()
                    page.keyboard.press("Enter")
                    expect(node).to_have_attribute("aria-pressed", "true")
                    expect(page.locator("#luminous-node-title")).to_have_text(sidecar["nodes"][branch]["claim_id"])
                page.locator("#luminous-toggle").click()

                page.locator("#portal-top-toggle").click()
                page.locator("#portal-input").fill("Deterministic local regression input")
                page.locator("#portal-input-verify").click()
                expect(page.locator("#portal-result")).to_have_attribute("data-status", "valid", timeout=15_000)
                root_id = page.locator("#portal-rootid").inner_text()
                page.locator("#portal-input-clear").click()
                expect(page.locator("#portal-input")).to_be_focused()
                page.locator("#portal-input").fill("Deterministic local regression input")
                page.locator("#portal-input-verify").click()
                expect(page.locator("#portal-result")).to_have_attribute("data-status", "valid", timeout=15_000)
                expect(page.locator("#portal-rootid")).to_have_text(root_id)
                page.locator("#portal-panel-close").click()
                page.locator("#sfcs-orbit-toggle").click()
                page.locator("#sfcs-orbit-run").click()
                expect(page.locator("#sfcs-run-console")).to_have_attribute("data-status", "valid", timeout=30_000)
                page.locator("#sfcs-orbit-close").click()
                page.locator("#observatory-toggle").click()
                page.locator("#city-search").fill("Tokyo")
                city = page.locator(".city-row:visible").first
                city_index = city.get_attribute("data-index")
                city.click()
                expect(page.locator(f".city-row[data-index='{city_index}']")).to_have_class("city-row active")
                if width <= 760:
                    page.locator("#observatory-toggle").click()
                page.locator("#time-forward").click()
                expect(page.locator("#time-slider")).to_have_value("1")
                page.locator("#time-live").click()
                expect(page.locator("#time-slider")).to_have_value("0")
                page.locator("#observatory-close").click()
                page.locator("#evaluation-toggle").click()
                assert "evaluation-open" in (page.locator("body").get_attribute("class") or "")
                page.locator("#evaluation-close").click()
                before = page.locator("#motion-toggle").get_attribute("aria-label")
                page.locator("#motion-toggle").click()
                assert page.locator("#motion-toggle").get_attribute("aria-label") != before
                print(f"PASS Labs modes, real Rootprint/SFCS, graph keyboard controls, portal, city/time and drawers at {width}px", flush=True)

                page.goto(origin + "/slbit.html", wait_until="networkidle")
                expect(page.locator("#verify-state")).to_have_text("VERIFIED")
                for panel in (".verification-panel", ".json-panel"):
                    page.locator(panel + " > summary").click()
                    assert page.locator(panel).evaluate("node => node.open")
                packet_ids = set()
                for sample in ("drone", "agent", "zkml", "finance"):
                    previous_id = page.locator("#packet-id").inner_text()
                    page.locator(f"#sample-{sample}").click()
                    if sample != "drone":
                        expect(page.locator("#packet-id")).not_to_have_text(previous_id)
                    expect(page.locator("#verify-state")).to_have_text("VERIFIED")
                    packet = json.loads(page.locator("#json-preview").inner_text())
                    expect(page.locator("#packet-id")).to_have_text(packet["packet_id"])
                    expect(page.locator("#packet-digest")).to_have_text(packet["digests"]["packet"])
                    packet_ids.add(packet["packet_id"])
                    expect(page.locator(".graph-node")).to_have_count(len(packet["semantic_graph"]["nodes"]))
                    for index, node_data in enumerate(packet["semantic_graph"]["nodes"]):
                        label = f"{node_data.get('kind') or 'Node'}: {node_data.get('label') or node_data['id']}"
                        node = page.get_by_role("button", name=label, exact=True)
                        expect(node).to_have_attribute("role", "button")
                        expect(node).to_have_attribute("tabindex", "0")
                        expect(node).to_have_attribute("aria-label", label)
                        node.focus()
                        page.keyboard.press("Enter" if index % 2 == 0 else "Space")
                        expect(page.locator(".graph-node[aria-pressed='true']")).to_have_count(1)
                        expect(node).to_have_attribute("aria-pressed", "true")
                        expect(node).to_be_focused()
                        expect(page.locator("#claim-title")).to_have_text(node_data.get("label") or node_data["id"])
                    tabs = page.locator("#summary-tabs [role='tab']")
                    tabs.first.focus()
                    page.keyboard.press("End")
                    expect(tabs.last).to_have_attribute("aria-selected", "true")
                    expect(tabs.last).to_be_focused()
                    page.keyboard.press("Home")
                    expect(tabs.first).to_have_attribute("aria-selected", "true")
                assert len(packet_ids) == 4
                page.locator("#copy-llm").click()
                page.wait_for_function("typeof window.__copiedText === 'string' && window.__copiedText.length > 0")
                print(f"PASS SLBIT four authentic samples, digest display and keyboard audience tabs at {width}px", flush=True)

                page.goto(origin + "/register.html", wait_until="networkidle")
                page.locator("#node-id").fill("local-regression")
                expect(page.locator("#register-command")).to_contain_text("local-regression")
                page.locator("#copy-command").click()
                page.wait_for_function("window.__copiedText === document.querySelector('#register-command').textContent")
                page.locator("#registration-file").set_input_files({"name": "invalid.json", "mimeType": "application/json", "buffer": b"not json"})
                expect(page.locator("#file-state")).to_have_text("ERROR")
                expect(page.locator("#submit-registration")).to_be_disabled()
                page.goto(origin + "/status.html", wait_until="networkidle")
                expect(page.locator("#state-label")).to_have_text("UNAVAILABLE")
                page.goto(origin + "/campaign.html", wait_until="networkidle")
                expect(page.locator("#campaign-state")).to_have_text("STATUS UNAVAILABLE")
                print(f"PASS local registration controls and explicit unavailable-feed states at {width}px", flush=True)

                page.goto(origin + "/sain/", wait_until="networkidle")
                expect(page.locator("#accessGate")).to_be_visible()
                expect(page.locator(".shell")).to_have_attribute("aria-hidden", "true")
                page.locator("#accessPassword").fill("synthetic-rejected-key")
                page.locator("#accessSubmit").click()
                expect(page.locator("#accessError")).to_have_text("Rejected local browser fixture")
                expect(page.locator(".shell")).to_have_attribute("aria-hidden", "true")
                assert page.evaluate("sessionStorage.getItem('sainAccessToken')") is None
                if output:
                    page.screenshot(path=str(output / f"sain-locked-{width}.png"), full_page=True)
                page.close()
                print(f"PASS SAIN locked-view input and rejected mocked authentication at {width}px", flush=True)
            context.close()
            browser.close()
        assert not failures, failures
        print("PASS: retained research interactions at mobile and desktop; all operational requests intercepted; no real registration or authentication")
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
