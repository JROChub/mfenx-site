"""Runtime delivery documentation: local files only, no external requests."""

import mimetypes
import os
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1] / "public"
ORIGIN = "https://mfenx.com"


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as playwright:
        instance = playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_EXECUTABLE"), headless=True
        )
        yield instance
        instance.close()


@pytest.fixture
def page(browser):
    context = browser.new_context(reduced_motion="reduce")
    failures = []

    def local_only(route):
        request = route.request
        parsed = urlsplit(request.url)
        path = (ROOT / parsed.path.lstrip("/")).resolve()
        if path.is_dir():
            path = path / "index.html"
        if (f"{parsed.scheme}://{parsed.netloc}" != ORIGIN
                or request.method != "GET" or not path.is_relative_to(ROOT)
                or not path.is_file()):
            failures.append(request.url)
            route.abort()
            return
        route.fulfill(path=path, content_type=mimetypes.guess_type(path)[0]
                      or "application/octet-stream")

    context.route("**/*", local_only)
    document = context.new_page()
    document.on("pageerror", lambda error: failures.append(str(error)))
    yield document
    context.close()
    assert not failures, failures


@pytest.mark.parametrize("width", [320, 390, 768, 1440])
def test_readable_installation_and_downloads(page, width):
    page.set_viewport_size({"width": width, "height": 900})
    page.goto(ORIGIN + "/docs/runtime/")
    expect(page.get_by_role("heading", level=1)).to_have_text("Authenticate. Install. Accept.")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    expect(page.get_by_role("main")).to_be_visible()
    expect(page.locator("a[download]")).to_have_count(7)
    for link in page.locator("a[download]").all():
        assert link.get_attribute("href").startswith("/gate/downloads/runtime-0.3.0rc3/")
        assert (ROOT / link.get_attribute("href").lstrip("/")).is_file()
    for anchor in page.get_by_role("navigation", name="On this page").get_by_role("link").all():
        target = anchor.get_attribute("href")
        expect(page.locator(target)).to_have_count(1)
    assert page.locator("script, iframe, form").count() == 0


def test_keyboard_skip_link_and_section_navigation(page):
    page.goto(ORIGIN + "/docs/runtime/")
    page.keyboard.press("Tab")
    expect(page.get_by_role("link", name="Skip to content")).to_be_focused()
    page.keyboard.press("Enter")
    expect(page.get_by_role("main")).to_be_focused()
    page.get_by_role("navigation", name="On this page").get_by_role(
        "link", name="Installed acceptance", exact=True).click()
    assert page.url.endswith("#acceptance")
    expect(page.get_by_role("heading", name="Exercise the installed runtime")).to_be_in_viewport()


@pytest.mark.parametrize("width", [320, 390, 768, 1440])
def test_purchase_entry_is_readable_and_does_not_load_payment_code(page, width):
    page.set_viewport_size({"width": width, "height": 900})
    page.goto(ORIGIN + "/pricing/")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    purchase = page.get_by_role("link", name="Choose a subscription")
    expect(purchase).to_have_attribute("href", "https://license.mfenx.com/gate/license/")
    expect(purchase).to_be_visible()
    purchase.focus()
    expect(purchase).to_be_focused()
    expect(page.get_by_role("link", name="Review installation requirements")).to_have_attribute(
        "href", "/docs/runtime/")
    assert page.locator("script, iframe, form").count() == 0
    page.goto(ORIGIN + "/support/")
    expect(page.get_by_role("link", name="software-license page")).to_have_attribute(
        "href", "https://license.mfenx.com/gate/license/")
