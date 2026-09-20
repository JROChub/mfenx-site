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
    # Keep observing after initial navigation: signature checks and interactions
    # are asynchronous and their failures must not disappear after the first wait.
    page.on("pageerror", lambda error: failures.append(f"{label} page error: {error}"))
    page.on("console", lambda message: failures.append(f"{label} console error: {message.text}") if message.type == "error" else None)
    page.on("requestfailed", lambda request: failures.append(f"{label} request error: {request.url}: {request.failure}"))
    page.goto(label, wait_until="networkidle")
    page.wait_for_timeout(800)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--chromium", help="optional Chromium executable; defaults to Playwright's managed browser")
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
            assert_no_runtime_errors(home, failures, origin + "/labs/")
            try:
                # finishBoot adds .hidden; its CSS deliberately makes the element
                # invisible. Require completed startup, then its hidden state,
                # rather than waiting for the completed screen to be visible.
                home.wait_for_selector("#boot-screen.hidden", state="attached", timeout=20_000)
                home.wait_for_selector("#boot-screen", state="hidden", timeout=20_000)
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
                failures.append(f"retained research homepage interaction check: {exc}")
            if any("rpc.mfenx.com" in url for url in home_requests):
                failures.append("retained research homepage requested rpc.mfenx.com")
            home.close()

            for width in (320, 390, 768, 1440):
                page = context.new_page()
                page.set_viewport_size({"width": width, "height": 1000})
                page.emulate_media(reduced_motion="reduce")
                page.add_init_script("""Object.defineProperty(navigator, 'clipboard', {
                    value: {writeText: async text => {window.__copiedCommands = text;}}
                });""")
                assert_no_runtime_errors(page, failures, origin + "/lightsout/")
                try:
                    page.wait_for_selector("#release-state.pass", timeout=20_000)
                    heading = page.locator("main h1").first.inner_text().lower()
                    assert "supercomputer" in heading, "Lights Out H1 does not identify the product as a supercomputer"
                    assert "qqfenx" in heading, "Lights Out H1 does not identify the QQfenx engine"
                    assert page.locator("#qqfenx").count() == 1
                    assert "32 → 8 → 0" in page.locator(".qqfenx-proof").inner_text()
                    assert "0 / 8" in page.locator(".qqfenx-proof .signal").inner_text()
                    assert "Q8 · Q16 · Q24 · Q32" in page.locator(".quotient-route").inner_text()
                    assert page.locator("#hero-current-release").inner_text() == "v0.1.3 · signed · verified"
                    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                    assert overflow == 0, f"{width}px viewport has {overflow}px global overflow"
                    assert page.locator("#release-speedup").text_content() == "49.2271104608×"
                    assert page.locator("#record-evaluation").inner_text() == "V0.1.3 / VERIFIED"
                    assert page.locator("[data-commercial-resource][aria-disabled='true']").count() == 0
                    assert "C11 QQfenx" in page.locator(".hero .lede").inner_text()
                    gpu_copy = page.locator("#resident-gpu").inner_text()
                    assert "resident" in gpu_copy.lower() or "retains intermediate tensors" in gpu_copy
                    assert "Whistler" in gpu_copy and "software renderer is rejected" in gpu_copy
                    assert "v0.1.6" in page.locator("#hero-product-release").inner_text()
                    assert "CURRENT PRODUCT RELEASE" not in page.locator(".identity-strip").inner_text()
                    visible_text = page.locator("body").inner_text().lower()
                    for retired in ("forthcoming", "next private", "runtime preview", "we do not claim", "claim-boundary", "trust-boundary", "top500"):
                        assert retired not in visible_text, f"retired or unsupported public language: {retired}"
                    assert not page.locator("#verification-list, [data-check]").count()
                    assert page.locator("#verification-status").get_attribute("data-state") == "pass"
                    clipped = page.evaluate("""() => [...document.querySelectorAll('.mast .wordmark, .mast .release-state, .product-nav a, .hero h1, .software-grid article')]
                        .filter(node => {const r = node.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1;})
                        .map(node => node.textContent.trim())""")
                    assert not clipped, f"clipped product navigation/content: {clipped}"
                    assert page.locator("main h1").count() == 1
                    assert page.locator("nav[aria-label='Lights Out navigation'] a").count() == 7
                    assert page.locator(".atomic-invitation a[href='atomic/']").count() == 1
                    invalid_fragments = page.evaluate("""() => [...document.querySelectorAll('a[href^="#"]')]
                        .map(link => link.getAttribute('href').slice(1))
                        .filter(id => !id || !document.getElementById(id))""")
                    assert not invalid_fragments, f"unresolved fragment links: {invalid_fragments}"
                    page.keyboard.press("Tab")
                    assert page.locator(".skip-link").evaluate("node => node === document.activeElement")
                    page.keyboard.press("Enter")
                    assert page.locator("main").evaluate("node => node === document.activeElement")
                    assert not page.locator("#execution-foundation").evaluate("node => node.open")
                    page.locator("#open-execution-evidence").click()
                    assert page.locator("#execution-foundation").evaluate("node => node.open")
                    page.locator("#execution-foundation > summary").click()
                    assert not page.locator("#execution-foundation").evaluate("node => node.open")
                    page.locator("#copy-commands").click()
                    page.wait_for_function("window.__copiedCommands === document.querySelector('#run-commands').textContent")
                    page.locator("#rerun-verification").click()
                    page.wait_for_selector("#release-state.pass", timeout=20_000)
                    assert page.locator("#verification-status").get_attribute("data-state") == "pass"
                except (AssertionError, Exception) as exc:
                    failures.append(f"Lights Out {width}px check at line {exc.__traceback__.tb_lineno}: {exc}")
                page.close()

            licensing = context.new_page()
            licensing.set_viewport_size({"width": 390, "height": 1000})
            assert_no_runtime_errors(licensing, failures, origin + "/lightsout/commercial-licensing.html")
            try:
                assert "v0.1.3" in licensing.locator("body").inner_text()
                assert "QQfenx" in licensing.locator("body").inner_text()
                assert licensing.locator('a[href^="mailto:licensing@mfenx.com"]').count() == 1
                assert licensing.locator('a[href="index.html"]').count() >= 1
                assert "qualified resident opengl" in licensing.locator(".seal").inner_text().lower()
                assert "scientific acceptance" in licensing.locator(".seal").inner_text().lower()
                assert "next private" not in licensing.locator("body").inner_text().lower()
                assert licensing.locator("form").count() == 0, "commercial contact must not silently submit a form"
                assert licensing.locator("a[href='/']").count() == 1
                overflow = licensing.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                assert overflow == 0, f"commercial licensing page has {overflow}px global overflow"
            except (AssertionError, Exception) as exc:
                failures.append(f"Lights Out commercial licensing check at line {exc.__traceback__.tb_lineno}: {exc}")
            licensing.close()

            deep_link = context.new_page()
            assert_no_runtime_errors(deep_link, failures, origin + "/lightsout/#performance")
            try:
                deep_link.wait_for_selector("#release-state.pass", timeout=20_000)
                assert deep_link.locator("#execution-foundation").evaluate("node => node.open")
                assert deep_link.locator("#performance-title").is_visible()
            except (AssertionError, Exception) as exc:
                failures.append(f"historical evidence deep-link check: {exc}")
            deep_link.close()

            # A corrupted, successfully delivered record must fail closed, then
            # recover when the same user explicitly retries with intact bytes.
            rejected = context.new_page()
            rejection_route = "**/evidence/v0.1.6/summary.json"
            rejected.route(rejection_route, lambda route: route.fulfill(status=200, content_type="application/json", body="{}"))
            assert_no_runtime_errors(rejected, failures, origin + "/lightsout/")
            try:
                rejected.wait_for_selector("#release-state.fail", timeout=20_000)
                assert rejected.locator("#verification-status").get_attribute("data-state") == "fail"
                assert rejected.locator("#release-verdict").inner_text() == "REJECTED"
                assert rejected.locator("#release-speedup").text_content() == "—"
                assert rejected.locator("[data-scientific-values]:visible").count() == 0
                assert rejected.locator(".hero a[href='commercial-licensing.html']").is_visible()
                rejected.unroute(rejection_route)
                rejected.locator("#rerun-verification").click()
                rejected.wait_for_selector("#release-state.pass", timeout=20_000)
                assert rejected.locator("#scientific-build-total").inner_text() == "15 / 15"
            except (AssertionError, Exception) as exc:
                failures.append(f"published evidence rejection/retry check at line {exc.__traceback__.tb_lineno}: {exc}")
            rejected.close()

            no_script_context = browser.new_context(java_script_enabled=False, viewport={"width": 320, "height": 1000})
            no_script = no_script_context.new_page()
            assert_no_runtime_errors(no_script, failures, origin + "/lightsout/")
            try:
                assert no_script.locator(".noscript-note").is_visible()
                assert no_script.locator(".hero a[href='commercial-licensing.html']").is_visible()
                assert no_script.locator("#resident-gpu").is_visible()
                assert no_script.locator("[data-scientific-values]:visible").count() == 0
                assert no_script.locator("#execution-foundation > summary").is_visible()
            except (AssertionError, Exception) as exc:
                failures.append(f"no-JavaScript product access check: {exc}")
            no_script_context.close()

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
