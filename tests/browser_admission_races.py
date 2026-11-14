"""Observe stale package verification and inference completions in Chromium."""
import argparse
import functools
import http.server
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--chromium", help="optional Chromium executable; defaults to Playwright's managed browser")
    parser.add_argument("--route", default="/ckodmk/")
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(args.root.resolve())))
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=args.chromium, args=["--no-sandbox"])
            context = browser.new_context(service_workers="block")
            origin = f"http://127.0.0.1:{server.server_port}"
            page = context.new_page()
            page.goto(origin+args.route, wait_until="networkidle")
            page.evaluate("""() => {
              const original = crypto.subtle.verify.bind(crypto.subtle);
              crypto.subtle.verify = async (...args) => {
                window.pendingVerification = true;
                await new Promise(resolve => window.releaseVerification = resolve);
                return original(...args);
              };
            }""")
            page.locator("#verify-included-pcm").click()
            page.wait_for_function("() => window.pendingVerification === true")
            page.locator("#pcm-trusted-key").set_input_files({"name": "replacement.der", "mimeType": "application/octet-stream", "buffer": b"wrong-key"})
            page.evaluate("window.releaseVerification()")
            page.wait_for_function("() => !document.querySelector('#verify-included-pcm').disabled")
            assert page.locator("#download-admitted-model").is_disabled()
            assert page.locator("#pcm-decision").inner_text() != "ADMITTED"
            page.close()

            page = context.new_page()
            page.goto(origin+args.route, wait_until="networkidle")
            page.evaluate("""() => {
              const original = ort.InferenceSession.create.bind(ort.InferenceSession);
              let first = true;
              ort.InferenceSession.create = async (...args) => {
                if (first) { first = false; window.pendingReplay = true;
                  await new Promise(resolve => window.releaseReplay = resolve); }
                return original(...args);
              };
            }""")
            page.locator("#verify-included-pcm").click()
            page.wait_for_function("() => window.pendingReplay === true", timeout=60000)
            page.locator("#gate-candidate").set_input_files({"name": "replacement.onnx", "mimeType": "application/octet-stream", "buffer": b"changed-model"})
            page.evaluate("window.releaseReplay()")
            page.wait_for_function("() => !document.querySelector('#verify-included-pcm').disabled", timeout=120000)
            assert page.locator("#download-admitted-model").is_disabled()
            assert page.locator("#download-report").is_disabled()
            assert page.locator("#pcm-decision").inner_text() != "ADMITTED"
            assert page.locator("#gate-decision").inner_text() != "PASS"
            page.close()

            page = context.new_page()
            page.goto(origin+args.route, wait_until="networkidle")
            page.locator("#verify-included-pcm").click()
            page.wait_for_function("() => document.querySelector('#pcm-decision').textContent === 'ADMITTED'", timeout=120000)
            assert page.locator("#download-admitted-model").is_enabled()
            page.evaluate("""() => {
              const original = ort.InferenceSession.create.bind(ort.InferenceSession);
              let first = true;
              ort.InferenceSession.create = async (...args) => {
                if (first) { first = false; window.pendingTiming = true;
                  await new Promise(resolve => window.releaseTiming = resolve); }
                return original(...args);
              };
            }""")
            page.locator("#run-phone-study").click()
            page.wait_for_function("() => window.pendingTiming === true", timeout=60000)
            page.locator("#gate-contract-digest").fill("sha256:"+"0"*64)
            page.evaluate("window.releaseTiming()")
            page.wait_for_function("() => document.querySelector('#cancel-phone-study').disabled", timeout=60000)
            assert page.locator("#download-phone-study").is_disabled()
            assert page.locator("#run-phone-study").is_disabled()
            assert page.locator("#download-admitted-model").is_disabled()
            assert page.locator("#download-report").is_disabled()
            assert page.locator("#pcm-decision").inner_text() != "ADMITTED"
            browser.close()
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)
    print("PASS: changed issuer during signature verification; changed candidate during actual replay; changed contract after admission and during timing")


if __name__ == "__main__": main()
