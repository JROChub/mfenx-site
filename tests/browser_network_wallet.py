#!/usr/bin/env python3
"""Exercise wallet discovery, approval boundaries, and responsive setup locally."""
import argparse
import functools
import http.server
import json
from pathlib import Path
import threading

from playwright.sync_api import sync_playwright, expect
from browser_site_design import QuietHandler


def run(root, chromium):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(root.resolve())))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    metadata = json.loads((root / "network/2026092601.json").read_text())
    failures = []
    calls = []
    mode = "valid"

    def route_request(route):
        request = route.request
        if request.url.startswith(origin + "/"):
            route.continue_()
        elif request.url in metadata["rpc"] and request.method == "POST":
            calls.append(json.loads(request.post_data))
            chain = "0x1" if mode == "wrong" else hex(metadata["chainId"])
            route.fulfill(content_type="application/json", body=json.dumps([
                {"jsonrpc": "2.0", "id": 1, "result": chain},
                {"jsonrpc": "2.0", "id": 2, "result": {"number": "0x0", "hash": metadata["genesisHash"]}},
                {"jsonrpc": "2.0", "id": 3, "result": False},
            ]))
        else:
            route.fulfill(status=503, content_type="application/json", body="{}")

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium, headless=True)
            context = browser.new_context()
            context.route("**/*", route_request)
            context.add_init_script("""
                window.walletCalls = [];
                const provider = {request: async request => {
                    walletCalls.push(request);
                    if (window.rejectWallet) throw {code: 4001};
                    return '0x78c3b839';
                }};
                window.addEventListener('eip6963:requestProvider', () => {
                    const detail = {info:{name:'Test wallet',uuid:'test-wallet'},provider};
                    dispatchEvent(new CustomEvent('eip6963:announceProvider', {detail}));
                    dispatchEvent(new CustomEvent('eip6963:announceProvider', {detail}));
                });
            """)
            for width in (320, 390, 768, 1440):
                page = context.new_page()
                page.set_viewport_size({"width": width, "height": 1000})
                page.on("pageerror", lambda error: failures.append(str(error)))
                page.goto(origin + "/status.html", wait_until="networkidle")
                assert page.evaluate("walletCalls.length") == 0
                expect(page.locator("#network-wallet option")).to_have_count(1)
                expect(page.locator("#network-wallet option")).to_have_text("Test wallet")
                assert page.locator(".network-logo").evaluate("img => img.complete && img.naturalWidth === 1024")
                page.get_by_text("Manual network setup", exact=True).click()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
                page.locator("#add-network").click()
                expect(page.locator("#wallet-result")).to_contain_text("Your wallet is connected")
                assert [c["method"] for c in page.evaluate("walletCalls")] == ["wallet_addEthereumChain", "wallet_switchEthereumChain", "eth_chainId"]
                page.close()
            page = context.new_page()
            page.goto(origin + "/status.html")
            page.evaluate("window.rejectWallet = true")
            page.locator("#add-network").click()
            expect(page.locator("#wallet-result")).to_contain_text("declined")
            assert len(page.evaluate("walletCalls")) == 1
            mode = "wrong"
            page.reload()
            page.locator("#add-network").click()
            expect(page.locator("#wallet-result")).to_contain_text("setup was stopped")
            assert page.evaluate("walletCalls.length") == 0
            assert not failures, failures
            assert all([c["method"] for c in batch] == ["eth_chainId", "eth_getBlockByNumber", "eth_syncing"] for batch in calls)
            browser.close()
            print("PASS wallet discovery, no automatic approvals, identity rejection, user rejection, logo, and mobile layout")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("public"))
    parser.add_argument("--chromium")
    args = parser.parse_args()
    run(args.root, args.chromium)
