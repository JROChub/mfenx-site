"""Isolated payment-origin tests. All network traffic uses deterministic doubles.

Run with pytest and Chromium. Synthetic Ed25519 tickets exercise WebCrypto;
these tests do not contact Paddle or establish that a payment was collected.
"""

import base64
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1] / "public/gate/payment"
ORIGIN = "https://pay.mfenx.com"
ISSUER = "https://license.mfenx.com"
SDK = "https://cdn.paddle.com/paddle/v2/paddle.js"
NOW = 1_800_000_000
KEY = Ed25519PrivateKey.from_private_bytes(bytes(range(32)))
KEY_ID = "test-payment-signing-key"
PLANS = {"team": (39900, "month"), "business": (149900, "month"), "private": (2400000, "year")}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def b64(value):
    return base64.b64encode(value).decode("ascii")


def payload(plan="team", environment="sandbox"):
    price, interval = PLANS[plan]
    return {"schema": "mfenx.gate.checkout.v1", "issuer": ISSUER,
            "audience": ORIGIN, "environment": environment, "key_id": KEY_ID,
            "transaction_id": "txn_" + "a" * 26, "plan": plan,
            "currency": "USD", "unit_price_minor": price, "interval": interval,
            "quantity": 1, "issued_at": NOW, "expires_at": NOW + 300}


def envelope(record=None, key=KEY):
    record = record or payload()
    return {"algorithm": "Ed25519", "key_id": record["key_id"], "payload": record,
            "signature": b64(key.sign(canonical(record).encode("ascii")))}


def fragment(record=None, raw=None):
    raw = raw if raw is not None else canonical(record or envelope())
    return "#ticket=" + base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def configuration(environment="sandbox", key=KEY):
    return {"schema": "mfenx.gate.checkout-config.v1", "enabled": True,
            "environment": environment, "issuer": ISSUER, "origin": ORIGIN,
            "paddle_client_token": ("test_" if environment == "sandbox" else "live_") + "b" * 24,
            "key_id": KEY_ID,
            "public_key_spki_base64": b64(key.public_key().public_bytes(
                serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))}


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as playwright:
        instance = playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_EXECUTABLE"), headless=True)
        yield instance
        instance.close()


class Harness:
    def __init__(self, browser):
        self.context = browser.new_context()
        self.context.add_init_script("""
          window.testNow = 1800000000000;
          Date.now = () => window.testNow;
          window.fetchLocations = [];
          const actualFetch = window.fetch;
          window.fetch = (...args) => {
            window.fetchLocations.push({url:location.href, options:args[1]});
            return actualFetch(...args);
          };
          window.forbiddenAccess = [];
          for (const name of ['localStorage','sessionStorage','indexedDB']) {
            Object.defineProperty(window, name, {get() {
              window.forbiddenAccess.push(name); throw new Error('forbidden persistence');
            }});
          }
        """)
        self.config = configuration()
        self.config_raw = None
        self.config_status = 200
        self.config_type = "application/json"
        self.sdk_mode = "success"
        self.requests = []
        self.unexpected = []
        self.errors = []
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def route(self, route):
        request = route.request
        self.requests.append((request.url, request.method, request.headers))
        parsed = urlsplit(request.url)
        if request.url == SDK:
            if self.sdk_mode == "failure":
                route.abort()
                return
            prelude = "window.testNow += 400000;" if self.sdk_mode == "expire" else ""
            route.fulfill(content_type="application/javascript", body=prelude + """
              window.paddleCalls = [];
              window.Paddle = {
                Environment: {set: value => window.paddleCalls.push(['environment', value])},
                Initialize: value => window.paddleCalls.push(['initialize', value]),
                Checkout: {open: value => window.paddleCalls.push(['open', value])}
              };
            """)
        elif parsed.path == "/checkout-config.json":
            route.fulfill(status=self.config_status, content_type=self.config_type,
                          body=self.config_raw if self.config_raw is not None else canonical(self.config))
        elif parsed.path in {"/", "/payment.js", "/payment.css"}:
            name = "index.html" if parsed.path == "/" else parsed.path[1:]
            route.fulfill(path=ROOT / name)
        else:
            self.unexpected.append(request.url)
            route.abort()

    def goto(self, token=None, origin=ORIGIN, query=""):
        self.page.goto(origin + "/" + query + (fragment() if token is None else token))
        expect(self.page.locator("#payment-status")).not_to_have_text("Checking the signed checkout request…")

    def ready(self):
        expect(self.page.locator("#payment-open")).to_be_enabled()
        expect(self.page.locator("#payment-review")).to_be_visible()

    def rejected(self, config_requests=0):
        expect(self.page.locator("#payment-open")).to_be_disabled()
        expect(self.page.locator("#payment-review")).to_be_hidden()
        assert self.count("/checkout-config.json") == config_requests
        assert self.count(SDK) == 0

    def count(self, value):
        return sum(url == value or urlsplit(url).path == value for url, _, _ in self.requests)

    def close(self):
        assert not self.unexpected
        assert not self.errors
        assert self.page.evaluate("window.forbiddenAccess") == []
        assert self.context.cookies() == []
        self.context.close()


