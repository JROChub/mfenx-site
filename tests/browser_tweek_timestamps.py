#!/usr/bin/env python3
"""Exercise timestamp requests and downloads under the published browser CSP.

Calendar responses and signing keys are synthetic. No request reaches a public
calendar, and a parsed Bitcoin attestation is never treated as a verified block.
"""

import argparse
import base64
import functools
import http.server
import json
from pathlib import Path
import re
import subprocess
import tempfile
import threading
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from browser_site_design import QuietHandler


CANONICAL_CALENDARS = (
    "https://alice.btc.calendar.opentimestamps.org",
    "https://bob.btc.calendar.opentimestamps.org",
    "https://finney.calendar.eternitywall.com",
)
SUBMISSION_CALENDARS = (
    "https://a.pool.opentimestamps.org",
    "https://b.pool.opentimestamps.org",
    "https://a.pool.eternitywall.com",
)

FIXTURES = r"""
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [root, output, calendarsJson] = process.argv.slice(2);
const engine = file => import(pathToFileURL(path.join(root, 'tweek/engine', file)));
const {protect} = await engine('protect.mjs');
const {generateKeyPair} = await engine('sign.mjs');
const {concat, fromHex, utf8} = await engine('bytes.mjs');
const {serializeProof, varuint} = await engine('ots.mjs');
const calendars = JSON.parse(calendarsJson);
const result = await protect({
  bytes: new Uint8Array([0, 1, 2, 3, 4, 5]), name: 'fixture.bin',
  creator: {name: 'Timestamp regression fixture'}, policyId: 'no-ai',
  key: await generateKeyPair(), options: {timestamp: false, watermark: false},
});
const digest = fromHex(result.manifestDigest.slice(7));
const attestation = (tag, payload) => concat(fromHex(tag), varuint(payload.length), payload);
const pending = calendars.map(uri => {
  const encoded = utf8(uri);
  return attestation('83dfe30d2ef90c8e', concat(varuint(encoded.length), encoded));
});
// The height and Merkle root are deliberately unauthenticated. A valid encoding
// alone must not produce a confirmation claim in either the engine or the UI.
const bitcoin = attestation('0588960d73d71901', varuint(1));
const unknown = attestation('0102030405060708', new Uint8Array());
const proof = atts => serializeProof(digest, {msg: digest, attestations: atts, ops: []});
const forged = proof([bitcoin]);
await Promise.all([
  fs.writeFile(path.join(output, result.outputName), result.outputBytes),
  fs.writeFile(path.join(output, 'manifest.json'), result.manifestJson),
  fs.writeFile(path.join(output, 'pending.ots'), proof(pending)),
  fs.writeFile(path.join(output, 'forged.ots'), forged),
  fs.writeFile(path.join(output, 'malformed.ots'), forged.slice(0, -1)),
  fs.writeFile(path.join(output, 'unknown.ots'), proof([unknown])),
]);
const b64 = bytes => Buffer.from(bytes).toString('base64');
console.log(JSON.stringify({
  file: result.outputName, digest: result.manifestDigest.slice(7),
  pendingResponses: pending.map(a => b64(concat(new Uint8Array([0]), a))),
  bitcoinResponse: b64(concat(new Uint8Array([0]), bitcoin)),
}));
"""


def make_fixtures(root, directory):
    result = subprocess.run(
        ["node", "--input-type=module", "-", str(root.resolve()), str(directory),
         json.dumps(CANONICAL_CALENDARS)],
        input=FIXTURES, text=True, capture_output=True, check=True,
    )
    return json.loads(result.stdout)


