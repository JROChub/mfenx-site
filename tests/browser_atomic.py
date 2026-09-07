#!/usr/bin/env python3
"""Exercise the shipped Atomic UI and real C11 WASM/BigInt worker in Chromium.

No simulated result or accepted-report injection is used. The observer below
only copies real Worker messages. Two explicitly fault-injected cases delay a
File.text read or hold one request and shorten its UI deadline; subsequent
retries execute the unmodified production worker. No external form is sent.
"""

from __future__ import annotations

import argparse
import contextlib
import functools
import hashlib
import http.server
import json
import tempfile
import threading
import time
import traceback
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Browser, Page, sync_playwright


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass


OBSERVER = """(() => {
  const NativeWorker = window.Worker;
  window.__atomicBrowserTest = {messages: [], requests: [], created: 0, terminated: 0};
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      window.__atomicBrowserTest.created++;
      this.addEventListener('message', event => {
        window.__atomicBrowserTest.messages.push(structuredClone(event.data));
      });
    }
    postMessage(...args) {
      window.__atomicBrowserTest.requests.push(structuredClone(args[0]));
      return super.postMessage(...args);
    }
    terminate() {window.__atomicBrowserTest.terminated++; return super.terminate();}
  };
})();"""

TIMEOUT_FAULT = """(() => {
  // Fault injection: withhold ONLY the first request. Never fabricate a result.
  const ObservedWorker = window.Worker;
  let held = false;
  window.Worker = class extends ObservedWorker {
    postMessage(...args) {
      if (!held) {held = true; return;}
      return super.postMessage(...args);
    }
  };
  const nativeSetTimeout = window.setTimeout;
  let shortened = false;
  window.setTimeout = function(callback, delay, ...args) {
    if (!shortened && delay === 20000) {shortened = true; delay = 150;}
    return nativeSetTimeout(callback, delay, ...args);
  };
})();"""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def result_count(page: Page) -> int:
    return page.evaluate("__atomicBrowserTest.messages.filter(m => m.type === 'result').length")


def request_count(page: Page) -> int:
    return page.evaluate("__atomicBrowserTest.requests.length")


def wait_js(page: Page, expression: str, *, arg=None, timeout: int = 15000) -> None:
    # Older Playwright's in-page wait_for_function poller can invoke eval on a
    # later animation frame, which newer Chromium correctly blocks under this
    # site's CSP. Read directly through the debugging protocol instead; never
    # bypass or weaken the production CSP to make the test pass.
    deadline = time.monotonic() + timeout / 1000
    while True:
        if page.evaluate(expression, arg):
            return
        if time.monotonic() >= deadline:
            raise AssertionError(f"timed out waiting for browser state: {expression}")
        page.wait_for_timeout(50)


def accepted(page: Page, previous: int = 0) -> dict:
    wait_js(page, "n => __atomicBrowserTest.messages.filter(m => m.type === 'result').length > n", arg=previous)
    page.wait_for_selector("#proof-light.pass", state="attached")
    wait_js(page, "!document.querySelector('#execute').disabled")
    report = page.evaluate("__atomicBrowserTest.messages.filter(m => m.type === 'result').at(-1).report")
    require(report["verified"] is True, "result lacks independent acceptance")
    require(page.locator("#receipt-hash").inner_text() == report["capsule"]["sha256"], "DOM receipt is not the accepted report")
    require(page.locator("#export-receipt").is_enabled(), "accepted receipt cannot be exported")
    require(report["totals"]["requested"] == report["totals"]["executed"] + report["totals"]["annihilated"], "MAC accounting mismatch")
    require(report["totals"]["replay_macs"] == 2 * report["n"] ** 3, "full replay work is missing")
    require(report["engine"]["memoryBytes"] == 4194304, "wrong fixed WASM memory")
    require(report["engine"]["arenaBytes"] == 1048576, "wrong engine arena bound")
    require(page.locator("#logical-macs").inner_text() == f'{report["totals"]["requested"]:,}', "displayed logical count mismatch")
    require(page.locator("#replay-macs").inner_text() == f'{report["totals"]["replay_macs"]:,}', "displayed replay count mismatch")
    return report


def run_again(page: Page, selector: str = "#execute") -> dict:
    previous = result_count(page)
    page.locator(selector).click()
    return accepted(page, previous)