@pytest.fixture
def harness(browser):
    value = Harness(browser)
    yield value
    value.close()


@pytest.mark.parametrize("plan", PLANS)
@pytest.mark.parametrize("environment", ["sandbox", "live"])
def test_verified_explicit_transaction_only_checkout(harness, plan, environment):
    harness.config = configuration(environment)
    harness.goto(fragment(envelope(payload(plan, environment))))
    harness.ready()
    assert harness.count(SDK) == 0
    assert harness.page.url == ORIGIN + "/"
    fetches = harness.page.evaluate("window.fetchLocations")
    assert len(fetches) == 1 and fetches[0]["url"] == ORIGIN + "/"
    options = fetches[0]["options"]
    assert {key: options[key] for key in ["credentials", "mode", "cache", "redirect", "referrerPolicy"]} == {
        "credentials": "omit", "mode": "same-origin", "cache": "no-store", "redirect": "error", "referrerPolicy": "no-referrer"}
    for url, method, headers in harness.requests:
        assert method == "GET"
        assert "cookie" not in headers and "authorization" not in headers and "referer" not in headers
    harness.page.locator("#payment-open").click()
    expect(harness.page.locator("#payment-status")).to_contain_text("Paddle checkout opened")
    calls = harness.page.evaluate("window.paddleCalls")
    expected = [] if environment == "live" else [["environment", "sandbox"]]
    expected.extend([
        ["initialize", {"token": harness.config["paddle_client_token"]}],
        ["open", {"transactionId": "txn_" + "a" * 26,
                  "settings": {"displayMode": "overlay", "theme": "light", "showAddDiscounts": False,
                               "successUrl": ISSUER + "/gate/license/"}}],
    ])
    assert calls == expected
    assert harness.count(SDK) == 1
    expect(harness.page.locator("#payment-open")).to_be_disabled()
    # Neither a forged completion message nor a second click issues a grant or opens another checkout.
    harness.page.evaluate("postMessage({name:'checkout.completed', data:{status:'paid'}}, '*')")
    harness.page.locator("#payment-open").dispatch_event("click")
    assert harness.page.evaluate("window.paddleCalls") == expected
    assert harness.page.url == ORIGIN + "/"


@pytest.mark.parametrize("width", [320, 390, 768, 1440])
def test_responsive_keyboard_review(harness, width):
    harness.page.set_viewport_size({"width": width, "height": 1000})
    harness.goto()
    harness.ready()
    assert harness.page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    harness.page.keyboard.press("Tab")
    expect(harness.page.locator(".skip-link")).to_be_focused()
    harness.page.keyboard.press("Enter")
    expect(harness.page.locator("#main")).to_be_focused()
    assert harness.page.url == ORIGIN + "/"
    harness.page.locator("#payment-open").focus()
    harness.page.keyboard.press("Enter")
    expect(harness.page.locator("#payment-status")).to_contain_text("Paddle checkout opened")


