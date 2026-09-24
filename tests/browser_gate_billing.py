"""Paddle billing continuation in Chromium; all network requests are intercepted.

This proves browser boundaries, not a real provider payment-method update.
"""
import base64
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1] / "public/gate/payment"
ORIGIN = "https://pay.mfenx.com"
SDK = "https://cdn.paddle.com/paddle/v2/paddle.js"
TRANSACTION = "txn_" + "a" * 26
QUERY = "?_ptxn=" + TRANSACTION


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def configuration(environment="sandbox"):
    return {"schema": "mfenx.gate.checkout-config.v1", "enabled": True,
            "environment": environment, "issuer": "https://license.mfenx.com", "origin": ORIGIN,
            "key_id": "test-billing-issuer",
            "paddle_client_token": ("test_" if environment == "sandbox" else "live_") + "b" * 24,
            "public_key_spki_base64": base64.b64encode(
                bytes.fromhex("302a300506032b6570032100") + bytes(range(32))).decode()}


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
          window.forbiddenAccess = [];
          window.fetchLocations = [];
          const originalFetch = window.fetch;
          window.fetch = (...args) => {
            window.fetchLocations.push({location:location.href, options:args[1]});
            return originalFetch(...args);
          };
          for (const name of ['localStorage','sessionStorage','indexedDB']) {
            Object.defineProperty(window, name, {get() {
              window.forbiddenAccess.push(name); throw Error('forbidden persistence');
            }});
          }
          Object.defineProperty(document, 'cookie', {get() {
            window.forbiddenAccess.push('cookie'); throw Error('forbidden cookie');
          }, set() { window.forbiddenAccess.push('cookie'); throw Error('forbidden cookie'); }});
        """)
        self.config = configuration()
        self.config_raw = None
        self.config_status = 200
        self.config_type = "application/json"
        self.sdk_mode = "ok"
        self.requests, self.unexpected, self.errors = [], [], []
        self.context.route("**/*", self.route)
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def route(self, route):
        request = route.request
        self.requests.append((request.url, request.method, request.headers))
        path = urlsplit(request.url).path
        if request.url == SDK:
            if self.sdk_mode == "failure":
                route.abort()
                return
            prelude = "dispatchEvent(new PageTransitionEvent('pagehide'));" if self.sdk_mode == "pagehide" else ""
            prelude += "history.replaceState(null,'','/billing/?changed=true');" if self.sdk_mode == "changed_url" else ""
            route.fulfill(content_type="application/javascript", body=prelude + """
              window.sdkLaunchLocation = location.href;
              window.paddleCalls = [];
              window.Paddle = {
                Environment: {set: value => window.paddleCalls.push(['environment',value])},
                Initialize: value => window.paddleCalls.push(['initialize',value]),
                Checkout: {open: value => window.paddleCalls.push(['open',value])}
              };
            """)
        elif path == "/checkout-config.json":
            route.fulfill(status=self.config_status, content_type=self.config_type,
                          headers={"Location": ORIGIN + "/unexpected"} if self.config_status == 302 else {},
                          body=self.config_raw if self.config_raw is not None else canonical(self.config))
        elif path.endswith("/billing/") or path.endswith("/billing/index.html"):
            route.fulfill(path=ROOT / "billing/index.html")
        elif path.endswith("/billing/billing.js"):
            route.fulfill(path=ROOT / "billing/billing.js", content_type="application/javascript")
        elif path.endswith("/payment.css"):
            route.fulfill(path=ROOT / "payment.css", content_type="text/css")
        else:
            self.unexpected.append(request.url)
            route.abort()

    def visit(self, query=QUERY, origin=ORIGIN, path="/billing/"):
        self.page.goto(origin + path + query)
        expect(self.page.locator("#payment-status")).not_to_have_text("Checking the billing link…")

    def blocked(self):
        expect(self.page.locator("#payment-open")).to_be_disabled()
        assert not any(url == SDK for url, _, _ in self.requests)

    def close(self):
        assert self.page.evaluate("window.forbiddenAccess") == []
        assert not self.unexpected, self.unexpected
        assert not self.errors, self.errors
        self.context.close()


@pytest.fixture
def harness(browser):
    instance = Harness(browser)
    yield instance
    instance.close()


@pytest.mark.parametrize("environment", ["sandbox", "live"])
def test_only_explicit_click_opens_exact_existing_transaction(harness, environment):
    h = harness
    h.config = configuration(environment)
    h.visit()
    expect(h.page.locator("#payment-open")).to_be_enabled()
    assert h.page.url == ORIGIN + "/billing/"
    assert not any(url == SDK for url, _, _ in h.requests)
    assert TRANSACTION not in h.page.locator("body").inner_text()
    h.page.locator("#payment-open").click()
    expect(h.page.locator("#payment-status")).to_contain_text("Paddle opened")
    calls = h.page.evaluate("window.paddleCalls")
    assert calls == ([['environment', 'sandbox']] if environment == 'sandbox' else []) + [
        ['initialize', {'token': h.config['paddle_client_token']}],
        ['open', {'transactionId': TRANSACTION, 'settings': {'displayMode': 'overlay', 'theme': 'light',
          'allowLogout': False, 'showAddDiscounts': False, 'successUrl': 'https://license.mfenx.com/gate/license/'}}]]
    assert h.page.evaluate("window.sdkLaunchLocation") == ORIGIN + "/billing/"
    locations = h.page.evaluate("window.fetchLocations")
    assert len(locations) == 2
    for record in locations:
        assert record['location'] == ORIGIN + '/billing/'
        assert record['options']['credentials'] == 'omit'
        assert record['options']['redirect'] == 'error'
        assert record['options']['referrerPolicy'] == 'no-referrer'
    for url, method, headers in h.requests:
        assert method == 'GET'
        if url == SDK or url.endswith('/checkout-config.json'):
            assert 'referer' not in headers
    h.page.locator("#payment-open").evaluate("button => button.dispatchEvent(new MouseEvent('click'))")
    assert h.page.evaluate("window.paddleCalls") == calls


@pytest.mark.parametrize("query", ["", "?", "?_ptxn=", QUERY + "&extra=1", QUERY + "&_ptxn=" + TRANSACTION,
    QUERY + "#ticket=x", QUERY + "#", "?%5Fptxn=" + TRANSACTION, "?_ptxn=%74" + TRANSACTION[1:],
    "?_ptxn=TXN_" + "a"*26, "?_ptxn=txn_" + "a"*25, "?_ptxn=txn_" + "a"*27,
    "?_ptxn=" + "a"*5000, "?token=secret&_ptxn=" + TRANSACTION])
def test_ambiguous_or_missing_link_is_cleared_before_configuration(harness, query):
    harness.visit(query)
    harness.blocked()
    assert harness.page.url == ORIGIN + '/billing/'
    assert not any('/checkout-config.json' in url for url, _, _ in harness.requests)


def test_wrong_origin_cannot_fetch_merchant_configuration(harness):
    harness.visit(origin="https://mfenx.com", path="/gate/payment/billing/")
    harness.blocked()
    assert not any('/checkout-config.json' in url for url, _, _ in harness.requests)


@pytest.mark.parametrize("field,value", [("enabled", False), ("enabled", 1), ("environment", "other"),
    ("origin", "https://foreign.example"), ("issuer", "https://foreign.example"),
    ("paddle_client_token", "live_" + "a"*25), ("paddle_client_token", "test_short"),
    ("key_id", ""), ("public_key_spki_base64", base64.b64encode(bytes(44)).decode()),
    ("schema", "other"), ("unexpected", "value")])
def test_config_shape_and_merchant_environment_fail_closed(harness, field, value):
    harness.config[field] = value
    harness.visit()
    harness.blocked()


@pytest.mark.parametrize("raw", ['{}', '[]', '{"enabled":true,"enabled":false}', '{"enabled":NaN}',
    '{}\n', '\ufeff{}', '{"x":"' + 'a'*4096 + '"}'])
def test_invalid_oversized_duplicate_and_noncanonical_json_rejected(harness, raw):
    harness.config_raw = raw
    harness.visit()
    harness.blocked()


@pytest.mark.parametrize("status,content_type", [(404,'application/json'), (302,'application/json'), (200,'text/html')])
def test_unavailable_or_redirected_config_is_not_followed(harness, status, content_type):
    harness.config_status, harness.config_type = status, content_type
    harness.visit()
    harness.blocked()


def test_close_or_changed_merchant_config_between_review_and_click_stops_sdk(harness):
    harness.visit()
    expect(harness.page.locator('#payment-open')).to_be_enabled()
    harness.config['enabled'] = False
    harness.page.locator('#payment-open').click()
    expect(harness.page.locator('#payment-status')).to_contain_text('could not be opened safely')
    harness.blocked()


@pytest.mark.parametrize("mode", ['failure', 'pagehide', 'changed_url'])
def test_sdk_failure_or_page_lifecycle_change_prevents_open(harness, mode):
    harness.sdk_mode = mode
    harness.visit()
    harness.page.locator('#payment-open').click()
    expect(harness.page.locator('#payment-status')).to_contain_text('could not be opened safely')
    assert harness.page.evaluate("window.paddleCalls || []") == []


def test_url_cleanup_failure_blocks_configuration_and_sdk(harness):
    harness.context.add_init_script("history.replaceState=()=>{throw Error('blocked')}")
    harness.visit()
    harness.blocked()
    assert not any('/checkout-config.json' in url for url, _, _ in harness.requests)


def test_reload_does_not_recover_or_reopen_the_billing_transaction(harness):
    harness.visit()
    harness.page.reload()
    expect(harness.page.locator('#payment-status')).to_contain_text('complete Paddle billing link')
    harness.blocked()
    assert len(harness.page.evaluate('window.fetchLocations')) == 0


def test_iframe_cannot_fetch_configuration_or_open_checkout(harness):
    harness.page.route("https://parent.invalid/", lambda route: route.fulfill(
        content_type="text/html", body='<iframe src="' + ORIGIN + '/billing/' + QUERY + '"></iframe>'))
    harness.page.goto("https://parent.invalid/")
    child = harness.page.frame_locator('iframe')
    expect(child.locator('#payment-status')).to_contain_text('complete Paddle billing link')
    expect(child.locator('#payment-open')).to_be_disabled()
    assert not any(url == SDK or '/checkout-config.json' in url for url, _, _ in harness.requests)


def test_reintroduced_query_before_click_prevents_all_further_requests(harness):
    harness.visit()
    calls = len(harness.requests)
    harness.page.evaluate("history.replaceState(null,'','/billing/?_ptxn=txn_'+'b'.repeat(26))")
    harness.page.locator('#payment-open').click()
    expect(harness.page.locator('#payment-status')).to_contain_text('could not be opened safely')
    harness.blocked()
    assert len(harness.requests) == calls


@pytest.mark.parametrize("width", [320, 390, 768, 1440])
def test_review_is_readable_and_keyboard_accessible(harness, width):
    harness.page.set_viewport_size({'width': width, 'height': 900})
    harness.visit()
    assert harness.page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    harness.page.keyboard.press('Tab')
    expect(harness.page.get_by_role('link', name='Skip to billing review')).to_be_focused()
    harness.page.keyboard.press('Enter')
    expect(harness.page.get_by_role('main')).to_be_focused()
    assert harness.page.locator('form, input, iframe').count() == 0
    assert 'overdue payment' in harness.page.locator('body').inner_text()
