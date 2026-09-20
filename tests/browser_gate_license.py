#!/usr/bin/env python3
"""Local-key licensing boundaries; real browser crypto, mocked payment state.

OpenSSL independently verifies browser P-256 proofs and signs fixture licenses.
No identity provider, payment provider or real payment is contacted.
"""

import argparse
import base64
import copy
import hashlib
import json
import mimetypes
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


ORIGIN = "https://license.mfenx.test"
PASSWORD = "paper-lattice-recovery-42"


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def b64(value):
    return base64.b64encode(value).decode()


class Service:
    def __init__(self, root, temporary):
        self.root, self.temporary = root, temporary
        self.openssl = shutil.which("openssl")
        if not self.openssl:
            raise RuntimeError("OpenSSL is required for independent browser-proof validation")
        self.key = temporary / "issuer.pem"
        self.command("genpkey", "-algorithm", "Ed25519", "-out", str(self.key))
        self.spki = self.command("pkey", "-in", str(self.key), "-pubout", "-outform", "DER")
        self.config = {
            "available": True, "environment": "sandbox",
            "plans": {"team": {"usd_minor": 39900, "interval": "month"}, "private": {"usd_minor": 2400000, "interval": "year"}},
            "portal_url": "https://sandbox-customer-portal.paddle.com/cpl_example/login",
            "issuer": {"algorithm": "Ed25519", "key_id": "fixture-license-issuer", "public_key_spki_base64": b64(self.spki)},
        }
        self.requests, self.external, self.proofs, self.challenges, self.licenses = [], [], [], {}, {}
        self.variant = None
        self.api_status = 200
        self.challenge_variant = None
        self.download_variant = None

    def command(self, *args):
        return subprocess.run([self.openssl, *args], check=True, capture_output=True).stdout

    def sign(self, payload):
        message = self.temporary / "license-message.json"
        message.write_text(canonical(payload))
        return b64(self.command("pkeyutl", "-sign", "-rawin", "-inkey", str(self.key), "-in", str(message)))

    def verify_proof(self, body, action):
        challenge = self.challenges.pop(body["challenge_id"])
        assert challenge["action"] == action
        assert challenge["request"] == body["request"]
        assert challenge["public_key_spki_base64"] == body["public_key_spki_base64"]
        raw = base64.b64decode(body["signature_base64"], validate=True)
        assert len(raw) == 64
        integers = []
        for half in (raw[:32], raw[32:]):
            value = half.lstrip(b"\0") or b"\0"
            if value[0] & 0x80:
                value = b"\0" + value
            integers.append(b"\x02" + bytes([len(value)]) + value)
        sequence = b"".join(integers)
        signature = self.temporary / "proof.der"
        signature.write_bytes(b"\x30" + bytes([len(sequence)]) + sequence)
        public = self.temporary / "holder.der"
        public.write_bytes(base64.b64decode(body["public_key_spki_base64"]))
        message = self.temporary / "challenge.json"
        message.write_text(challenge["message"])
        self.command("pkeyutl", "-verify", "-pubin", "-keyform", "DER", "-inkey", str(public), "-sigfile", str(signature), "-rawin", "-digest", "sha256", "-in", str(message))
        holder = "sha256:" + hashlib.sha256(public.read_bytes()).hexdigest()
        self.proofs.append((action, holder))
        return holder

    def route(self, route):
        url = urlsplit(route.request.url)
        if url.scheme + "://" + url.netloc != ORIGIN:
            self.external.append(route.request.url)
            route.abort()
            return
        if not url.path.startswith("/v1/"):
            requested = url.path.lstrip("/")
            if requested.endswith("/"):
                requested += "index.html"
            file = (self.root / requested).resolve()
            if not file.is_relative_to(self.root) or not file.is_file():
                route.fulfill(status=404, body="Not found")
            else:
                route.fulfill(content_type=mimetypes.guess_type(str(file))[0] or "application/octet-stream", body=file.read_bytes())
            return
        body = json.loads(route.request.post_data) if route.request.post_data else None
        self.requests.append((url.path, body, route.request.headers))
        if self.api_status != 200:
            route.fulfill(status=self.api_status, content_type="application/json", body='{"detail":"unavailable"}')
            return
        if url.path == "/v1/licenses/config":
            route.fulfill(content_type="application/json", body=json.dumps(self.config))
            return
        if url.path == "/v1/licenses/challenge":
            assert set(body) == {"public_key_spki_base64", "action", "request"}
            identifier = secrets.token_hex(32)
            expiry = int(time.time()) + 90
            message = {
                "domain": "mfenx.license.proof.v1", "origin": ORIGIN,
                "action": body["action"], "nonce": identifier, "expires_at": expiry,
                "key_sha256": "sha256:" + hashlib.sha256(base64.b64decode(body["public_key_spki_base64"])).hexdigest(),
                "request_sha256": "sha256:" + hashlib.sha256(canonical(body["request"]).encode()).hexdigest(),
            }
            if self.challenge_variant == "origin": message["origin"] = "https://another.invalid"
            if self.challenge_variant == "action": message["action"] = "checkout"
            if self.challenge_variant == "key": message["key_sha256"] = "sha256:" + "0" * 64
            if self.challenge_variant == "request": message["request_sha256"] = "sha256:" + "0" * 64
            if self.challenge_variant == "expiry": expiry = 1; message["expires_at"] = expiry
            text = canonical(message)
            self.challenges[identifier] = {**body, "message": text}
            route.fulfill(content_type="application/json", body=json.dumps({"challenge_id": identifier, "message": text, "expires_at": expiry}))
            return
        assert set(body) == {"public_key_spki_base64", "request", "challenge_id", "signature_base64"}
        action = url.path.rsplit("/", 1)[1]
        holder = self.verify_proof(body, action)
        if action == "checkout":
            identifier = "lic_" + holder[-32:]
            transaction = "txn_" + holder[-26:]
            if holder not in self.licenses:
                self.licenses[holder] = {"license_id": identifier, "transaction_id": transaction, "state": "pending", "plan": body["request"]["plan"], "paid_until": 0, "request_id": body["request"]["request_id"]}
            else:
                assert self.licenses[holder]["request_id"] == body["request"]["request_id"]
            response = {"license_id": identifier, "transaction_id": transaction, "url": "https://sandbox-pay.paddle.io/hsc_" + "a" * 26 + "_" + "b" * 20 + "?transaction_id=" + transaction, "environment": "sandbox", "entitlement_granted": False}
            if self.variant == "documented_path": response["url"] = response["url"].replace("sandbox-pay.paddle.io/hsc_", "sandbox.pay.paddle.io/checkout/hsc_")
            if self.variant == "wrong_host": response["url"] = "https://sandbox.pay.paddle.io.evil.invalid/checkout/test?transaction_id=" + transaction
            if self.variant == "extra_query": response["url"] += "&user_email=not-permitted%40example.invalid"
            if self.variant == "wrong_transaction": response["url"] = response["url"].replace(transaction, "txn_" + "z" * 26)
        elif action == "inventory":
            response = {"licenses": [self.licenses[holder]] if holder in self.licenses else []}
        elif action == "refresh":
            license = self.licenses[holder]
            assert body["request"]["license_id"] == license["license_id"]
            response = {key: value for key, value in license.items() if key != "transaction_id"}
        elif action == "download":
            license = self.licenses[holder]
            assert license["state"] == "active"
            payload = {"schema": "mfenx.gate.key-entitlement.v1", "license_id": license["license_id"], "holder_key_sha256": holder,
                       "plan": license["plan"], "issued_at": int(time.time()), "expires_at": license["paid_until"], "environment": "sandbox",
                       "issuer": ORIGIN, "key_id": self.config["issuer"]["key_id"], "verification_metered": False, "usage_telemetry": False}
            if self.download_variant == "holder": payload["holder_key_sha256"] = "sha256:" + "0" * 64
            if self.download_variant == "origin": payload["issuer"] = "https://another.invalid"
            if self.download_variant == "expiry": payload["expires_at"] = int(time.time()) + 172800
            response = {"payload": payload, "algorithm": "Ed25519", "key_id": self.config["issuer"]["key_id"], "signature": self.sign(payload)}
            if self.download_variant == "signature": response["signature"] = b64(bytes(64))
        else:
            raise AssertionError(action)
        route.fulfill(content_type="application/json", body=json.dumps(response))