@pytest.mark.parametrize("token", ["", "#ticket=", "#ticket=!", "#ticket=A", "#ticket=" + "A" * 4097,
                                  "#ticket=a&ticket=b", "#ticket=YQ==", "#ticket=%59Q", "#other=value"])
def test_malformed_transport_makes_no_request(harness, token):
    harness.goto(token)
    harness.rejected()
    assert harness.page.url == ORIGIN + "/"


@pytest.mark.parametrize("change", [
    {"schema": "mfenx.gate.entitlement.v1"}, {"issuer": "https://evil.invalid"},
    {"audience": "https://mfenx.com"}, {"environment": "production"},
    {"key_id": "<img src=x>"}, {"transaction_id": "txn_" + "A" * 26},
    {"transaction_id": "https://evil.invalid"}, {"plan": "enterprise"}, {"plan": ["team"]},
    {"currency": "EUR"}, {"unit_price_minor": 1}, {"interval": "year"},
    {"quantity": 2}, {"quantity": True}, {"issued_at": str(NOW)}, {"issued_at": NOW + 61, "expires_at": NOW + 361},
    {"issued_at": NOW - 300, "expires_at": NOW}, {"expires_at": NOW + 301},
    {"issued_at": 0, "expires_at": 300}, {"expires_at": 2**53}, {"extra": "not permitted"},
])
def test_payload_contract_before_network(harness, change):
    record = payload()
    record.update(change)
    harness.goto(fragment(envelope(record)))
    harness.rejected()


@pytest.mark.parametrize("case", ["duplicate-envelope", "duplicate-payload", "whitespace", "newline", "unsorted",
                                  "escaped-key", "float-integer", "extra-envelope", "missing-field", "bad-signature", "padded-signature"])
def test_noncanonical_or_ambiguous_ticket_rejected_locally(harness, case):
    value = envelope()
    raw = canonical(value)
    if case == "duplicate-envelope":
        raw = raw.replace('"algorithm":"Ed25519"', '"algorithm":"Ed25519","algorithm":"Ed25519"')
    elif case == "duplicate-payload":
        raw = raw.replace('"quantity":1', '"quantity":1,"quantity":1')
    elif case == "whitespace":
        raw = " " + raw
    elif case == "newline":
        raw += "\n"
    elif case == "unsorted":
        raw = json.dumps(value, separators=(",", ":"))
    elif case == "escaped-key":
        raw = raw.replace('"schema"', '"\\u0073chema"')
    elif case == "float-integer":
        raw = raw.replace('"quantity":1', '"quantity":1.0')
    elif case == "extra-envelope":
        value["extra"] = True
        raw = canonical(value)
    elif case == "missing-field":
        del value["payload"]["quantity"]
        raw = canonical(value)
    elif case == "bad-signature":
        value["signature"] = b64(b"short")
        raw = canonical(value)
    elif case == "padded-signature":
        value["signature"] += "="
        raw = canonical(value)
    harness.goto(fragment(raw=raw))
    harness.rejected()


@pytest.mark.parametrize("case", ["changed-transaction", "wrong-key", "different-key-id", "environment",
                                  "envelope-key-id", "unprefixed-signature"])
def test_signature_and_independent_pins(harness, case):
    value = envelope()
    if case == "changed-transaction":
        value["payload"]["transaction_id"] = "txn_" + "c" * 26
    elif case == "wrong-key":
        harness.config = configuration(key=Ed25519PrivateKey.generate())
    elif case == "different-key-id":
        harness.config["key_id"] = "different-key-id"
    elif case == "environment":
        harness.config = configuration("live")
    elif case == "envelope-key-id":
        value["key_id"] = "different-key-id"
    elif case == "unprefixed-signature":
        value["signature"] = b64(KEY.sign(b"another-domain\x00" + canonical(value["payload"]).encode()))
    harness.goto(fragment(value))
    harness.rejected(config_requests=0 if case == "envelope-key-id" else 1)