def run(root, chromium):
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(root.resolve()))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    failures = []
    unexpected_requests = []
    calls = []
    mode = "pending"

    try:
        with tempfile.TemporaryDirectory(prefix="tweek-timestamps-") as temporary:
            directory = Path(temporary)
            fixture = make_fixtures(root, directory)
            pending_responses = [base64.b64decode(value) for value in fixture["pendingResponses"]]
            bitcoin_response = base64.b64decode(fixture["bitcoinResponse"])

            def route_request(route):
                request = route.request
                parsed = urlsplit(request.url)
                remote_origin = f"{parsed.scheme}://{parsed.netloc}"
                if remote_origin == origin:
                    route.continue_()
                    return
                if remote_origin in CANONICAL_CALENDARS and parsed.path.startswith("/timestamp/"):
                    calls.append((request.method, remote_origin, parsed.path))
                    assert request.method == "GET"
                    assert parsed.path == f"/timestamp/{fixture['digest']}"
                    outcome = mode
                    if mode == "mixed":
                        outcome = "pending" if remote_origin == CANONICAL_CALENDARS[0] else "unavailable"
                    if outcome == "network-error":
                        route.abort("failed")
                    elif outcome == "upgraded":
                        route.fulfill(status=200, content_type="application/vnd.opentimestamps.v1", body=bitcoin_response)
                    else:
                        route.fulfill(status=404 if outcome == "pending" else 503, body="")
                    return
                if remote_origin in SUBMISSION_CALENDARS and parsed.path == "/digest":
                    calls.append((request.method, remote_origin, parsed.path))
                    assert request.method == "POST"
                    assert request.post_data_buffer == bytes.fromhex(fixture["digest"])
                    if mode == "stamp":
                        index = SUBMISSION_CALENDARS.index(remote_origin)
                        route.fulfill(status=200, content_type="application/vnd.opentimestamps.v1", body=pending_responses[index])
                    else:
                        route.fulfill(status=503, body="")
                    return
                unexpected_requests.append(request.url)
                route.abort("blockedbyclient")

            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=chromium, headless=True)
                context = browser.new_context(accept_downloads=True, bypass_csp=False)
                context.route("**/*", route_request)
                context.add_init_script("""
                    window.timestampFetches = [];
                    window.cspViolations = [];
                    const originalFetch = window.fetch.bind(window);
                    window.fetch = (...args) => {
                        window.timestampFetches.push(String(args[0]?.url || args[0]));
                        return originalFetch(...args);
                    };
                    addEventListener('securitypolicyviolation', event => {
                        window.cspViolations.push({
                            directive: event.effectiveDirective, blocked: event.blockedURI,
                        });
                    });
                """)

                def new_page(proof=None):
                    page = context.new_page()
                    page.on("pageerror", lambda error: failures.append(str(error)))
                    page.goto(origin + "/tweek/verify/", wait_until="networkidle")
                    page.locator("#sidecar").set_input_files(directory / "manifest.json")
                    if proof:
                        page.locator("#ots").set_input_files(directory / proof)
                    page.locator("#file").set_input_files(directory / fixture["file"])
                    expect(page.locator("#checks li").filter(has_text="Signature").locator("strong")).to_have_text("Pass")
                    expect(page.locator("#verify-button")).to_be_enabled()
                    return page

                def close_page(page):
                    assert page.evaluate("window.cspViolations") == [], page.evaluate("window.cspViolations")
                    page.close()

                def click_upgrade(page, upgraded=False):
                    before = len(calls)
                    page.locator("#timestamp-upgrade").click()
                    if upgraded:
                        expect(page.locator("#timestamp-download")).to_be_visible()
                    else:
                        expect(page.locator("#timestamp-upgrade")).to_be_enabled()
                    expect(page.locator("#timestamp-status")).not_to_contain_text("Contacting")
                    recent = calls[before:]
                    assert len(recent) == 3, recent
                    assert {call[1] for call in recent} == set(CANONICAL_CALENDARS)

                def download_proof(page, selector, filename, expected_type):
                    fetches_before = page.evaluate("window.timestampFetches.length")
                    calls_before = len(calls)
                    with page.expect_download() as download_info:
                        page.locator(selector).click()
                    download = download_info.value
                    assert download.suggested_filename.endswith(".tweek.ots")
                    path = directory / filename
                    download.save_as(path)
                    assert page.evaluate("window.timestampFetches.length") == fetches_before
                    assert len(calls) == calls_before
                    parsed = page.evaluate("""async encoded => {
                        const {parseProof} = await import('/tweek/engine/ots.mjs');
                        const proof = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
                        const parsed = parseProof(proof);
                        return {digest: parsed.digest, types: parsed.attestations.map(a => a.type)};
                    }""", base64.b64encode(path.read_bytes()).decode("ascii"))
                    assert parsed["digest"] == fixture["digest"]
                    assert expected_type in parsed["types"], parsed
                    return path

                # Check both generated app pages; subsequent requests exercise the
                # verifier policy in Chromium rather than bypassing it in a mock.
                for route in ("/tweek/", "/tweek/verify/"):
                    page = context.new_page()
                    page.goto(origin + route, wait_until="networkidle")
                    policy = page.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute("content")
                    connect = next(part.strip().split()[1:] for part in policy.split(";") if part.strip().startswith("connect-src "))
                    assert set(CANONICAL_CALENDARS).issubset(connect), connect
                    close_page(page)

                mode = "pending"
                page = new_page("pending.ots")
                click_upgrade(page)
                expect(page.locator("#timestamp-status")).to_contain_text(re.compile("pending", re.I))
                click_upgrade(page)
                expect(page.locator("#timestamp-status")).to_contain_text(re.compile("pending", re.I))
                close_page(page)

                for mode in ("unavailable", "network-error", "mixed"):
                    page = new_page("pending.ots")
                    click_upgrade(page)
                    expect(page.locator("#timestamp-status")).to_contain_text(re.compile("could not|unavailable|failed", re.I))
                    if mode == "mixed":
                        expect(page.locator("#timestamp-status")).to_contain_text(re.compile("pending", re.I))
                    # Retry succeeds without reloading the file or resetting input.
                    mode = "upgraded"
                    click_upgrade(page, upgraded=True)
                    expect(page.locator("#timestamp-download")).to_be_visible()
                    expect(page.locator("#timestamp-status")).to_contain_text(re.compile("independent|not verified|unverified", re.I))
                    expect(page.locator("#timestamp-status")).not_to_contain_text(re.compile("confirmed", re.I))
                    download_proof(page, "#timestamp-download", "upgraded.ots", "bitcoin")
                    close_page(page)

                mode = "unavailable"
                page = new_page()
                before = len(calls)
                page.locator("#timestamp-stamp").click()
                expect(page.locator("#timestamp-stamp")).to_be_enabled()
                expect(page.locator("#timestamp-status")).to_contain_text(re.compile("could not|unavailable|unreachable|failed", re.I))
                assert len(calls) - before == 3
                mode = "stamp"
                page.locator("#timestamp-stamp").click()
                expect(page.locator("#timestamp-stamp-download")).to_be_visible()
                assert len(calls) - before == 6
                download_proof(page, "#timestamp-stamp-download", "stamped.ots", "pending")
                close_page(page)

                for proof, status in (("forged.ots", "Attention"), ("malformed.ots", "Fail"), ("unknown.ots", "Attention")):
                    before = len(calls)
                    page = new_page(proof)
                    timestamp = page.locator("#checks li").filter(has_text="Timestamp proof")
                    expect(timestamp.locator("strong")).to_have_text(status)
                    expect(page.locator("#result-summary")).not_to_contain_text("Every check passed")
                    expect(page.locator("#result-card")).not_to_contain_text(re.compile(r"existed before|Bitcoin-anchored|\bconfirmed\b", re.I))
                    if proof == "forged.ots":
                        expect(timestamp).to_contain_text(re.compile("not performed|unverified|not verified", re.I))
                    if proof == "unknown.ots":
                        expect(page.locator("#result-card")).to_contain_text(re.compile("unverified", re.I))
                        expect(page.locator("#result-card")).not_to_contain_text("Pending at")
                    expect(page.locator("#timestamp-upgrade")).to_have_count(0)
                    assert len(calls) == before
                    close_page(page)

                assert not unexpected_requests, unexpected_requests
                assert not failures, failures
                browser.close()
            print("PASS timestamp CSP, pending/error retries, download isolation, and unverified attestations")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("public"))
    parser.add_argument("--chromium")
    args = parser.parse_args()
    run(args.root, args.chromium)