def run(root, chromium):
    with tempfile.TemporaryDirectory(prefix="mfenx-license-browser-") as name, sync_playwright() as playwright:
        temporary = Path(name)
        service = Service(root, temporary)
        browser = playwright.chromium.launch(executable_path=chromium, headless=True)
        errors = []

        def workspace():
            context = browser.new_context(accept_downloads=True)
            context.route("**/*", service.route)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(ORIGIN + "/gate/license/?transaction_id=untrusted&paid=true")
            expect(page.locator("#license-status")).to_contain_text("workspace ready")
            assert page.url == ORIGIN + "/gate/license/"
            return context, page

        def create(page):
            page.locator("#backup-password").fill(PASSWORD)
            page.locator("#backup-confirm").fill(PASSWORD)
            page.locator("#key-understood").check()
            with page.expect_download() as download:
                page.locator("#key-create").click()
            file = Path(download.value.path())
            backup = json.loads(file.read_text())
            expect(page.locator("#key-present")).to_be_visible()
            expect(page.locator("#backup-password")).to_have_value("")
            assert backup["encryption"]["iterations"] == 600000
            assert PASSWORD not in json.dumps(backup)
            assert "PRIVATE KEY" not in json.dumps(backup)
            return file, backup

        context, page = workspace()
        for width in (320, 390, 768, 1440):
            page.set_viewport_size({"width": width, "height": 1000})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
        page.keyboard.press("Tab")
        expect(page.locator(".skip-link")).to_be_focused()
        expect(page.locator("#license-buy")).to_be_disabled()
        expect(page.locator("#license-portal")).to_be_hidden()
        backup_file, backup = create(page)
        saved_backup = temporary / "recovery.json"
        saved_backup.write_text(json.dumps(backup))
        assert not service.proofs
        assert all(path == "/v1/licenses/config" for path, _, _ in service.requests)
        assert page.evaluate("""async () => {
          const module = await import('/gate/license/license-key.js');
          const key = (await module.loadIdentity()).private_key;
          try { await crypto.subtle.exportKey('pkcs8', key); return false; }
          catch { return key.extractable === false && key.usages.join(',') === 'sign'; }
        }""")
        page.locator("#backup-saved").check()
        expect(page.locator("#license-buy")).to_be_enabled()
        page.locator("#license-buy").click()
        expect(page.locator("#checkout-link")).to_be_visible()
        assert "sandbox-pay.paddle.io/hsc_" in page.locator("#checkout-link").get_attribute("href")
        expect(page.locator("#license-download")).to_be_disabled()
        holder = backup["key_id"]
        assert service.proofs[-1] == ("checkout", holder)
        original_request = service.licenses[holder]["request_id"]
        page.reload()
        expect(page.locator("#license-buy")).to_have_text("Resume checkout")
        expect(page.locator("#license-buy")).to_be_enabled()
        page.locator("#license-buy").click()
        expect(page.locator("#checkout-link")).to_be_visible()
        assert service.licenses[holder]["request_id"] == original_request
        page.locator("#license-refresh").click()
        expect(page.locator("#document-status")).to_contain_text("No active entitlement")
        service.licenses[holder].update(state="active", paid_until=int(time.time()) + 3600)
        page.locator("#license-refresh").click()
        expect(page.locator("#license-download")).to_be_enabled()
        with page.expect_download() as downloaded:
            page.locator("#license-download").click()
        document = json.loads(Path(downloaded.value.path()).read_text())
        assert document["payload"]["holder_key_sha256"] == holder
        assert document["payload"]["environment"] == "sandbox"
        page.locator("#license-portal").click()
        expect(page.locator("#portal-link")).to_be_visible()
        assert page.locator("#portal-link").get_attribute("href") == service.config["portal_url"]
        assert not service.external

        # Every challenge component is checked before signing a proof.
        for variant in ("origin", "action", "key", "request", "expiry"):
            count = len(service.proofs)
            service.challenge_variant = variant
            page.locator("#license-refresh").click()
            expect(page.locator("#license-status")).to_contain_text("challenge")
            expect(page.locator("#license-download")).to_be_disabled()
            expect(page.locator("#portal-link")).to_be_hidden()
            assert len(service.proofs) == count
        service.challenge_variant = None

        # A signed document is still rejected if its holder/origin/term differs.
        for variant in ("signature", "holder", "origin", "expiry"):
            service.download_variant = variant
            page.locator("#license-refresh").click()
            expect(page.locator("#license-download")).to_be_enabled()
            page.locator("#license-download").click()
            expect(page.locator("#license-status")).to_contain_text("license")
            expect(page.locator("#license-download")).to_be_disabled()
        service.download_variant = None
        page.reload()
        expect(page.locator("#key-fingerprint")).to_have_text(holder)
        expect(page.locator("#license-download")).to_be_disabled()
        assert page.evaluate("localStorage.length === 0 && sessionStorage.length === 0")
        context.close()

        # A new browser can recover with only the encrypted backup/passphrase.
        context, page = workspace()
        page.locator(".license-restore summary").click()
        page.locator("#restore-file").set_input_files(saved_backup)
        page.locator("#restore-password").fill("wrong-password-42")
        page.locator("#key-restore").click()
        expect(page.locator("#license-status")).to_contain_text("incorrect or")
        expect(page.locator("#key-new")).to_be_visible()
        page.locator("#restore-password").fill(PASSWORD)
        page.locator("#key-restore").click()
        expect(page.locator("#key-fingerprint")).to_have_text(holder)
        page.locator("#license-refresh").click()
        expect(page.locator("#license-download")).to_be_enabled()
        assert service.proofs[-2:] == [("inventory", holder), ("refresh", holder)]
        # Recovery retains the immutable purchase request; it cannot make a
        # duplicate transaction when an unfinished payment is resumed.
        service.licenses[holder].update(state="pending", paid_until=0)
        page.locator("#license-refresh").click()
        expect(page.locator("#document-status")).to_contain_text("No active entitlement")
        page.locator("#backup-saved").check()
        expect(page.locator("#license-buy")).to_be_enabled()
        page.locator("#license-buy").click()
        expect(page.locator("#checkout-link")).to_be_visible()
        assert service.licenses[holder]["request_id"] == original_request
        context.close()

        # Bound KDF work and authenticate the recovery-file metadata.
        for variant in ("iterations", "key_id", "ciphertext"):
            context, page = workspace()
            damaged = copy.deepcopy(backup)
            if variant == "iterations": damaged["encryption"]["iterations"] = 1000000000
            if variant == "key_id": damaged["key_id"] = "sha256:" + "0" * 64
            if variant == "ciphertext": damaged["encryption"]["ciphertext_base64"] = b64(bytes(180))
            result = page.evaluate("""async ({backup,password}) => {
              const module = await import('/gate/license/license-key.js');
              try { await module.restoreIdentity(JSON.stringify(backup), password); return 'accepted'; }
              catch (error) { return error.message; }
            }""", {"backup": damaged, "password": PASSWORD})
            assert result != "accepted", variant
            context.close()

        service.variant = "documented_path"
        context, page = workspace()
        create(page)
        page.locator("#backup-saved").check()
        expect(page.locator("#license-buy")).to_be_enabled()
        page.locator("#license-buy").click()
        expect(page.locator("#checkout-link")).to_be_visible()
        assert "sandbox.pay.paddle.io/checkout/hsc_" in page.locator("#checkout-link").get_attribute("href")
        context.close()
        for variant in ("wrong_host", "extra_query", "wrong_transaction"):
            service.variant = variant
            context, page = workspace()
            create(page)
            page.locator("#backup-saved").check()
            expect(page.locator("#license-buy")).to_be_enabled()
            page.locator("#license-buy").click()
            expect(page.locator("#license-status")).to_contain_text("payment link")
            expect(page.locator("#checkout-link")).to_be_hidden()
            context.close()
        service.variant = None

        service.config["available"] = False
        context = browser.new_context()
        context.route("**/*", service.route)
        page = context.new_page()
        page.goto(ORIGIN + "/gate/license/")
        expect(page.locator("#license-status")).to_contain_text("not configured")
        expect(page.locator("#license-buy")).to_be_disabled()
        context.close()
        service.config["available"] = True
        service.config["oversized"] = "x" * 65537
        context = browser.new_context()
        context.route("**/*", service.route)
        page = context.new_page()
        page.goto(ORIGIN + "/gate/license/")
        expect(page.locator("#license-status")).to_contain_text("exceeded")
        expect(page.locator("#license-buy")).to_be_disabled()
        context.close()

        assert not service.external, service.external
        for path, body, headers in service.requests:
            assert path.startswith("/v1/licenses/")
            assert "cookie" not in headers and "authorization" not in headers
            serialized = json.dumps(body)
            assert PASSWORD not in serialized
            assert "ciphertext_base64" not in serialized
            assert "private_key" not in serialized
            assert "user_email" not in serialized
        assert not errors, errors
        browser.close()
        print("Local license browser: PASS (4 widths; actual encrypted-key create/restore; nonextractable storage; OpenSSL-verified P-256 proofs; bound challenges; verified Ed25519 downloads; payment-state gates; provider URL isolation; no account/PII/key uploads; no third-party scripts; mocked payment provider)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("public"))
    parser.add_argument("--chromium")
    args = parser.parse_args()
    run(args.root.resolve(), args.chromium)