@pytest.mark.parametrize("case", ["missing", "disabled", "wrong-type", "wrong-origin", "wrong-issuer", "wrong-schema",
                                  "wrong-token-env", "secret-token", "extra", "duplicate", "noncanonical", "oversized",
                                  "invalid-spki", "wrong-algorithm", "noncanonical-base64", "null-config", "truncated"])
def test_invalid_independent_configuration_never_loads_paddle(harness, case):
    if case == "missing": harness.config_status = 404
    elif case == "disabled": harness.config["enabled"] = False
    elif case == "wrong-type": harness.config_type = "text/html"
    elif case == "wrong-origin": harness.config["origin"] = "https://other.invalid"
    elif case == "wrong-issuer": harness.config["issuer"] = "https://other.invalid"
    elif case == "wrong-schema": harness.config["schema"] = "unknown"
    elif case == "wrong-token-env": harness.config["paddle_client_token"] = "live_" + "b" * 24
    elif case == "secret-token": harness.config["paddle_client_token"] = "pdl_sdbx_apikey_" + "b" * 24
    elif case == "extra": harness.config["unknown"] = True
    elif case == "duplicate": harness.config_raw = canonical(harness.config).replace('"enabled":true', '"enabled":true,"enabled":true')
    elif case == "noncanonical": harness.config_raw = json.dumps(harness.config, indent=2)
    elif case == "oversized": harness.config_raw = "x" * 4097
    elif case == "invalid-spki": harness.config["public_key_spki_base64"] = b64(b"x" * 44)
    elif case == "wrong-algorithm":
        from cryptography.hazmat.primitives.asymmetric import ec
        harness.config["public_key_spki_base64"] = b64(ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))
    elif case == "noncanonical-base64": harness.config["public_key_spki_base64"] += "="
    elif case == "null-config": harness.config_raw = "null"
    elif case == "truncated": harness.config_raw = "{"
    harness.goto()
    harness.rejected(config_requests=1)


@pytest.mark.parametrize("origin", ["https://mfenx.com", "https://license.mfenx.com", "https://pay.mfenx.com.evil.invalid", "http://pay.mfenx.com"])
def test_other_origins_never_fetch_configuration(harness, origin):
    harness.goto(origin=origin)
    harness.rejected()


def test_query_cleared_but_never_authorizes_checkout(harness):
    harness.goto(query="?_ptxn=txn_attacker&return=https://evil.invalid")
    harness.rejected()
    assert harness.page.url == ORIGIN + "/"


def test_expiry_rechecked_at_click(harness):
    harness.goto()
    harness.ready()
    harness.page.evaluate("window.testNow += 300000")
    harness.page.locator("#payment-open").click()
    harness.rejected(config_requests=1)


def test_expiry_rechecked_after_sdk_load(harness):
    harness.sdk_mode = "expire"
    harness.goto()
    harness.ready()
    harness.page.locator("#payment-open").click()
    expect(harness.page.locator("#payment-review")).to_be_hidden()
    assert harness.count(SDK) == 1
    assert harness.page.evaluate("window.paddleCalls") == []


def test_sdk_network_failure_is_closed(harness):
    harness.sdk_mode = "failure"
    harness.goto()
    harness.ready()
    harness.page.locator("#payment-open").click()
    expect(harness.page.locator("#payment-review")).to_be_hidden()
    expect(harness.page.locator("#payment-open")).to_be_disabled()
    assert harness.count(SDK) == 1
    assert harness.page.evaluate("typeof window.Paddle") == "undefined"


def test_double_click_loads_once(harness):
    harness.goto()
    harness.ready()
    harness.page.evaluate("document.querySelector('#payment-open').click();document.querySelector('#payment-open').dispatchEvent(new MouseEvent('click'))")
    expect(harness.page.locator("#payment-status")).to_contain_text("Paddle checkout opened")
    assert harness.count(SDK) == 1
    assert len([call for call in harness.page.evaluate("window.paddleCalls") if call[0] == "open"]) == 1


