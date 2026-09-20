#!/usr/bin/env python3
"""Check the local-evaluation entry without selecting or uploading model files."""

from __future__ import annotations

import argparse
import functools
import http.server
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--chromium")
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(QuietHandler, directory=str(args.root.resolve()))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    failures: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=args.chromium, headless=True, args=["--no-sandbox"]
            )
            context = browser.new_context(service_workers="block")
            for width in (320, 390, 768, 1440):
                page = context.new_page()
                page.set_viewport_size({"width": width, "height": 1000})
                page.emulate_media(reduced_motion="reduce")
                page.on("pageerror", lambda error: failures.append(str(error)))
                page.on("requestfailed", lambda request: failures.append(f"{request.url}: {request.failure}"))
                page.on("response", lambda response: failures.append(f"HTTP {response.status}: {response.url}") if response.status >= 400 else None)
                page.on("request", lambda request: failures.append(f"Unexpected external request: {request.url}") if not request.url.startswith((origin + "/", "blob:" + origin + "/", "data:")) else None)
                page.on("request", lambda request: failures.append(f"Unexpected outgoing data: {request.method} {request.url}") if request.method not in {"GET", "HEAD"} else None)
                page.goto(origin + "/gate/", wait_until="networkidle")
                if args.screenshots:
                    page.screenshot(path=str(args.screenshots / f"gate-evaluation-{width}.png"), full_page=True)
                try:
                    assert page.locator("main h1").count() == 1
                    assert page.locator("nav[aria-label='Main navigation'] [aria-current='page']").get_attribute("href") == "/gate/"
                    assert page.locator("a.button").get_attribute("href") == "/ckodmk/#pcm-gate"
                    assert page.locator("a[href='/ckodmk/#workspace']").count() == 1
                    assert page.locator("a[href='/ckodmk/#install']").count() == 1
                    assert page.locator("table a[href='/verify/']").count() == 1
                    assert "does not replay the evaluation" in page.locator("table").inner_text()
                    assert "compatible execution adapter" in page.locator("table").inner_text()
                    assert page.locator("input[type='file'], form, script").count() == 0
                    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), f"global overflow at {width}px"
                    invalid_fragments = page.evaluate("""() => [...document.querySelectorAll('a[href^="#"]')]
                        .map(link => link.getAttribute('href').slice(1))
                        .filter(id => !document.getElementById(id))""")
                    assert not invalid_fragments, invalid_fragments
                    page.keyboard.press("Tab")
                    assert page.locator(".skip-link").evaluate("node => node === document.activeElement")
                    page.keyboard.press("Enter")
                    assert page.locator("main").evaluate("node => node === document.activeElement")
                    page.locator("a.button").click()
                    page.wait_for_url(origin + "/ckodmk/#pcm-gate")
                    assert page.locator("#pcm-gate").count() == 1
                    assert page.locator("#verify-included-pcm").count() == 1
                    assert page.locator("#download-admitted-model").is_disabled()
                    if width == 1440:
                        page.locator("#verify-included-pcm").click()
                        page.wait_for_selector("#pcm-decision.pass, #pcm-decision.block", timeout=120_000)
                        assert page.locator("#pcm-decision").inner_text() == "ADMITTED", page.locator("#pcm-status").inner_text()
                        assert page.locator("#pcm-check-package").get_attribute("data-state") == "pass"
                        assert page.locator("#pcm-check-replay").get_attribute("data-state") == "pass"
                        assert page.locator("#download-admitted-model").is_enabled()
                except Exception as exc:
                    failures.append(f"Local evaluation at {width}px: {exc}")
                page.close()
            context.close()
            no_script = browser.new_context(java_script_enabled=False)
            page = no_script.new_page()
            page.goto(origin + "/gate/", wait_until="networkidle")
            assert page.locator("a.button").is_visible()
            assert page.locator("#workflow-title").is_visible()
            no_script.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    if failures:
        for failure in failures:
            print(f"ERROR: {failure}")
        return 1
    print("local evaluation browser checks: PASS (4 viewports, keyboard, destinations, no JavaScript)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
