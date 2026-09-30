#!/usr/bin/env python3
"""Local-only layout and keyboard checks for every published HTML page.

Payment, account, licensing, and cryptographic behavior remain covered by their
dedicated browser suites. This pass neither follows external purchase links nor
changes provider state. Screenshots are optional local review artifacts.
"""

from __future__ import annotations

import argparse
import functools
from html.parser import HTMLParser
import http.server
import json
from pathlib import Path
import threading
from urllib.parse import unquote, urlsplit

from playwright.sync_api import expect, sync_playwright


ROUTES = (
    "/", "/gate/", "/verify/", "/pricing/", "/docs/", "/docs/runtime/",
    "/enterprise/", "/evidence/", "/compute/", "/company/", "/power-house/",
    "/lightsout/", "/lightsout/commercial-licensing.html",
    "/terms/", "/privacy/", "/refunds/", "/support/",
    "/gate/account/", "/gate/checkout/", "/gate/license/",
    "/gate/payment/", "/gate/payment/billing/",
    "/labs/", "/ckodmk/", "/sain/", "/tessaryn/",
    "/campaign.html", "/register.html", "/status.html", "/slbit.html",
)
WIDTHS = (320, 390, 768, 1440)
SAIN_STATUS = "https://sain-mfenx-gateway.jrochub-resonance.workers.dev/api/status"
NETWORK_STATUS = "https://2026.rpc.mfenx.com/network-status.json"
API_PATHS = {"/auth/session", "/v1/session", "/v1/licenses/config"}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args: object) -> None:
        pass