def test_history_cleanup_failure_no_fetch(harness):
    harness.context.add_init_script("history.replaceState = () => {throw new Error('blocked')}")
    harness.goto()
    harness.rejected()


def test_pagehide_invalidates_request(harness):
    harness.goto()
    harness.ready()
    harness.page.evaluate("dispatchEvent(new PageTransitionEvent('pagehide'))")
    harness.rejected(config_requests=1)


def test_reload_cannot_reuse_cleared_fragment(harness):
    harness.goto()
    harness.ready()
    harness.page.reload()
    expect(harness.page.locator("#payment-status")).to_contain_text("verified checkout request is required")
    harness.rejected(config_requests=1)


def test_iframe_cannot_open_purchase(harness):
    harness.context.route(ORIGIN + "/frame.html", lambda route: route.fulfill(
        content_type="text/html", body='<iframe src="/' + fragment() + '"></iframe>'))
    harness.page.goto(ORIGIN + "/frame.html")
    frame = harness.page.frame_locator("iframe")
    expect(frame.locator("#payment-status")).to_contain_text("verified checkout request is required")
    expect(frame.locator("#payment-open")).to_be_disabled()
    assert harness.count("/checkout-config.json") == harness.count(SDK) == 0


def test_scheduled_expiry_callback_disables_purchase(harness):
    harness.context.add_init_script("""
      const actualTimeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 300000) window.expiryCallback = callback;
        return actualTimeout(callback, delay, ...args);
      };
    """)
    harness.goto()
    harness.ready()
    harness.page.evaluate("window.testNow += 300001; window.expiryCallback()")
    expect(harness.page.locator("#payment-status")).to_contain_text("request has expired")
    harness.rejected(config_requests=1)


def test_redirected_configuration_is_not_followed(harness):
    harness.context.route(ORIGIN + "/checkout-config.json", lambda route: route.fulfill(
        status=302, headers={"Location": "https://other.invalid/config.json"}))
    harness.goto()
    harness.rejected(config_requests=0)  # The overridden route is not counted by Harness.


def test_history_has_no_ticket_after_review(harness):
    harness.goto()
    harness.ready()
    assert harness.page.evaluate("history.state") is None
    assert harness.page.evaluate("location.search + location.hash") == ""
    assert harness.page.locator("input, form").count() == 0
    assert harness.page.locator("a[href^='https://license.mfenx.com']").get_attribute("href") == ISSUER + "/gate/license/"


def test_repo_configuration_is_disabled():
    value = json.loads((ROOT / "checkout-config.json").read_text())
    assert value["enabled"] is False
    assert value["paddle_client_token"] == "" and value["public_key_spki_base64"] == ""


def test_document_security_policy_and_relative_assets():
    from html.parser import HTMLParser

    class Parser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.tags = []

        def handle_starttag(self, tag, attrs):
            self.tags.append((tag, dict(attrs)))

    parsed = Parser()
    parsed.feed((ROOT / "index.html").read_text())
    metas = [attrs for tag, attrs in parsed.tags if tag == "meta"]
    csp = next(attrs["content"] for attrs in metas if attrs.get("http-equiv") == "Content-Security-Policy")
    for clause in ["default-src 'none'", "script-src 'self' " + SDK, "object-src 'none'", "base-uri 'none'", "form-action 'none'"]:
        assert clause in csp.split("; ")
    assert "'unsafe-eval'" not in csp
    assert any(attrs.get("name") == "referrer" and attrs.get("content") == "no-referrer" for attrs in metas)
    assert [attrs["src"] for tag, attrs in parsed.tags if tag == "script"] == ["./payment.js"]
    assert [attrs["href"] for tag, attrs in parsed.tags if tag == "link"] == ["./payment.css"]