def no_acceptance(page: Page, failed: bool = False) -> None:
    require(page.locator("#proof-light.pass, #proof-symbol.pass").count() == 0, "stale accepted indicators remain")
    require(page.locator("#export-receipt").is_disabled(), "stale accepted capsule remains exportable")
    require(page.locator("#logical-macs").inner_text() == "—", "stale accepted work count remains")
    require(page.locator("#replay-macs").inner_text() == "—", "stale replay work count remains")
    require(page.locator("#rail-accept b").inner_text() == "LOCKED", "acceptance rail is not locked")
    require("mission accepted" not in page.locator("#world-caption").inner_text(), "stale accepted world caption remains")
    require(page.locator("#receipt-hash").inner_text() == "Run the reactor to create a receipt.", "stale receipt hash remains")
    if failed:
        require(page.locator("#telemetry-state").inner_text() == "NO ACCEPTED RESULT", "failure did not clear telemetry")
        require(page.locator("#proof-title").inner_text() == "Acceptance withheld.", "failure lacks withheld verdict")


def wait_failed(page: Page) -> None:
    page.locator('#engine-status[data-state="error"]').wait_for(state="attached")
    no_acceptance(page, failed=True)


def file_payload(value: object, name: str = "capsule.json") -> dict:
    return {"name": name, "mimeType": "application/json", "buffer": json.dumps(value).encode()}


def rehash_capsule(capsule: dict) -> dict:
    value = {key: capsule[key] for key in ("schema", "level", "seed", "board", "engineSha256", "outputDigest")}
    value["sha256"] = hashlib.sha256(json.dumps(value, separators=(",", ":")).encode()).hexdigest()
    return value


