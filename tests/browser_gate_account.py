#!/usr/bin/env python3
"""Browser account acceptance. API doubles test the UI, not payment settlement."""
from __future__ import annotations

import argparse
import base64
import functools
import http.server
import json
from pathlib import Path
import threading
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


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
    malicious = '<img src=x onerror="window.injected=true">'
    key_id = "sha256:" + "a" * 64
    contract = "sha256:" + "b" * 64
    policy = {
        "evaluation_contract_sha256": contract,
        "allowed_issuer_key_ids": [key_id],
        "allowed_formats": ["onnx"],
        "allowed_parent_sha256": [],
        "require_artifact_binding": True,
        "require_behavioral_replay": True,
        "max_accuracy_loss_ppm": 2000,
        "max_decision_changes_ppm": 1000,
    }
    state = {
        "authenticated": True,
        "organizations": [
            {"id": "org-a", "name": malicious, "role": "owner"},
            {"id": "org-b", "name": "Second organization", "role": "member"},
        ],
        "tokens": [],
        "keys": [{"key_id": key_id, "created": 1770000000, "revoked": False}],
        "version": 1,
        "billing": True,
        "expires_at": 1999999999,
        "login_configured": True,
        "portal": "https://customer-portal.paddle.com/portal/example",
        "plans": {},
        "refresh_status": 200,
    }
    requests = []

    def api(route):
        request = route.request
        path = urlsplit(request.url).path
        body = request.post_data_json if request.post_data else None
        method = request.method
        requests.append((method, path, body, request.headers))
        status = 200
        data = {}
        account = {"user_id": "user-a", "organizations": state["organizations"]}
        if path == "/v1/session":
            data = {"authenticated": state["authenticated"], "login_configured": state["login_configured"], "login_url": "/auth/login", "csrf_token": "browser-csrf-value", "email": malicious + "@example.test", "expires_at": state["expires_at"], "account": account}
        elif path == "/auth/logout":
            state["authenticated"] = False
            data = {"logged_out": True}
        elif path == "/v1/account" and method == "GET":
            data = account
        elif path in {"/v1/account", "/v1/orgs"}:
            org = {"id": "org-new", "name": body["organization_name"], "role": "owner"}
            state["organizations"].append(org)
            data = {"id": "org-new"}
        elif path.endswith("/usage"):
            plan = state["plans"].get(path.split("/")[3], "developer")
            data = {"month_utc": "2026-09", "plan": plan, "managed_registrations": 2, "allowance": 500 if plan == "developer" else 100000, "overage_billing": False, "billing_state": "inactive" if plan == "developer" else "active", "billing_configured": state["billing"]}
        elif path.endswith("/tokens"):
            if method == "POST":
                token = {"id": f"token-{len(state['tokens'])}", "scopes": body["scopes"], "expires": 1999999999, "revoked": False}
                state["tokens"].append(token)
                data = {**token, "token": "mfg_once_only_" + str(len(state["tokens"]))}
            else:
                data = {"tokens": state["tokens"] if "/org-a/" in path else []}
        elif "/tokens/" in path and method == "DELETE":
            for item in state["tokens"]:
                if path.endswith(item["id"]):
                    item["revoked"] = True
            data = {"revoked": True}
        elif path.endswith("/issuer-keys"):
            data = {"keys": state["keys"]} if method == "GET" else {"key_id": key_id, "registered": True}
        elif "/issuer-keys/" in path and method == "DELETE":
            state["keys"][0]["revoked"] = True
            data = {"revoked": True}
        elif path.endswith("/policies/current") or path.endswith("/policies"):
            if method == "POST":
                policy.update(body)
                state["version"] += 1
            data = {"version": state["version"], "sha256": "sha256:" + "c" * 64, "policy": policy}
        elif path.endswith("/receipts"):
            data = {"receipts": [{"receipt_sha256": "sha256:" + "d" * 64, "created": 1770000000, "policy_version": 1, "attestation_status": "ATTESTATION_VERIFIED", "artifact_status": "NOT_CHECKED", "replay_status": "NOT_PERFORMED"}], "next_before": None}
        elif path.endswith("/billing/checkout"):
            data = {"url": origin + "/gate/checkout/", "transaction_id": "txn_" + "a" * 26, "entitlement_granted": False}
        elif path.endswith("/billing/portal"):
            data = {"url": state["portal"]}
        elif path.endswith("/billing/refresh"):
            if state["refresh_status"] == 200:
                state["plans"][path.split("/")[3]] = "private"
                data = {"plan": "private", "billing_state": "active", "paid_until": 1999999999}
            else:
                status, data = state["refresh_status"], {"detail": "Subscription confirmation unavailable"}
        elif path.endswith("/entitlements/offline"):
            status, data = 403, {"detail": "An active Private subscription is required"}
        else:
            status, data = 404, {"detail": "Unknown test endpoint"}
        if method != "GET":
            assert request.headers.get("x-csrf-token") == "browser-csrf-value", (path, request.headers)
            assert "authorization" not in request.headers
        route.fulfill(status=status, content_type="application/json", body=json.dumps(data))

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium, headless=True)
            context = browser.new_context()
            page = context.new_page()
            errors = []
            external = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: external.append(request.url) if not request.url.startswith(origin + "/") else None)

            # On static hosting, no account is fabricated and no payment is offered.
            page.goto(origin + "/gate/account/")
            expect(page.locator("#session-status")).to_contain_text("not available")
            expect(page.locator("#account")).to_be_hidden()
            expect(page.locator("#sign-in")).to_be_hidden()
            expect(page.locator("#retry-session")).to_be_visible()
            context.route("**/v1/**", api)
            context.route("**/auth/logout", api)

            state["authenticated"] = False
            state["login_configured"] = False
            page.locator("#retry-session").click()
            expect(page.locator("#session-status")).to_contain_text("sign-in is not available")
            expect(page.locator("#sign-in")).to_be_hidden()
            state["login_configured"] = True
            page.locator("#retry-session").click()
            expect(page.locator("#sign-in")).to_be_visible()
            expect(page.locator("#sign-in")).to_have_attribute("href", "/auth/login")
            expect(page.locator("#account")).to_be_hidden()
            state["authenticated"] = True
            for width in (320, 390, 768, 1440):
                page.set_viewport_size({"width": width, "height": 1000})
                page.goto(origin + "/gate/account/")
                expect(page.locator("#usage-count")).to_have_text("2 / 500")
                expect(page.locator("#policy-version")).to_contain_text("Version 1")
                expect(page.locator("h1")).to_have_count(1)
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width, page.evaluate("[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>[e.tagName,e.id,e.className,e.getBoundingClientRect().right])"))
                page.keyboard.press("Tab")
                expect(page.locator(".skip-link")).to_be_focused()
                if output and width in (390, 1440):
                    output.mkdir(parents=True, exist_ok=True)
                    page.screenshot(path=str(output / f"account-{width}.png"), full_page=True)
            assert page.evaluate("window.injected") is None
            assert page.locator("#account img").count() == 0
            expect(page.locator("#offline-license")).to_be_disabled()

            # Server-provided roles control the visible instruments; requests still
            # require server-side authorization independently of this interface.
            page.locator("#organization").select_option("org-b")
            expect(page.locator("#organization-role")).to_contain_text("member")
            expect(page.locator("#checkout-form button")).to_be_disabled()
            expect(page.locator("#key-form button")).to_be_disabled()
            expect(page.locator("#policy-form button")).to_be_disabled()
            page.locator("#organization").select_option("org-a")
            expect(page.locator("#checkout-form button")).to_be_enabled()
            expect(page.locator("#receipt-list")).to_contain_text("NOT_PERFORMED")

            page.get_by_role("button", name="Create token", exact=True).click()
            expect(page.locator("#issued-token")).to_be_visible()
            expect(page.locator("#token-value")).to_have_value("mfg_once_only_1")
            assert page.evaluate("Object.keys(localStorage).length + Object.keys(sessionStorage).length") == 0
            assert "mfg_once_only_1" not in page.url
            page.get_by_role("button", name="Dismiss token").click()
            expect(page.locator("#token-value")).to_have_value("")
            expect(page.locator("#issued-token")).to_be_hidden()
            page.get_by_role("button", name="Revoke token", exact=True).click()
            expect(page.locator("#token-list")).to_contain_text("Revoked")

            before = len(requests)
            page.locator("#public-key").fill("-----BEGIN PRIVATE KEY----- secret")
            page.get_by_role("button", name="Register public key", exact=True).click()
            expect(page.locator("#operation-status")).to_contain_text("only a base64")
            assert len(requests) == before
            page.locator("#public-key").fill("AQID")
            page.get_by_role("button", name="Register public key", exact=True).click()
            expect(page.locator("#operation-status")).to_contain_text("No key bytes were sent")
            assert len(requests) == before
            page.locator("#public-key").fill(base64.b64encode((root / "verify/example/issuer-public.der").read_bytes()).decode())
            page.get_by_role("button", name="Register public key", exact=True).click()
            expect(page.locator("#operation-status")).to_contain_text("Public key registered")

            page.locator("#accuracy-limit").fill("1500")
            page.get_by_role("button", name="Publish new version").click()
            expect(page.locator("#policy-version")).to_contain_text("Version 2")
            assert policy["max_accuracy_loss_ppm"] == 1500
            assert policy["require_artifact_binding"] and policy["require_behavioral_replay"]

            # A valid response that finishes after an organization switch must
            # neither display its secret nor modify the new workspace.
            page.evaluate("""() => {
              const original = window.fetch;
              window.fetch = async (...args) => {
                const response = await original(...args);
                if (String(args[0]).endsWith('/org-a/tokens') && args[1]?.method === 'POST') {
                  document.documentElement.dataset.tokenHeld = 'yes';
                  return await new Promise(resolve => {
                    window.releaseOldToken = () => { window.fetch = original; resolve(response); };
                  });
                }
                return response;
              };
            }""")
            page.get_by_role("button", name="Create token", exact=True).click()
            expect(page.locator("html")).to_have_attribute("data-token-held", "yes")
            page.locator("#organization").select_option("org-b")
            page.evaluate("window.releaseOldToken()")
            expect(page.locator("#organization-role")).to_contain_text("member")
            expect(page.locator("#issued-token")).to_be_hidden()
            expect(page.locator("#token-value")).to_have_value("")
            expect(page.get_by_role("button", name="Create token", exact=True)).to_be_enabled()

            page.locator("#organization-name").fill("Release engineering")
            page.get_by_role("button", name="Create organization").click()
            expect(page.locator("#organization")).to_have_value("org-new")
            expect(page.get_by_role("button", name="Create organization")).to_be_enabled()

            # A provider-controlled or compromised arbitrary URL is not followed.
            state["portal"] = "https://attacker.example/steal"
            page.locator("#organization").select_option("org-a")
            expect(page.locator("#billing-portal")).to_be_enabled()
            page.get_by_role("button", name="Manage subscription").click()
            expect(page.locator("#operation-status")).to_contain_text("unapproved payment destination")
            assert external == []

            # A delayed webhook does not require waiting out the usage cache:
            # an explicit owner refresh reconciles first, then reloads usage.
            before = len(requests)
            page.get_by_role("button", name="Refresh status", exact=True).click()
            expect(page.locator("#usage-plan")).to_have_text("private")
            expect(page.locator("#offline-license")).to_be_enabled()
            fresh = requests[before:]
            assert fresh[0][0:3] == ("POST", "/v1/orgs/org-a/billing/refresh", None), fresh
            assert any(method == "GET" and path.endswith("/usage") for method, path, _, _ in fresh)
            state["refresh_status"] = 503
            before = len(requests)
            page.get_by_role("button", name="Refresh status", exact=True).click()
            expect(page.locator("#billing-state")).to_have_text("Not confirmed")
            expect(page.locator("#usage-plan")).to_have_text("Unconfirmed")
            expect(page.locator("#offline-license")).to_be_disabled()
            expect(page.locator("#billing-portal")).to_be_disabled()
            expect(page.locator("#checkout-form button")).to_be_disabled()
            assert not any(path.endswith("/usage") for _, path, _, _ in requests[before:])
            state["refresh_status"] = 200
            page.get_by_role("button", name="Refresh status", exact=True).click()
            expect(page.locator("#usage-plan")).to_have_text("private")
            expect(page.locator("#offline-license")).to_be_enabled()

            # Late refresh completion cannot unlock another organization's UI.
            page.evaluate("""() => {
              const original = window.fetch;
              window.fetch = async (...args) => {
                const response = await original(...args);
                if (String(args[0]).endsWith('/org-a/billing/refresh')) {
                  document.documentElement.dataset.refreshHeld = 'yes';
                  return await new Promise(resolve => {
                    window.releaseOldRefresh = () => { window.fetch = original; resolve(response); };
                  });
                }
                return response;
              };
            }""")
            page.get_by_role("button", name="Refresh status", exact=True).click()
            expect(page.locator("html")).to_have_attribute("data-refresh-held", "yes")
            page.locator("#organization").select_option("org-b")
            page.evaluate("window.releaseOldRefresh()")
            expect(page.locator("#usage-plan")).to_have_text("developer")
            expect(page.locator("#organization-role")).to_contain_text("member")
            expect(page.locator("#offline-license")).to_be_disabled()
            refreshes = sum(path.endswith("/billing/refresh") for _, path, _, _ in requests)
            page.get_by_role("button", name="Refresh status", exact=True).click()
            expect(page.get_by_role("button", name="Refresh status", exact=True)).to_be_enabled()
            assert refreshes == sum(path.endswith("/billing/refresh") for _, path, _, _ in requests)

            # Owner permissions may have changed in another session. A rejected
            # reconciliation reloads actual memberships before exposing controls.
            page.locator("#organization").select_option("org-a")
            expect(page.locator("#checkout-form button")).to_be_enabled()
            state["organizations"][0]["role"] = "member"
            state["refresh_status"] = 403
            page.get_by_role("button", name="Refresh status", exact=True).click()
            expect(page.locator("#organization-role")).to_contain_text("member")
            expect(page.locator("#key-form button")).to_be_disabled()
            expect(page.locator("#offline-license")).to_be_disabled()
            expect(page.locator("#operation-status")).to_contain_text("Organization access changed")
            state["organizations"][0]["role"] = "owner"
            state["refresh_status"] = 200

            # Browser return parameters are informational, never entitlements.
            page.goto(origin + "/gate/account/?org=org-b&checkout=returned&_ptxn=forged")
            expect(page.locator("#organization")).to_have_value("org-b")
            expect(page.locator("#usage-plan")).to_have_text("developer")
            expect(page.locator("#billing-return")).to_be_visible()
            expect(page.locator("#offline-license")).to_be_disabled()
            assert "forged" not in page.url

            page.locator("#organization").select_option("org-a")
            expect(page.locator("#checkout-form button")).to_be_enabled()
            state["refresh_status"] = 401
            page.get_by_role("button", name="Refresh status", exact=True).click()
            expect(page.locator("#session-status")).to_contain_text("session ended")
            expect(page.locator("#account")).to_be_hidden()
            expect(page.locator("#token-value")).to_have_value("")
            state["refresh_status"] = 200
            page.reload()
            expect(page.locator("#sign-out")).to_be_enabled()

            page.locator("#sign-out").click()
            expect(page.locator("#session-status")).to_have_text("Signed out.")
            expect(page.locator("#account")).to_be_hidden()
            expect(page.locator("#token-value")).to_have_value("")
            state["authenticated"] = True
            state["expires_at"] = 1
            page.reload()
            expect(page.locator("#session-status")).to_contain_text("session ended")
            expect(page.locator("#account")).to_be_hidden()
            assert page.evaluate("Object.keys(localStorage).length + Object.keys(sessionStorage).length") == 0
            assert external == []
            assert errors == [], errors
            assert not any("model" in (body or {}) or "dataset" in (body or {}) for _, _, body, _ in requests)
            browser.close()
            print("PASS: account unavailable/signed-out states; four widths; CSRF-only mutations; organization roles; one-time token handling; trust/policy operations; literal rendering; stale response rejection; fresh owner billing reconciliation and fail-closed errors; payment redirects; no model uploads or browser credential storage")
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
