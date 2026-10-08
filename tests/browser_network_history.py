#!/usr/bin/env python3
"""Local-only new-history browser contract; no operational requests are sent."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import functools
import http.server
import json
from pathlib import Path
import threading

from playwright.sync_api import expect, sync_playwright
from browser_site_design import NETWORK_STATUS, QuietHandler, TYPOGRAPHY, check_skip_focus


def run(root: Path, chromium: str | None, output: Path | None) -> None:
    root = root.resolve()
    template = json.loads((Path(__file__).parent / "fixtures/network-status-v1.json").read_text())
    failures: list[str] = []
    requests: list[tuple[str, str]] = []
    if output:
        output.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    mode = "valid"

    def fixture():
        data = json.loads(json.dumps(template))
        now = datetime.now(timezone.utc)
        iso = lambda value: value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        data["generated_at"] = data["sampled_at"] = iso(now)
        data["identity"]["started_at"] = iso(now - timedelta(seconds=120))
        data["last_finalized_at"] = iso(now - timedelta(seconds=60))
        if mode == "stale":
            data["sampled_at"] = iso(now - timedelta(seconds=61))
        elif mode == "wrong_history":
            data["identity"]["chain_id"] = 177155
        elif mode == "wrong_genesis":
            data["identity"]["genesis_hash"] = "0x" + "f" * 64
        elif mode == "future":
            data["generated_at"] = iso(now + timedelta(seconds=11))
        elif mode == "two_operational" or mode == "degraded":
            data["validators_healthy"] = 2
            data["validators"][2]["healthy"] = False
            if mode == "degraded":
                data["status"] = "degraded"
        elif mode == "campaign_passed":
            data["reliability_campaign"]["status"] = "passed"
        elif mode == "enrollment_enabled":
            data["enrollment"]["observers"] = True
        elif mode == "starting":
            data.update(status="starting", quorum_agreement=False, validators_healthy=0, block_height=None, tip_hash=None, last_finalized_at=None)
            data["rpc"]["reachable"] = False
            for validator in data["validators"]:
                validator.update(healthy=False, height=None, tip_hash=None, genesis_hash=None)
            data["availability"].update(sample_count=0, successful_samples=0, percent=None, observed_seconds=0)
        elif mode == "xss":
            data["client"] = '<img src=x onerror="window.injected=true">'
            data["validators"][0]["node_id"] = '<svg onload="window.injected=true">'
        return data

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium, headless=True)
            context = browser.new_context(service_workers="block", reduced_motion="reduce")

            def local_only(route):
                request = route.request
                requests.append((request.method, request.url))
                if request.url == NETWORK_STATUS and request.method == "GET":
                    if mode == "http_error":
                        route.fulfill(status=503, content_type="application/json", body='{"error":"local fixture"}')
                    elif mode == "redirect":
                        route.fulfill(status=302, headers={"location": "https://rpc.mfenx.com/network-status.json"})
                    elif mode == "malformed":
                        route.fulfill(content_type="application/json", body="{")
                    else:
                        route.fulfill(content_type="application/json", body=json.dumps(fixture()))
                elif request.url.startswith(origin + "/") and request.method in {"GET", "HEAD"}:
                    route.continue_()
                else:
                    failures.append(f"Unexpected request {request.method} {request.url}")
                    route.abort()

            context.route("**/*", local_only)
            for width in (320, 390, 768, 1440):
                mode = "valid"
                page = context.new_page()
                page.set_viewport_size({"width": width, "height": 1000})
                page.on("pageerror", lambda error: failures.append(str(error)))
                for path in ("/status.html", "/campaign.html", "/register.html"):
                    page.goto(origin + path, wait_until="networkidle")
                    expect(page.locator("#state-label")).to_have_text("OPERATIONAL")
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (path, width)
                    assert not page.evaluate(TYPOGRAPHY)["failures"], (path, width)
                    expect(page.locator("h1:visible")).to_have_count(1)
                    check_skip_focus(page, path)
                    if path == "/status.html":
                        expect(page.get_by_role("link", name="https://rpc.mfenx.com/2026/", exact=True)).to_have_attribute("href", "https://rpc.mfenx.com/2026/")
                        expect(page.locator('a[href="https://rpc.mfenx.com/"]')).to_have_count(0)
                        expect(page.locator("#validators")).to_have_text("3 / 3")
                        expect(page.locator("#genesis-hash")).to_have_text(template["identity"]["genesis_hash"])
                        expect(page.locator("#validator-rows tr")).to_have_count(3)
                        expect(page.locator("#sample-success")).to_have_text("95.833% of observed samples")
                        expect(page.locator("#sample-coverage")).to_contain_text("120 seconds observed")
                    elif path == "/campaign.html":
                        expect(page.locator("#campaign-state")).to_have_text("NOT STARTED")
                    else:
                        for selector in ("#registration-file", "#submission-package", "#submit-registration"):
                            expect(page.locator(selector)).to_be_disabled()
                        expect(page.locator("#register-command, #copy-command")).to_have_count(0)
                    if output and width in (390, 1440):
                        page.locator("body").click(position={"x": 1, "y": 1})
                        page.evaluate("scrollTo(0,0)")
                        page.screenshot(path=str(output / f"{path[1:-5]}-{width}.png"), full_page=True)
                    print(f"PASS {path} identity, samples, keyboard and layout at {width}px", flush=True)
                page.goto(origin + "/network/contracts.html", wait_until="networkidle")
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), ("contracts", width)
                assert not page.evaluate(TYPOGRAPHY)["failures"], ("contracts", width)
                expect(page.locator("h1:visible")).to_have_count(1)
                check_skip_focus(page, "/network/contracts.html")
                expect(page.get_by_role("link", name="Acceptance contract source")).to_have_attribute("href", "/network/MFENXExecutionProbe.sol")
                expect(page.get_by_role("link", name="Finalized ledger through block 18")).to_have_attribute("download", "")
                expect(page.get_by_role("link", name="corresponding validator source")).to_have_attribute("download", "")
                if output and width in (390, 1440):
                    page.screenshot(path=str(output / f"contracts-{width}.png"), full_page=True)
                print(f"PASS contract documentation, source links, keyboard and layout at {width}px", flush=True)
                page.close()

            page = context.new_page()
            page.on("pageerror", lambda error: failures.append(str(error)))
            for mode in ("stale", "wrong_history", "wrong_genesis", "future", "two_operational", "campaign_passed", "enrollment_enabled", "http_error", "redirect", "malformed"):
                page.goto(origin + "/status.html", wait_until="networkidle")
                expect(page.locator("#state-label")).to_have_text("UNAVAILABLE")
                expect(page.locator("#validators")).to_have_text("Not available")
                expect(page.locator("#block-height")).to_have_text("Not available")
                expect(page.locator("#sample-success")).to_have_text("Not available")
                expect(page.locator("#validator-rows tr")).to_have_count(0)
                print(f"PASS reject {mode} and clear claimed metrics", flush=True)
            mode = "degraded"
            page.goto(origin + "/status.html", wait_until="networkidle")
            expect(page.locator("#state-label")).to_have_text("DEGRADED")
            expect(page.locator("#validators")).to_have_text("2 / 3")
            mode = "starting"
            page.goto(origin + "/status.html", wait_until="networkidle")
            expect(page.locator("#state-label")).to_have_text("STARTING")
            expect(page.locator("#block-height")).to_have_text("Not observed")
            expect(page.locator("#sample-success")).to_have_text("Collecting")
            mode = "xss"
            page.goto(origin + "/status.html", wait_until="networkidle")
            expect(page.locator("#state-label")).to_have_text("OPERATIONAL")
            expect(page.locator("#client-version")).to_contain_text("<img")
            assert page.locator("#client-version img, #validator-rows svg").count() == 0
            assert page.evaluate("window.injected === undefined")
            print("PASS degraded/startup semantics and untrusted text escaping", flush=True)

            mode = "valid"
            page.goto(origin + "/status.html", wait_until="networkidle")
            expect(page.locator("#validators")).to_have_text("3 / 3")
            mode = "http_error"
            # Exercise the real bounded poll interval, not a test-only render hook.
            expect(page.locator("#state-label")).to_have_text("UNAVAILABLE", timeout=20_000)
            for selector in ("#validators", "#block-height", "#genesis-hash", "#sample-success", "#sampled-at"):
                expect(page.locator(selector)).to_have_text("Not available")
            expect(page.locator("#updated-at")).to_have_text("No current observation")
            print("PASS later fetch failure removes every prior live metric", flush=True)
            mode = "valid"
            page.goto(origin + "/status.html", wait_until="networkidle")
            expect(page.locator("#state-label")).to_have_text("OPERATIONAL")
            page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true}))")
            expect(page.locator("#state-label")).to_have_text("UNAVAILABLE")
            page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}))")
            expect(page.locator("#state-label")).to_have_text("OPERATIONAL")
            print("PASS restored page obtains fresh telemetry instead of retaining old state", flush=True)
            assert not failures, "\n".join(failures)
            assert all(method in {"GET", "HEAD"} for method, _ in requests)
            print(f"PASS local-only network history suite; {len(requests)} GET/HEAD requests, no live RPC or enrollment writes", flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("public"))
    parser.add_argument("--chromium")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    run(args.root, args.chromium, args.output)