class Identifiers(HTMLParser):
    def __init__(self, source: str):
        super().__init__()
        self.ids: set[str] = set()
        self.feed(source)

    def handle_starttag(self, _tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name == "id" and value:
                self.ids.add(value)


# This deliberately checks actual rendered text rather than arbitrary palette
# tokens. Gradients and image-backed text need screenshot review, not a guessed
# contrast value. The redesigned reading surfaces use solid backgrounds.
CONTRAST = r"""() => {
  const parse = value => {
    const match = value.match(/^rgba?\(([^)]+)\)$/);
    if (!match) return null;
    const values = match[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return values.length >= 3 ? [...values.slice(0, 3), values[3] ?? 1] : null;
  };
  const over = (front, back) => [
    ...front.slice(0, 3).map((channel, i) => channel * front[3] + back[i] * (1 - front[3])), 1
  ];
  const luminance = color => color.slice(0, 3).map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const background = element => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const color = parse(style.backgroundColor);
      if (!color || style.backgroundImage !== 'none') return null;
      layers.push(color);
      if (color[3] === 1) break;
    }
    return layers.reverse().reduce((color, layer) => over(layer, color), [255, 255, 255, 1]);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const failures = [], reviewed = new Set();
  let checked = 0, imageBacked = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode, element = node.parentElement;
    const text = node.textContent.trim();
    if (!text || !element || reviewed.has(element) ||
        element.closest('script, style, [hidden], [inert], [aria-hidden="true"], :disabled, [aria-disabled="true"]')) continue;
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || style.display === 'none') continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rectangles = [...range.getClientRects()];
    if (!rectangles.some(rect => rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth)) continue;
    reviewed.add(element);
    const back = background(element), raw = parse(style.color);
    if (!back || !raw) { imageBacked++; continue; }
    const foreground = over(raw, back);
    const values = [luminance(foreground), luminance(back)].sort((a, b) => a - b);
    const ratio = (values[1] + .05) / (values[0] + .05);
    const size = parseFloat(style.fontSize), weight = parseFloat(style.fontWeight);
    const minimum = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    checked++;
    if (ratio + .01 < minimum) failures.push({text: text.slice(0, 90), ratio: +ratio.toFixed(2), minimum});
  }
  return {checked, imageBacked, failures};
}"""


TYPOGRAPHY = r"""() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const failures = [], checked = new Set();
  while (walker.nextNode()) {
    const text = walker.currentNode, element = text.parentElement;
    if (!text.textContent.trim() || !element || checked.has(element) ||
        element.closest('script, style, [hidden], [inert], [aria-hidden="true"]')) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility !== 'visible') continue;
    const range = document.createRange(); range.selectNodeContents(text);
    if (![...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth)) continue;
    checked.add(element);
    const size = parseFloat(style.fontSize), weight = parseFloat(style.fontWeight);
    if (size > 16 || weight > 400) failures.push({text: text.textContent.trim().slice(0, 75), size, weight});
  }
  for (const element of document.querySelectorAll('button, input, textarea, select')) {
    if (!element.checkVisibility() || element.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
    const style = getComputedStyle(element), size = parseFloat(style.fontSize), weight = parseFloat(style.fontWeight);
    if (size > 16 || weight > 400) failures.push({text: element.id || element.tagName, size, weight});
  }
  return {checked: checked.size, failures};
}"""


def published_routes(root: Path) -> set[str]:
    routes = set()
    for path in root.rglob("*.html"):
        relative = path.relative_to(root).as_posix()
        routes.add("/" + relative.removesuffix("index.html") if path.name == "index.html" else "/" + relative)
    return routes


def prepare_page(page, route: str) -> None:
    if route == "/labs/":
        page.wait_for_selector("#boot-screen.hidden", state="attached", timeout=30_000)
        page.wait_for_selector("#boot-screen", state="hidden", timeout=30_000)
    elif route == "/tessaryn/":
        page.wait_for_selector("#app[data-ready='true']", timeout=30_000)
    elif route == "/sain/":
        expect(page.locator("#connectionLabel")).to_have_text("LOCAL CORTEX READY")


def check_skip_focus(page, route: str) -> None:
    # Some live instruments deliberately focus their primary input on startup.
    # Verify the real skip control by focusing it explicitly in that family;
    # document pages must still expose it as their first keyboard stop.
    skip = page.locator(".skip-link:visible, .skip:visible")
    expect(skip).to_have_count(1)
    if route == "/sain/":
        skip.focus()
    else:
        page.keyboard.press("Tab")
    expect(skip).to_be_focused()
    href = skip.evaluate("node => node.href")
    destination, current = urlsplit(href), urlsplit(page.url)
    assert (destination.scheme, destination.netloc, destination.path, destination.query) == (
        current.scheme, current.netloc, current.path, current.query
    ) and destination.fragment, "Skip target must remain in this document"
    target = "#" + destination.fragment
    page.keyboard.press("Enter")
    expect(page.locator(target)).to_be_focused()


def check_panel(page, selector: str) -> None:
    panel = page.locator(selector)
    expect(panel).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Open panel overflows: {selector}"
    box = panel.bounding_box()
    assert box and box["x"] >= -1 and box["x"] + box["width"] <= page.viewport_size["width"] + 1, selector
    typography = page.evaluate(TYPOGRAPHY)
    assert not typography["failures"], f"Panel typography: {typography['failures']}"
    contrast = page.evaluate(CONTRAST)
    assert not contrast["failures"], f"Panel contrast: {contrast['failures']}"


def check_instrument_panel(page, route: str) -> None:
    if route == "/labs/":
        page.locator("#portal-top-toggle").click()
        expect(page.locator("#portal-drawer")).to_have_attribute("aria-hidden", "false")
        check_panel(page, "#portal-drawer")
        page.locator("#portal-panel-close").click()
    elif route == "/tessaryn/":
        page.locator("#verify-button").click()
        expect(page.locator("#verify-title")).to_have_text("LOCAL WORLD ACCEPTED", timeout=30_000)
        check_panel(page, "#verification-dialog")
        assert page.locator("#verification-dialog").evaluate("node => node.contains(document.activeElement)"), "Dialog does not receive keyboard focus"
        page.keyboard.press("Escape")
        expect(page.locator("#verification-dialog")).not_to_be_visible()
    elif route == "/sain/":
        page.locator("#focusComposer").click()
        expect(page.locator("#question")).to_be_focused()
        page.locator("#webMode").click()
        expect(page.locator("#webMode")).to_have_attribute("aria-pressed", "true")
        page.locator("#webMode").click()
        expect(page.locator("#webMode")).to_have_attribute("aria-pressed", "false")


def check_local_links(page, root: Path, origin: str, cache: dict[Path, set[str]]) -> None:
    links = page.locator("a[href]").evaluate_all("nodes => nodes.map(node => node.href)")
    for href in links:
        parsed = urlsplit(href)
        if f"{parsed.scheme}://{parsed.netloc}" != origin:
            continue
        path = (root / unquote(parsed.path).lstrip("/")).resolve()
        if parsed.path == "/auth/login":
            # This is a server-owned authentication route, not a Pages file.
            continue
        assert path.is_relative_to(root), href
        if path.is_dir():
            path /= "index.html"
        assert path.is_file(), f"Missing local destination: {href}"
        if parsed.fragment and path.suffix == ".html":
            # These retained application routes open lab panels rather than
            # scrolling to static elements; test_gate_legacy_links covers them.
            if path in {root / "labs/index.html", root / "index.html"} and parsed.fragment in {"verify", "sfcs", "sfcs-run"}:
                continue
            if path not in cache:
                cache[path] = Identifiers(path.read_text()).ids
            # Application fragments are transport, not document anchors.
            if "=" not in parsed.fragment:
                assert unquote(parsed.fragment) in cache[path], f"Missing destination anchor: {href}"


def run(root: Path, chromium: str | None, output: Path | None,
        routes: tuple[str, ...] = ROUTES, widths: tuple[int, ...] = WIDTHS) -> int:
    root = root.resolve()
    assert set(ROUTES) == published_routes(root), "Every published HTML route must have explicit design coverage"
    if output:
        output.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(root))
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    failures: list[str] = []
    cache: dict[Path, set[str]] = {}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium, headless=True)
            context = browser.new_context(reduced_motion="reduce", service_workers="block")
            context.add_init_script("""if (location.pathname === '/sain/') {
                sessionStorage.setItem('sainAccessToken', 'synthetic-local-layout-fixture');
            }""")

            def local_only(route):
                url = route.request.url
                path = urlsplit(url).path
                if url == SAIN_STATUS and route.request.method == "GET":
                    route.fulfill(content_type="application/json", body=json.dumps({"ok": True, "snapshot": {
                        "identity_id": "sha256:" + "1" * 64, "generation": 1, "integrity": 1,
                        "memory_entries": 0, "causal_models": 0, "energy": 1, "stress": 0,
                        "capabilities": 0, "cognitive_genomes": 0, "current_goal": "Local browser layout fixture",
                        "cortex_ready": True,
                    }}))
                elif route.request.method in {"GET", "HEAD"} and (
                    url == NETWORK_STATUS or (url.startswith(origin + "/") and path in API_PATHS)
                ):
                    route.fulfill(status=503, content_type="application/json", body='{"error":"Unavailable in local browser test","detail":"Unavailable in local browser test"}')
                elif not url.startswith(origin + "/"):
                    failures.append(f"Unexpected external request: {url}")
                    route.abort()
                elif route.request.method not in {"GET", "HEAD"}:
                    failures.append(f"Unexpected outgoing data: {route.request.method} {url}")
                    route.abort()
                else:
                    route.continue_()

            context.route("**/*", local_only)
            for width in widths:
                for route in routes:
                    label = f"{route} at {width}px"
                    page = context.new_page()
                    page.set_viewport_size({"width": width, "height": 1000})
                    page.on("pageerror", lambda error, label=label: failures.append(f"{label}: {error}"))
                    page.on("response", lambda response, label=label: failures.append(
                        f"{label}: HTTP {response.status} {response.url}") if response.status >= 400
                        and response.url != NETWORK_STATUS and urlsplit(response.url).path not in API_PATHS else None)
                    try:
                        response = page.goto(origin + route, wait_until="networkidle")
                        assert response and response.status == 200, "Route did not load"
                        prepare_page(page, route)
                        expect(page.locator("h1:visible")).to_have_count(1)
                        expect(page.get_by_role("main")).to_have_count(1)
                        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal overflow"
                        clipped = page.evaluate("""() => [...document.querySelectorAll('h1, .site-header a, .mast a, .product-nav a')]
                            .filter(node => {const rect = node.getBoundingClientRect();
                              return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.right > innerWidth + 1);})
                            .map(node => node.textContent.trim())""")
                        assert not clipped, f"Clipped heading or navigation: {clipped}"
                        typography = page.evaluate(TYPOGRAPHY)
                        assert typography["checked"] >= 10, "Insufficient visible text coverage"
                        assert not typography["failures"], f"Oversized or bold text: {typography['failures']}"
                        check_skip_focus(page, route)
                        check_local_links(page, root, origin, cache)
                        for menu in page.locator("header details").all():
                            summary = menu.locator("summary").first
                            if not summary.is_visible():
                                continue
                            summary.focus()
                            page.keyboard.press("Enter")
                            assert menu.evaluate("node => node.open"), "Keyboard menu did not open"
                            for link in menu.locator("a").all():
                                expect(link).to_be_visible()
                                assert link.inner_text().strip() or link.get_attribute("aria-label"), "Unlabelled menu link"
                            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Open menu overflows"
                            page.keyboard.press("Enter")
                            assert not menu.evaluate("node => node.open"), "Keyboard menu did not close"
                        contrast = page.evaluate(CONTRAST)
                        assert contrast["checked"] >= 10, f"Insufficient readable-text coverage: {contrast}"
                        assert not contrast["failures"], f"Text contrast below WCAG AA: {contrast['failures']}"
                        check_instrument_panel(page, route)
                    except Exception as error:
                        failures.append(f"{label}: {error}")
                        print(f"FAIL: {label}: {error}", flush=True)
                    finally:
                        if output and width in (390, 1440):
                            page.evaluate("document.activeElement?.blur(); scrollTo(0, 0)")
                            name = route.strip("/").replace("/", "-").replace(".html", "") or "home"
                            page.screenshot(path=str(output / f"{name}-{width}.png"), full_page=True)
                        page.close()
                print(f"Checked {len(routes)} published routes at {width}px", flush=True)
            legacy = context.new_page()
            # Isolate the redirect from the unchanged research application's
            # startup. Its own full browser suite exercises the lab itself.
            legacy.route("**/labs/**", lambda route: route.fulfill(
                content_type="text/html", body="<!doctype html><title>Research destination</title>"))
            try:
                legacy.goto(origin + "/power-house/?utm_source=docs#scope-title")
                expect(legacy).to_have_url(origin + "/power-house/?utm_source=docs#scope-title")
                for path in ("/power-house/", "/power-house/index.html"):
                    legacy.goto(origin + path + "?portal=1&next=https%3A%2F%2Foutside.invalid#verify")
                    expect(legacy).to_have_url(origin + "/labs/?portal=1&next=https%3A%2F%2Foutside.invalid#verify")
            except Exception as error:
                failures.append(f"Power House legacy route compatibility: {error}")
            legacy.close()
            context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    for failure in failures:
        print("ERROR:", failure)
    if failures:
        return 1
    print(f"PASS: {len(routes)} published routes at {len(widths)} widths; small regular text; instrument panels; keyboard menus and skip links; local destinations; solid-background text contrast; locally intercepted requests")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("public"))
    parser.add_argument("--chromium")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--route", action="append", choices=ROUTES, help="limit a local diagnostic run to this route; repeatable")
    parser.add_argument("--width", action="append", type=int, choices=WIDTHS, help="limit a local diagnostic run to this width; repeatable")
    args = parser.parse_args()
    raise SystemExit(run(args.root, args.chromium, args.output,
                        tuple(args.route or ROUTES), tuple(args.width or WIDTHS)))
