#!/usr/bin/env python3
"""Real-browser acceptance for the local Gate receipt instrument and product routes."""
from __future__ import annotations

import argparse
import functools
import http.server
import json
from pathlib import Path
import threading

from playwright.sync_api import sync_playwright, expect


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def run(root: Path, chromium: str | None, output: Path | None) -> None:
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(root))
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    fixture = root / "verify/example"
    receipt = json.loads((fixture / "release-receipt.json").read_text())
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium, headless=True)
            context = browser.new_context()
            page = context.new_page()
            errors: list[str] = []
            outgoing: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: outgoing.append(request.url)
                    if request.method not in {"GET", "HEAD"} or not request.url.startswith(origin + "/") else None)
            for width in (320, 390, 768, 1440):
                page.set_viewport_size({"width": width, "height": 1000})
                for route in ("/", "/verify/", "/pricing/", "/docs/", "/enterprise/", "/evidence/", "/compute/"):
                    response = page.goto(origin + route)
                    assert response and response.status == 200, route
                    expect(page.locator("h1")).to_have_count(1)
                    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), (width, route)
                    page.keyboard.press("Tab")
                    expect(page.locator(".skip-link")).to_be_focused()
                    if output and width in (390, 1440) and route in ("/", "/verify/", "/pricing/"):
                        output.mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(output / f"{route.strip('/') or 'home'}-{width}.png"), full_page=True)

            page.goto(origin + "/verify/")
            page.get_by_role("button", name="Load the measured example").click()
            expect(page.locator("#result-title")).to_have_text("Signature verified.")
            expect(page.locator("#check-artifact")).to_have_text("Exact artifact match")
            expect(page.locator("#check-replay")).to_have_text("Not performed")
            expect(page.locator("#check-contract")).to_have_text("Not independently pinned")
            expect(page.locator("#result-state")).to_contain_text("DEMONSTRATION KEY")
            if output:
                page.screenshot(path=str(output / "verified-example-1440.png"), full_page=True)
            page.get_by_role("button", name="Clear inputs").click()
            expect(page.locator("#result-title")).to_have_text("Awaiting a receipt.")
            expect(page.locator("#receipt-details")).to_be_hidden()

            # All user-selected bytes must remain local, including on failure.
            requests: list[str] = []
            page.on("request", lambda request: requests.append(request.url))
            page.locator("#receipt").set_input_files(fixture / "release-receipt.json")
            page.locator("#trust-key").set_input_files(fixture / "issuer-public.der")
            page.get_by_role("button", name="Verify locally").click()
            expect(page.locator("#result-title")).to_have_text("Signature verified.")
            expect(page.locator("#check-artifact")).to_have_text("Model not supplied")
            page.locator("#model").set_input_files(fixture / "model.onnx")
            expect(page.locator("#result-title")).to_have_text("Awaiting a receipt.")
            expect(page.locator("#result-root")).to_be_hidden()
            page.locator("summary").filter(has_text="Check an approved contract").click()
            page.locator("#contract-digest").fill(receipt["statement"]["contract_sha256"])
            page.get_by_role("button", name="Verify locally").click()
            expect(page.locator("#result-title")).to_have_text("Signature verified.")
            expect(page.locator("#check-contract")).to_have_text("Approved digest match")

            bad_model = {"name": "changed.onnx", "mimeType": "application/octet-stream", "buffer": b"changed model"}
            page.locator("#model").set_input_files(bad_model)
            page.get_by_role("button", name="Verify locally").click()
            expect(page.locator("#result-title")).to_have_text("Not verified.")
            expect(page.locator("#result-summary")).to_contain_text("Artifact does not match")
            expect(page.locator("#receipt-details")).to_be_hidden()
            expect(page.locator("#check-signature")).to_have_text("Not checked")
            page.locator("#model").set_input_files([])

            wrong_key = {"name": "wrong.der", "mimeType": "application/octet-stream", "buffer": b"not the issuer key"}
            page.locator("#trust-key").set_input_files(wrong_key)
            page.get_by_role("button", name="Verify locally").click()
            expect(page.locator("#result-title")).to_have_text("Not verified.")
            expect(page.locator("#result-summary")).to_contain_text("trusted key")
            page.locator("#trust-key").set_input_files(fixture / "issuer-public.der")

            duplicate = (fixture / "release-receipt.json").read_text().replace('"schema":', '"schema":"forged","schema":', 1)
            page.locator("#receipt").set_input_files({"name": "ambiguous.json", "mimeType": "application/json", "buffer": duplicate.encode()})
            page.get_by_role("button", name="Verify locally").click()
            expect(page.locator("#result-title")).to_have_text("Not verified.")
            expect(page.locator("#result-summary")).to_contain_text("Duplicate")

            modified = json.loads(json.dumps(receipt))
            modified["statement"]["evaluation"]["candidate_correct"] -= 1
            page.locator("#receipt").set_input_files({"name": "altered.json", "mimeType": "application/json", "buffer": json.dumps(modified).encode()})
            page.get_by_role("button", name="Verify locally").click()
            expect(page.locator("#result-title")).to_have_text("Not verified.")
            expect(page.locator("#result-summary")).to_contain_text("root mismatch")

            page.locator("#receipt").set_input_files(fixture / "release-receipt.json")
            page.locator("#contract-digest").fill("sha256:" + "0" * 64)
            page.get_by_role("button", name="Verify locally").click()
            expect(page.locator("#result-title")).to_have_text("Not verified.")
            expect(page.locator("#result-summary")).to_contain_text("expected policy")

            # A valid old verification completing after Clear must not restore
            # accepted evidence. Hold exactly the cryptographic await, not time.
            page.get_by_role("button", name="Clear inputs").click()
            page.locator("#receipt").set_input_files(fixture / "release-receipt.json")
            page.locator("#trust-key").set_input_files(fixture / "issuer-public.der")
            page.evaluate("""() => {
                const original = crypto.subtle.verify.bind(crypto.subtle);
                crypto.subtle.verify = (...args) => new Promise((resolve, reject) => {
                    document.documentElement.dataset.verificationHeld = 'yes';
                    window.releaseHeldVerification = async () => {
                        crypto.subtle.verify = original;
                        try { resolve(await original(...args)); } catch (error) { reject(error); }
                    };
                });
            }""")
            page.get_by_role("button", name="Verify locally").click()
            expect(page.locator("html")).to_have_attribute("data-verification-held", "yes")
            expect(page.locator("#result-title")).to_have_text("Checking locally…")
            page.get_by_role("button", name="Clear inputs").click()
            page.evaluate("""async () => {
                await window.releaseHeldVerification();
                await new Promise(resolve => setTimeout(resolve, 0));
                delete window.releaseHeldVerification;
                delete document.documentElement.dataset.verificationHeld;
            }""")
            expect(page.locator("#result-title")).to_have_text("Awaiting a receipt.")
            expect(page.locator("#result-root")).to_be_hidden()
            expect(page.locator("#receipt-details")).to_be_hidden()
            expect(page.locator("#check-signature")).to_have_text("Not checked")
            assert requests == [], f"Local input handling issued network requests: {requests}"
            assert outgoing == [], outgoing
            assert errors == [], errors
            assert page.evaluate("Object.keys(localStorage).length + Object.keys(sessionStorage).length") == 0
            browser.close()
            print("PASS: Gate routes at 4 widths; real example; local verification; tamper/key/model/policy rejection; stale-state clearing; zero input uploads or persistence")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("public"))
    parser.add_argument("--chromium")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    run(args.root.resolve(), args.chromium, args.output)
