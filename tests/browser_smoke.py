#!/usr/bin/env python3
"""Local Chromium smoke checks for the deployed static payload."""

from __future__ import annotations

import argparse
import contextlib
import functools
import http.server
import threading
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass


def assert_no_runtime_errors(page: Page, failures: list[str], label: str) -> None:
    page_errors: list[str] = []
    console_errors: list[str] = []
    request_errors: list[str] = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("requestfailed", lambda request: request_errors.append(f"{request.url}: {request.failure}"))
    page.goto(label, wait_until="networkidle")
    page.wait_for_timeout(800)
    failures.extend(f"{label} page error: {item}" for item in page_errors)
    failures.extend(f"{label} console error: {item}" for item in console_errors)
    failures.extend(f"{label} request error: {item}" for item in request_errors)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    args = parser.parse_args()
    root = args.root.resolve()
    failures: list[str] = []
    handler = functools.partial(QuietHandler, directory=str(root))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.chromium, headless=True, args=["--no-sandbox"])
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, service_workers="block")

            home = context.new_page()
            home_requests: list[str] = []
            home.on("request", lambda request: home_requests.append(request.url))
            assert_no_runtime_errors(home, failures, origin + "/")
            try:
                home.wait_for_selector("#boot-screen.hidden", timeout=20_000)
                assert "LIGHTS OUT" in home.locator(".top-actions").inner_text()
                nav_text = home.locator(".top-actions").inner_text()
                assert "STATUS" not in nav_text and "72H" not in nav_text
                assert not home.locator('a[href="status.html"], a[href="campaign.html"], a[href="register.html"]').count()
                home.locator("#portal-top-toggle").click()
                assert home.locator("#portal-drawer").get_attribute("aria-hidden") == "false"
                home.locator("#portal-input").fill("MFENX browser smoke test")
                home.locator("#portal-input-verify").click()
                home.wait_for_function("document.querySelector('#portal-result')?.dataset.status === 'valid'", timeout=10_000)
                home.locator("#portal-panel-close").click()
                home.locator("#observatory-toggle").click()
                assert "observatory-open" in (home.locator("body").get_attribute("class") or "")
                home.locator("#observatory-close").click()
                home.locator("#evaluation-toggle").click()
                assert "evaluation-open" in (home.locator("body").get_attribute("class") or "")
                home.locator("#evaluation-close").click()
                home.locator("#sfcs-orbit-toggle").click()
                assert home.locator("#sfcs-orbit-toggle").get_attribute("aria-expanded") == "true"
                home.locator("#sfcs-orbit-run").click()
                home.wait_for_function("document.querySelector('#sfcs-run-console')?.dataset.status === 'valid'", timeout=15_000)
            except (AssertionError, Exception) as exc:
                failures.append(f"homepage interaction check: {exc}")
            if any("rpc.mfenx.com" in url for url in home_requests):
                failures.append("homepage requested rpc.mfenx.com")
            home.close()

            for width in (320, 390, 768, 1440):
                page = context.new_page()
                page.set_viewport_size({"width": width, "height": 1000})
                assert_no_runtime_errors(page, failures, origin + "/lightsout/")
                try:
                    page.wait_for_selector("#release-state.pass", timeout=20_000)
                    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                    assert overflow == 0, f"{width}px viewport has {overflow}px global overflow"
                    assert page.locator("#release-speedup").inner_text() == "49.2271104608×"
                    assert page.locator("#record-evaluation").inner_text() == "SIGNED / CURRENT"
                    assert page.locator("[data-commercial-resource][aria-disabled='true']").count() == 0
                except (AssertionError, Exception) as exc:
                    failures.append(f"Lights Out {width}px check: {exc}")
                page.close()

            tessaryn = context.new_page()
            assert_no_runtime_errors(tessaryn, failures, origin + "/tessaryn/")
            try:
                tessaryn.wait_for_function("document.body.dataset.ready === 'true'", timeout=20_000)
                assert tessaryn.locator("h1#origin-name").count() == 1
            except (AssertionError, Exception) as exc:
                failures.append(f"Tessaryn accessibility check: {exc}")
            tessaryn.close()

            slbit = context.new_page()
            assert_no_runtime_errors(slbit, failures, origin + "/slbit.html")
            try:
                slbit.wait_for_selector("#summary-tabs [role='tab']", timeout=10_000)
                tabs = slbit.locator("#summary-tabs [role='tab']")
                assert tabs.count() >= 2
                assert slbit.locator("#summary-tabs [role='tab'][aria-selected='true']").count() == 1
                tabs.nth(1).click()
                assert tabs.nth(1).get_attribute("aria-selected") == "true"
                assert slbit.locator("#summary-text").get_attribute("aria-labelledby") == tabs.nth(1).get_attribute("id")
            except (AssertionError, Exception) as exc:
                failures.append(f"SLBIT accessibility check: {exc}")
            slbit.close()

            register = context.new_page()
            assert_no_runtime_errors(register, failures, origin + "/register.html")
            try:
                assert register.locator('label[for="submission-package"]').count() == 1
            except AssertionError as exc:
                failures.append(f"registration accessibility check: {exc}")
            register.close()
            context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    if failures:
        for failure in failures:
            print(f"ERROR: {failure}")
        return 1
    print("browser smoke checks: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