class Suite:
    def __init__(self, browser: Browser, origin: str, output: Path) -> None:
        self.browser, self.origin, self.output = browser, origin, output
        self.failures: list[str] = []
        self.passed: list[str] = []
        self.cases = 0

    @contextlib.contextmanager
    def page(self, width: int = 1440, *, javascript: bool = True, fault: str = "", routes: tuple = ()):
        context = self.browser.new_context(viewport={"width": width, "height": 1000},
            reduced_motion="reduce", java_script_enabled=javascript, service_workers="block", accept_downloads=True)
        try:
            if javascript:
                # Playwright does not promise ordering between separate init
                # scripts. Install the observer and optional fault atomically.
                context.add_init_script(OBSERVER + "\n" + fault)
            for pattern, handler in routes:
                context.route(pattern, handler)
            page = context.new_page()
            page.set_default_timeout(15000)
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
            page.on("console", lambda message: errors.append(f"console: {message.text}") if message.type == "error" else None)
            page.on("requestfailed", lambda request: errors.append(f"requestfailed: {request.url}: {request.failure}"))
            page.goto(self.origin + "/lightsout/atomic/", wait_until="networkidle")
            yield page, context, errors
            require(not errors, "unexpected browser errors: " + " | ".join(errors))
        finally:
            context.close()

    def case(self, label: str, test) -> None:
        self.cases += 1
        try:
            test()
            self.passed.append(label)
            print(f"PASS {label}", flush=True)
        except Exception:
            detail = f"FAIL {label}\n{traceback.format_exc()}"
            self.failures.append(detail)
            print(detail, flush=True)

    def initial_layout(self, width: int) -> None:
        with self.page(width) as (page, _context, _errors):
            report = accepted(page)
            require(report["level"] == 0 and report["won"] is True, "initial guided design was not really accepted")
            require(report["totals"]["annihilated"] == 256, "unexpected first-mission guided result")
            require(page.locator("#design-state").inner_text() == "GUIDED DESIGN", "first run is not identified as guided")
            require(page.locator("#mission-tabs button").count() == 4, "missing missions")
            require(page.locator("#lattice-grid button").count() == 16, "missing editable cells")
            require(page.locator("#module-palette button").count() == 5, "missing modules")
            require(page.locator("h1").count() == 1, "page must have one primary heading")
            overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            require(overflow == 0, f"viewport {width}px has {overflow}px horizontal overflow")
            clipped = page.evaluate("""() => [...document.querySelectorAll('.brand, .back-link, h1, #mission-tabs button, #lattice-grid button, #module-palette button, #execute, #export-receipt, #receipt-hash')]
                .filter(node => {const r = node.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1);})
                .map(node => node.id || node.textContent.trim())""")
            require(not clipped, f"clipped interactive/content elements at {width}px: {clipped}")
            fragments = page.evaluate("""() => [...document.querySelectorAll('a[href^="#"]')]
                .map(a => a.getAttribute('href').slice(1)).filter(id => !document.getElementById(id))""")
            require(not fragments, f"broken fragment links: {fragments}")
            require(page.locator("#motion-toggle").get_attribute("aria-pressed") == "true", "reduced motion did not pause the visual")
            page.keyboard.press("Tab")
            require(page.locator(".skip-link").evaluate("node => node === document.activeElement"), "first keyboard stop is not the skip link")
            page.keyboard.press("Enter")
            require(page.locator("#reactor").evaluate("node => node === document.activeElement"), "skip link does not focus reactor")
            if width in (390, 1440):
                page.evaluate("scrollTo(0, 0)")
                page.screenshot(path=str(self.output / f"atomic-{width}.png"), full_page=True, animations="disabled")
                page.screenshot(path=str(self.output / f"atomic-hero-{width}.png"), animations="disabled")

    def missions(self) -> None:
        with self.page() as (page, _context, _errors):
            accepted(page)
            for level, n in enumerate((8, 16, 24, 32)):
                if level:
                    page.locator(f'[data-level="{level}"]').click()
                else:
                    page.locator("#reset-design").click()
                no_acceptance(page)
                require(page.locator("#design-state").inner_text() == "OPEN CHALLENGE", "mission did not start mixed")
                lost = run_again(page)
                require(lost["level"] == level and lost["n"] == n and lost["won"] is False, "default puzzle is not an exact unsolved challenge")
                require(page.locator("#proof-title").inner_text() == "Exact. Not contained.", "exact loss confused with integrity failure")
                page.locator("#demo-design").click()
                no_acceptance(page)
                won = run_again(page)
                require(won["level"] == level and won["won"] is True, "guided mission failed its own objectives")
                require(all(objective["passed"] for objective in won["objectives"]), "mission awarded with failed objective")
                require(page.locator("#objectives li.pass").count() == 4, "accepted objectives not displayed")
                require(page.locator(f'[data-level="{level}"] .mission-check').inner_text() == "✓", "completed mission has no check mark")
            require(page.locator("#next-mission").is_hidden(), "last mission incorrectly offers a next mission")

    def editing_and_keys(self) -> None:
        with self.page() as (page, _context, _errors):
            initial = accepted(page)
            for key in range(1, 6):
                page.keyboard.press(str(key))
                require(page.locator(f'[data-module="{key-1}"]').get_attribute("aria-pressed") == "true", f"key {key} did not select module")
                require(page.locator('#module-palette [aria-pressed="true"]').count() == 1, "multiple selected modules")
            page.keyboard.press("1")
            page.locator('[data-cell="0"]').click()
            no_acceptance(page)
            require("Raw" in page.locator('[data-cell="0"]').get_attribute("aria-label"), "keyboard-selected module was not placed")
            page.locator("#undo").click()
            no_acceptance(page)
            restored = run_again(page)
            require(restored["capsule"] == initial["capsule"], "undo plus real replay changed the capsule identity")
            page.locator("#reset-design").click()
            no_acceptance(page)

    def keyboard_dialog_motion(self) -> None:
        with self.page(390) as (page, _context, _errors):
            accepted(page)
            page.locator("#how-to-play").click()
            require(page.locator("#instructions").evaluate("node => node.open"), "instructions did not open")
            selected = page.locator('#module-palette [aria-pressed="true"]').get_attribute("data-module")
            page.keyboard.press("5")
            require(page.locator('#module-palette [aria-pressed="true"]').get_attribute("data-module") == selected, "dialog keyboard shortcut edited background selection")
            for _ in range(5):
                page.keyboard.press("Tab")
                # Chromium exposes BODY while native modal focus cycles through
                # browser chrome. No background page control may become active;
                # the next document focus must return inside the native dialog.
                if page.evaluate("document.activeElement === document.body"):
                    page.keyboard.press("Tab")
                require(page.locator("#instructions").evaluate("node => node.contains(document.activeElement)"), "modal focus reached a background page control")
            page.keyboard.press("Escape")
            require(not page.locator("#instructions").evaluate("node => node.open"), "Escape did not dismiss instructions")
            require(page.locator("#how-to-play").evaluate("node => node === document.activeElement"), "dialog did not restore keyboard focus")
            page.locator("#how-to-play").click()
            page.locator("#start-playing").click()
            require(page.locator("#reactor").evaluate("node => node === document.activeElement"), "start-playing did not focus controls")
            page.locator("#motion-toggle").click()
            require(page.locator("#motion-toggle").get_attribute("aria-pressed") == "false", "motion toggle cannot resume")
            page.locator("#motion-toggle").click()
            require(page.locator("#motion-toggle").get_attribute("aria-pressed") == "true", "motion toggle cannot pause")

    def export_import(self) -> None:
        with self.page() as (page, _context, _errors):
            report = accepted(page)
            with page.expect_download() as download_event:
                page.locator("#export-receipt").click()
            download = download_event.value
            path = self.output / download.suggested_filename
            download.save_as(path)
            capsule = json.loads(path.read_text())
            require(capsule == report["capsule"], "download bytes do not contain the real accepted capsule")
            require(download.suggested_filename == f'atomic-roc-{capsule["sha256"][:16]}.json', "download name is not bound to the content identity")
            require(rehash_capsule(capsule) == capsule, "download content identity is invalid")
            page.locator("#reset-design").click()
            run_again(page)
            previous = result_count(page)
            page.locator("#capsule-file").set_input_files(path)
            replay = accepted(page, previous)
            require(replay["capsule"] == capsule, "import did not independently reproduce exported identity")
            require(page.evaluate("__atomicBrowserTest.requests.at(-1).type") == "replay", "import did not request real replay")

    def forged_capsules(self) -> None:
        with self.page() as (page, _context, _errors):
            report = accepted(page)
            original = report["capsule"]
            for rehashed in (False, True):
                forged = dict(original)
                forged["outputDigest"] = ("0" if original["outputDigest"][0] != "0" else "1") + original["outputDigest"][1:]
                if rehashed:
                    forged = rehash_capsule(forged)
                before = result_count(page)
                page.locator("#capsule-file").set_input_files(file_payload(forged))
                wait_failed(page)
                require(result_count(page) == before, "forged capsule emitted an accepted result")
                error = page.evaluate("__atomicBrowserTest.messages.filter(m => m.type === 'error').at(-1)")
                require(error is not None and error["error"]["code"] in ("CAPSULE_INTEGRITY", "REPLAY_INTEGRITY"), "forgery did not reach an integrity check")
                replay = run_again(page, "#hero-run")
                require(replay["capsule"] == original, "hero Retry did not execute a fresh valid run")

    def invalid_file(self, oversized: bool) -> None:
        with self.page() as (page, _context, _errors):
            accepted(page)
            count = result_count(page)
            payload = b" " * 8193 if oversized else b'{"schema":'
            page.locator("#capsule-file").set_input_files({"name": "invalid.json", "mimeType": "application/json", "buffer": payload})
            page.wait_for_selector("#run-message.error")
            no_acceptance(page, failed=True)
            require(result_count(page) == count, "invalid local file generated an accepted result")
            run_again(page, "#hero-run")

    def nondefault_seed_undo(self) -> None:
        with self.page() as (page, _context, _errors):
            initial = accepted(page)
            capsule = page.evaluate("""request => new Promise((resolve, reject) => {
                const worker = new Worker('./simulation-worker.mjs', {type:'module'});
                const deadline = setTimeout(() => {worker.terminate(); reject(new Error('fixture worker timed out'));}, 10000);
                worker.onmessage = event => {
                  if (event.data.type === 'result') {clearTimeout(deadline); worker.terminate(); resolve(event.data.report.capsule);}
                  if (event.data.type === 'error') {clearTimeout(deadline); worker.terminate(); reject(new Error(event.data.error.message));}
                };
                worker.onerror = event => {clearTimeout(deadline); worker.terminate(); reject(new Error(event.message));};
                worker.postMessage(request);
            })""", {"id": 123, "type": "run", "level": 0, "seed": 0xFEDCBA98, "board": initial["board"]})
            before = result_count(page)
            page.locator("#capsule-file").set_input_files(file_payload(capsule))
            imported = accepted(page, before)
            require(imported["seed"] == 0xFEDCBA98, "custom seed was truncated or ignored")
            page.locator("#reset-design").click()
            page.locator("#undo").click()
            no_acceptance(page)
            restored = run_again(page)
            require(restored["capsule"] == capsule, "preset/undo failed to restore imported full-width seed")

    def delayed_import(self, invalid: bool) -> None:
        with self.page() as (page, _context, _errors):
            report = accepted(page)
            page.evaluate("""() => {
                const nativeText = File.prototype.text;
                window.__releaseAtomicFile = null;
                File.prototype.text = function() {
                  const file = this;
                  if (file.name !== 'delayed.json') return nativeText.call(file);
                  return new Promise((resolve, reject) => {
                    window.__releaseAtomicFile = () => nativeText.call(file).then(resolve, reject);
                  });
                };
            }""")
            value = {"name": "delayed.json", "mimeType": "application/json", "buffer": b"{"} if invalid else file_payload(report["capsule"], "delayed.json")
            page.locator("#capsule-file").set_input_files(value)
            wait_js(page, "typeof __releaseAtomicFile === 'function'")
            page.keyboard.press("1")
            page.locator('[data-cell="0"]').click()
            no_acceptance(page)
            message = page.locator("#run-message").inner_text()
            before = request_count(page)
            page.evaluate("async () => {await __releaseAtomicFile(); await new Promise(resolve => setTimeout(resolve, 30));}")
            require(request_count(page) == before, "stale asynchronous import started a worker request after an edit")
            require(page.locator("#run-message").inner_text() == message, "stale asynchronous import overwrote newer edit status")
            no_acceptance(page)
            fresh = run_again(page)
            require(fresh["board"][0] == 0, "stale import replaced the edited board")

    def over_budget(self) -> None:
        with self.page() as (page, _context, _errors):
            accepted(page)
            page.locator('[data-level="3"]').click()
            page.keyboard.press("4")
            for index in range(16):
                page.locator(f'[data-cell="{index}"]').click()
            require(page.locator("#budget-track.over").count() == 1, "over-budget design not marked")
            require(page.locator("#matter-cost").inner_text() == "48", "Void board cost is wrong")
            report = run_again(page)
            require(report["cost"] == 48 and report["budget"] == 32, "wrong budget accounting")
            require(report["won"] is False and report["verified"] is True, "over-budget exact execution awarded a win")
            require(next(o for o in report["objectives"] if o["id"] == "budget")["passed"] is False, "budget objective incorrectly passed")
            require(page.locator('[data-level="3"] .mission-check').inner_text() == "", "over-budget run unlocked the mission")

    def corrupt_wasm(self) -> None:
        hits: list[str] = []
        def corrupt(route) -> None:
            response = route.fetch()
            body = bytearray(response.body())
            require(len(body) > 8, "WASM corruption fixture did not intercept a binary")
            body[-1] ^= 1
            hits.append(route.request.url)
            route.fulfill(response=response, body=bytes(body))
        pattern = "**/lightsout/atomic/qqfenx.wasm"
        with self.page(routes=((pattern, corrupt),)) as (page, context, _errors):
            wait_failed(page)
            require(len(hits) == 1, "WASM corruption route was not exercised exactly once")
            require(result_count(page) == 0, "corrupted binary generated an accepted report")
            require(page.evaluate("__atomicBrowserTest.messages.filter(m => m.type === 'error').at(-1).error.code") == "ENGINE_INTEGRITY", "bad binary was not rejected at the integrity gate")
            context.unroute(pattern)
            report = run_again(page, "#hero-run")
            require(report["won"] is True, "retry after binary correction failed")

    def timeout_retry(self) -> None:
        with self.page(fault=TIMEOUT_FAULT) as (page, _context, _errors):
            wait_failed(page)
            require("20-second browser deadline" in page.locator("#run-message").inner_text(), "held request did not reach the deadline branch")
            require(page.evaluate("__atomicBrowserTest.terminated") == 1, "timeout did not terminate its worker")
            require(result_count(page) == 0, "held request somehow published acceptance")
            report = run_again(page, "#hero-run")
            require(report["won"] is True, "fresh worker retry did not complete")
            require(page.evaluate("__atomicBrowserTest.created") == 2, "timeout retry reused terminated worker")

    def renderer_unavailable(self) -> None:
        hits: list[str] = []
        def unavailable(route) -> None:
            hits.append(route.request.url)
            # Delivered JavaScript rejects during evaluation, with no network
            # error. The controller's optional-renderer catch must contain it.
            route.fulfill(status=200, content_type="text/javascript", body="throw new Error('Test-only unavailable visual renderer');")
        with self.page(routes=(("**/lightsout/atomic/world.mjs", unavailable),)) as (page, _context, _errors):
            require(accepted(page)["won"] is True, "visual failure blocked arithmetic")
            require(len(hits) == 1, "optional renderer fault was not exercised")
            page.locator("#reset-design").click()
            require(run_again(page)["won"] is False, "accessible editor failed without visual renderer")

    def no_javascript(self) -> None:
        with self.page(320, javascript=False) as (page, _context, _errors):
            require(page.locator(".noscript").is_visible(), "no-JavaScript explanation missing")
            require(page.locator('.noscript a[href="/lightsout/"]').is_visible(), "no-JavaScript product link unavailable")
            require(page.locator('a[href="/lightsout/commercial-licensing.html"]').is_visible(), "no-JavaScript commercial link unavailable")
            require(page.locator("#hero-run").is_disabled() and page.locator("#execute").is_disabled(), "no-JavaScript execution controls falsely active")
            require(page.locator("#export-receipt").is_disabled(), "no-JavaScript receipt falsely available")
            require(page.locator("#proof-light.pass").count() == 0, "static document fabricates acceptance")
            require(page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") == 0, "no-JavaScript mobile overflow")

    def run(self) -> int:
        for width in (320, 390, 768, 1440):
            self.case(f"initial guided replay and layout {width}px", lambda width=width: self.initial_layout(width))
        self.case("four real missions: mixed loss then guided win", self.missions)
        self.case("keyboard modules, edit invalidation, undo identity", self.editing_and_keys)
        self.case("modal keyboard focus and reduced motion", self.keyboard_dialog_motion)
        self.case("actual download and imported re-execution", self.export_import)
        self.case("forged and rehashed-forged capsules; hero retry", self.forged_capsules)
        self.case("oversized import clears previous acceptance", lambda: self.invalid_file(True))
        self.case("malformed JSON clears previous acceptance", lambda: self.invalid_file(False))
        self.case("imported high-bit seed survives preset and undo", self.nondefault_seed_undo)
        self.case("delayed valid import cannot overwrite later edit", lambda: self.delayed_import(False))
        self.case("delayed invalid import cannot overwrite later edit", lambda: self.delayed_import(True))
        self.case("over-budget Void design does not unlock mission", self.over_budget)
        self.case("corrupt WASM is rejected; fresh retry succeeds", self.corrupt_wasm)
        self.case("held request deadline terminates worker; fresh retry", self.timeout_retry)
        self.case("optional visual renderer failure leaves exact game playable", self.renderer_unavailable)
        self.case("no-JavaScript links and withheld acceptance", self.no_javascript)
        print(f"Atomic browser suite: {len(self.passed)}/{self.cases} cases passed; screenshots/downloads: {self.output}", flush=True)
        return 1 if self.failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="local public payload root")
    parser.add_argument("--chromium", help="optional installed Chromium executable")
    parser.add_argument("--base-url", help="test a live site origin instead of a local ephemeral server")
    parser.add_argument("--output-dir", type=Path, help="screenshots/download directory; defaults to a fresh /var/tmp directory")
    args = parser.parse_args()
    root = args.root.resolve()
    if not (root / "lightsout/atomic/index.html").is_file():
        parser.error("--root must contain lightsout/atomic/index.html")
    output = args.output_dir.resolve() if args.output_dir else Path(tempfile.mkdtemp(prefix="mfenx-atomic-browser-", dir="/var/tmp"))
    output.mkdir(parents=True, exist_ok=True)
    server = None
    thread = None
    if args.base_url:
        parsed = urlparse(args.base_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username or parsed.password:
            parser.error("--base-url must be a plain HTTP(S) origin without credentials, query, or path")
        origin = args.base_url.rstrip("/")
    else:
        handler = functools.partial(QuietHandler, directory=str(root))
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.chromium, headless=True, args=["--no-sandbox"])
            try:
                return Suite(browser, origin, output).run()
            finally:
                browser.close()
    finally:
        if server:
            server.shutdown()
            server.server_close()
        if thread:
            thread.join(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
