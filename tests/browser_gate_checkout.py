#!/usr/bin/env python3
"""Checkout boundary tests. Provider doubles do not claim a real Paddle payment."""
import argparse
import copy
import functools
import http.server
import json
from pathlib import Path
import threading

from playwright.sync_api import expect, sync_playwright


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def run(root, chromium):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    org = "11111111-1111-4111-8111-111111111111"
    session = {"authenticated": True, "expires_at": 1999999999, "account": {"organizations": [{"id": org, "name": "<img src=x onerror=alert(1)>", "role": "owner"}]}}
    checkout = {"plan": "team", "transaction_id": "txn_" + "a" * 26, "environment": "sandbox", "client_token": "test_" + "b" * 27, "entitlement_granted": False}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=chromium, headless=True)
            context = browser.new_context()
            page = context.new_page()
            state = {"session": session, "checkout": checkout, "api_status": 200, "revoke_during_sdk": False}
            external, errors = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: external.append(request.url) if not request.url.startswith(origin + "/") else None)
            context.route("**/auth/session", lambda route: route.fulfill(status=state["api_status"], content_type="application/json", body=json.dumps(state["session"])))
            context.route("**/v1/orgs/*/billing/checkout", lambda route: route.fulfill(content_type="application/json", body=json.dumps(state["checkout"])))
            def provider(route):
                if state["revoke_during_sdk"]:
                    state["session"] = {"authenticated": False}
                route.fulfill(content_type="application/javascript", body="""
                window.calls = [];
                window.Paddle = {
                  Environment: {set: value => window.calls.push(['environment',value])},
                  Initialize: value => {window.paddleCallback=value.eventCallback; window.calls.push(['initialize',value.token]);},
                  Checkout: {open: value => {window.calls.push(['open',value]); document.documentElement.dataset.paddleOpenCount = String(window.calls.filter(x=>x[0]==='open').length);}}
                };
                """)
            context.route("https://cdn.paddle.com/paddle/v2/paddle.js", provider)
            url = origin + "/gate/checkout/?org=" + org
            for width in (320, 390, 768, 1440):
                page.set_viewport_size({"width": width, "height": 1000})
                page.goto(url)
                expect(page.locator("#checkout-open")).to_be_enabled()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
                page.keyboard.press("Tab")
                expect(page.locator(".skip-link")).to_be_focused()
            assert not external, external
            expect(page.locator("#checkout-organization")).to_have_text(session["account"]["organizations"][0]["name"])
            expect(page.locator("#checkout-organization img")).to_have_count(0)
            expect(page.locator("#checkout-environment")).to_contain_text("no real payment")
            page.locator("#checkout-open").click()
            expect(page.locator("html")).to_have_attribute("data-paddle-open-count", "1")
            calls = page.evaluate("window.calls")
            assert calls[0] == ["environment", "sandbox"]
            assert calls[-1][1]["transactionId"] == checkout["transaction_id"]
            assert calls[-1][1]["settings"]["allowLogout"] is False
            assert calls[-1][1]["settings"]["showAddDiscounts"] is False
            assert external == ["https://cdn.paddle.com/paddle/v2/paddle.js"]
            page.evaluate("window.paddleCallback({name:'checkout.closed'})")
            expect(page.locator("#checkout-open")).to_be_enabled()
            page.locator("#checkout-open").click()
            expect(page.locator("html")).to_have_attribute("data-paddle-open-count", "2")
            page.evaluate("window.paddleCallback(null); window.paddleCallback({}); window.paddleCallback({name:'checkout.completed',data:{transaction_id:'txn_wrong'}})")
            assert page.url == url
            page.evaluate("id => window.paddleCallback({name:'checkout.completed',data:{transaction_id:id}})", checkout["transaction_id"])
            page.wait_for_url("**/gate/account/?org=" + org + "&checkout=returned")
            assert "active" not in page.url
            external.clear()

            invalid_cases = [
                ({**checkout, "environment": "live"}, "authentication does not match"),
                ({**checkout, "plan": "enterprise"}, "unsupported checkout"),
                ({**checkout, "entitlement_granted": True}, "unsupported checkout"),
                ({**checkout, "transaction_id": "https://attacker.invalid"}, "unsupported checkout"),
                ({**checkout, "expires_at": 1}, "expired"),
                ({"checkout": None}, "No pending checkout"),
            ]
            for payload, reason in invalid_cases:
                state["checkout"] = payload
                page.goto(url)
                expect(page.locator("#checkout-status")).to_contain_text(reason)
                expect(page.locator("#checkout-review")).to_be_hidden()
            state["checkout"] = checkout

            # Opening is a fresh authorization decision, not a reuse of the
            # session/transaction observed when this tab was first loaded.
            page.goto(url)
            expect(page.locator("#checkout-open")).to_be_enabled()
            state["session"] = {"authenticated": False}
            page.locator("#checkout-open").click()
            expect(page.locator("#checkout-status")).to_contain_text("Sign in")
            expect(page.locator("#checkout-open")).to_be_disabled()
            assert not external
            state["session"] = session
            page.goto(url)
            expect(page.locator("#checkout-open")).to_be_enabled()
            state["checkout"] = {**checkout, "transaction_id": "txn_" + "c" * 26}
            page.locator("#checkout-open").click()
            expect(page.locator("#checkout-status")).to_contain_text("checkout changed")
            expect(page.locator("#checkout-open")).to_be_disabled()
            assert not external
            state["checkout"] = checkout
            state["session"] = {**session, "expires_at": 1}
            page.goto(url)
            expect(page.locator("#checkout-status")).to_contain_text("session has expired")
            assert not external
            state["session"] = session
            page.goto(url)
            expect(page.locator("#checkout-open")).to_be_enabled()
            state["revoke_during_sdk"] = True
            page.locator("#checkout-open").click()
            expect(page.locator("#checkout-status")).to_contain_text("Sign in")
            expect(page.locator("#checkout-open")).to_be_disabled()
            assert page.evaluate("window.calls") == []
            state["revoke_during_sdk"] = False
            state["session"] = session
            external.clear()

            state["checkout"] = {**checkout, "padding": "x" * 65537}
            page.goto(url)
            expect(page.locator("#checkout-status")).to_contain_text("exceeded the supported size")
            expect(page.locator("#checkout-open")).to_be_disabled()
            state["checkout"] = checkout
            page.goto(url + "&_ptxn=txn_" + "c" * 26)
            expect(page.locator("#checkout-status")).to_contain_text("does not match")
            page.goto(url + "&org=" + org)
            expect(page.locator("#checkout-status")).to_contain_text("Choose a subscription")
            state["session"] = copy.deepcopy(session)
            state["session"]["account"]["organizations"][0]["role"] = "member"
            page.goto(url)
            expect(page.locator("#checkout-status")).to_contain_text("organization owner")
            state["session"] = {"authenticated": False}
            page.goto(url)
            expect(page.locator("#checkout-status")).to_contain_text("Sign in")
            state["api_status"] = 503
            page.goto(url)
            expect(page.locator("#checkout-status")).to_contain_text("could not confirm")
            assert not external, external
            assert page.evaluate("localStorage.length === 0 && sessionStorage.length === 0")
            assert not errors, errors
            browser.close()
            print("Checkout browser boundary: PASS (4 widths, owned transaction, fresh authorization before/after SDK, session expiry, changed transaction, bounded responses, transaction-bound provider events, explicit provider load, invalid input, no browser entitlement or storage; mocked Paddle)")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("public"))
    parser.add_argument("--chromium")
    args = parser.parse_args()
    run(args.root.resolve(), args.chromium)
