"""Local registration wire-contract and safe failure tests; no hosted API writes."""

from contextlib import redirect_stderr, redirect_stdout
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "public/gate/downloads/register_receipt.py"
FIXTURE = ROOT / "public/verify/example/release-receipt.json"
spec = importlib.util.spec_from_file_location("gate_registration_sample", SCRIPT)
client = importlib.util.module_from_spec(spec)
with patch.object(sys, "dont_write_bytecode", True):
    spec.loader.exec_module(client)
TOKEN = "mfg_" + "local_test_token_never_a_live_credential_" + "x" * 8
POLICY = {"evaluation_contract_sha256": "sha256:" + "1" * 64,
          "allowed_issuer_key_ids": ["sha256:" + "2" * 64], "allowed_formats": ["onnx"],
          "allowed_parent_sha256": [], "require_artifact_binding": True,
          "require_behavioral_replay": True, "max_accuracy_loss_ppm": 2000,
          "max_decision_changes_ppm": 1000}
POLICY_HASH = client.digest(client.canonical(POLICY))
RECEIPT_HASH = client.digest(client.canonical(json.loads(FIXTURE.read_text())))


def success(**overrides):
    return {"receipt_sha256": RECEIPT_HASH, "registered": True,
            "attestation_status": "ATTESTATION_VERIFIED", "artifact_status": "NOT_CHECKED",
            "replay_status": "NOT_PERFORMED", "deployment_authorized": False,
            "policy_sha256": POLICY_HASH, "policy_version": 1, "lineage_status": "NOT_CHECKED",
            "required_local_checks": ["artifact_binding", "behavioral_replay"], "replayed": False,
            **overrides}


class LocalRuntime(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), Handler)
        self.records = []
        self.reply = success()
        self.policy = {"sha256": POLICY_HASH, "version": 1, "policy": POLICY}
        self.status = 200
        self.raw_reply = None
        self.extra_headers = {}
        self.delay = 0


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.respond("GET")

    def do_POST(self):
        self.respond("POST")

    def respond(self, method):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b""
        self.server.records.append({"method": method, "path": self.path,
                                    "headers": dict(self.headers), "body": body})
        if self.server.delay:
            time.sleep(self.server.delay)
        status = self.server.status
        raw = self.server.raw_reply
        if raw is None:
            raw = client.canonical(self.server.policy if method == "GET" else self.server.reply)
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            if "Content-Length" not in self.server.extra_headers:
                self.send_header("Content-Length", str(len(raw)))
            for key, value in self.server.extra_headers.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass


class RegistrationWire(unittest.TestCase):
    def setUp(self):
        self.runtime = LocalRuntime()
        self.thread = threading.Thread(target=self.runtime.serve_forever, daemon=True)
        self.thread.start()
        self.origin = "http://127.0.0.1:" + str(self.runtime.server_port)

    def tearDown(self):
        self.runtime.shutdown()
        self.runtime.server_close()
        self.thread.join(timeout=2)

    def invoke(self, *extra, receipt=FIXTURE, environment=None):
        arguments = ["--runtime-url", self.origin, "--allow-loopback-http", "--organization", "test-org",
                     "--receipt", str(receipt), "--expected-policy-sha256", POLICY_HASH, *extra]
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, {"MFENX_GATE_TOKEN": TOKEN, **(environment or {})}), redirect_stdout(stdout), redirect_stderr(stderr):
            status = client.main(arguments)
        self.assertNotIn(TOKEN, stdout.getvalue() + stderr.getvalue())
        return status, stdout.getvalue(), stderr.getvalue()

    def test_real_http_contract_is_metadata_minimal_and_explicitly_not_deployment(self):
        status, output, error = self.invoke(environment={"HTTP_PROXY": "http://127.0.0.1:1",
                                                       "HTTPS_PROXY": "http://127.0.0.1:1",
                                                       "ALL_PROXY": "http://127.0.0.1:1", "NO_PROXY": ""})
        self.assertEqual(status, 0, error)
        result = json.loads(output)
        self.assertEqual(result, success())
        self.assertEqual(len(self.runtime.records), 2)
        before, registered = self.runtime.records
        self.assertEqual((before["method"], before["path"]), ("GET", "/v1/orgs/test-org/policies/current"))
        self.assertEqual((registered["method"], registered["path"]), ("POST", "/v1/orgs/test-org/receipts"))
        body = json.loads(registered["body"])
        self.assertEqual(body, {"receipt_json": FIXTURE.read_text(), "retain_metadata": False})
        for request in self.runtime.records:
            self.assertEqual(request["headers"]["Authorization"], "Bearer " + TOKEN)
            self.assertNotIn(TOKEN, request["path"])
        self.assertRegex(registered["headers"]["Idempotency-Key"], r"^mfenx-[0-9a-f]{64}$")

    def test_same_receipt_org_retries_use_same_key_even_if_whitespace_or_metadata_changes(self):
        self.assertEqual(self.invoke()[0], 0)
        original = self.runtime.records[-1]["headers"]["Idempotency-Key"]
        with tempfile.TemporaryDirectory() as directory:
            reformatted = Path(directory) / "receipt.json"
            reformatted.write_text(json.dumps(json.loads(FIXTURE.read_text()), indent=2))
            self.assertEqual(self.invoke("--retain-metadata", receipt=reformatted)[0], 0)
        posted = self.runtime.records[-1]
        self.assertEqual(posted["headers"]["Idempotency-Key"], original)
        self.assertTrue(json.loads(posted["body"])["retain_metadata"])
        # The real runtime, not this wire stub, rejects changed metadata under this key.

    def test_policy_mismatch_fails_before_post(self):
        self.runtime.policy = {"sha256": "sha256:" + "0" * 64, "version": 1, "policy": POLICY}
        self.assertNotEqual(self.invoke()[0], 0)
        self.assertEqual([item["method"] for item in self.runtime.records], ["GET"])

    def test_policy_digest_cannot_lie_about_body(self):
        self.runtime.policy = {"sha256": POLICY_HASH, "version": 1, "policy": {"unexpected": True}}
        self.assertNotEqual(self.invoke()[0], 0)
        self.assertEqual(len(self.runtime.records), 1)

    def test_policy_race_result_is_not_accepted_as_success(self):
        self.runtime.reply = success(policy_version=2)
        status, output, error = self.invoke()
        self.assertEqual(status, 1)
        self.assertEqual(output, "")
        self.assertIn("registration may have occurred", error)
        self.assertEqual(len(self.runtime.records), 2)

    def test_malformed_or_overclaiming_results_never_succeed(self):
        for change in ({"registered": False}, {"registered": 1}, {"deployment_authorized": True},
                       {"artifact_status": "MATCH"}, {"replay_status": "PERFORMED"},
                       {"receipt_sha256": "sha256:" + "0" * 64}, {"policy_sha256": "sha256:" + "0" * 64},
                       {"policy_version": True}, {"replayed": "false"}, {"required_local_checks": [[]]},
                       {"required_local_checks": []}, {"lineage_status": "APPROVED_PARENT"},
                       {"required_local_checks": ["artifact_binding", "artifact_binding"]}):
            with self.subTest(change=change):
                self.runtime.reply = success(**change)
                self.assertNotEqual(self.invoke()[0], 0)

    def test_http_errors_never_echo_server_body_or_follow_redirects(self):
        for code in (302, 307, 401, 403, 404, 409, 422, 429, 503):
            with self.subTest(code=code):
                self.runtime.status = code
                self.runtime.raw_reply = ("sensitive body " + TOKEN).encode()
                self.runtime.extra_headers = {"Location": self.origin + "/steal"}
                self.runtime.records.clear()
                status, output, error = self.invoke()
                self.assertEqual(status, 1)
                self.assertEqual(output, "")
                self.assertIn(str(code), error)
                self.assertNotIn("sensitive body", error)
                self.assertEqual(len(self.runtime.records), 1)

    def test_response_size_and_strict_json_bounds(self):
        for raw in (b'{"key":1,"key":2}', b'{"x":NaN}', b'{"x":1.5}', b'[]', b'x' * 65537,
                    b'{"secret":' + b'[' * 30 + b'0' + b']' * 30 + b'}'):
            with self.subTest(raw=raw[:30]):
                self.runtime.raw_reply = raw
                self.assertEqual(self.invoke()[0], 1)
        self.runtime.raw_reply = b'{}'
        self.runtime.extra_headers = {"Content-Length": "999999999"}
        self.assertEqual(self.invoke()[0], 1)

    def test_encoding_and_media_type_are_not_silently_adopted(self):
        self.runtime.extra_headers = {"Content-Encoding": "gzip"}
        self.assertEqual(self.invoke()[0], 1)

    def test_incomplete_http_body_is_rejected_before_post(self):
        self.runtime.extra_headers = {"Content-Length": str(len(client.canonical(self.runtime.policy)) + 1)}
        self.assertEqual(self.invoke()[0], 1)
        self.assertEqual(len(self.runtime.records), 1)

    def test_overall_deadline_bounds_an_unresponsive_peer(self):
        self.runtime.delay = 3
        start = time.monotonic()
        status, _, _ = self.invoke("--timeout", "1")
        self.assertEqual(status, 1)
        self.assertLess(time.monotonic() - start, 2.5)

    def test_missing_malformed_token_and_non_receipt_file_send_nothing(self):
        for token in ("", "Bearer " + TOKEN, TOKEN + "\r\nInjected: yes"):
            self.assertEqual(self.invoke(environment={"MFENX_GATE_TOKEN": token})[0], 1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "license.json"
            path.write_text('{"schema":"not-a-receipt"}')
            self.assertEqual(self.invoke(receipt=path)[0], 1)
        self.assertEqual(self.runtime.records, [])


class InputAndPublication(unittest.TestCase):
    def test_https_origin_and_loopback_only_opt_in(self):
        self.assertEqual(client.runtime_origin("https://gate.customer.example:8443/"), ("https", "gate.customer.example", 8443))
        self.assertEqual(client.runtime_origin("http://[::1]:8090", True), ("http", "::1", 8090))
        for value in ("http://127.0.0.1", "http://customer.example", "https://user:secret@customer.example",
                      "https://customer.example/path", "https://customer.example?", "https://customer.example#",
                      "https://customer.example\n", "https://customer.example:0", "https://customer.example:65536",
                      "https://customer.example\\evil", "file:///private/receipt.json"):
            with self.subTest(value=value):
                with self.assertRaises(client.RegistrationError):
                    client.runtime_origin(value)
        for value in ("http://localhost:8090", "http://127.0.0.1.evil", "http://192.168.1.1", "http://2130706433"):
            with self.assertRaises(client.RegistrationError):
                client.runtime_origin(value, True)

    def test_bounded_regular_file_only(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            path = folder / "receipt.json"
            for data in (b"", b"x" * 60001, b'{"schema":1,"schema":2}', b'{}'):
                path.write_bytes(data)
                with self.assertRaises(client.RegistrationError):
                    client.read_receipt(path)
            path.write_bytes(FIXTURE.read_bytes())
            link = folder / "link.json"
            link.symlink_to(path)
            with self.assertRaises(client.RegistrationError):
                client.read_receipt(link)
            with self.assertRaises(client.RegistrationError):
                client.read_receipt(folder)
            if hasattr(os, "mkfifo"):
                fifo = folder / "pipe"
                os.mkfifo(fifo)
                start = time.monotonic()
                with self.assertRaises(client.RegistrationError):
                    client.read_receipt(fifo)
                self.assertLess(time.monotonic() - start, 1)

    def test_argument_errors_do_not_echo_secret_like_arguments(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--token", TOKEN], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(TOKEN, result.stdout + result.stderr)

    def test_documentation_download_digest_and_limits(self):
        docs = (ROOT / "public/docs/runtime/index.html").read_text()
        for required in ('id="register"', 'href="/gate/downloads/register_receipt.py" download',
                         hashlib.sha256(SCRIPT.read_bytes()).hexdigest(), "MFENX_GATE_TOKEN",
                         "policies:read", "receipts:write", "--expected-policy-sha256", "--retain-metadata",
                         "deployment_authorized", "NOT_PERFORMED", "409", "unchanged", "customer"):
            self.assertIn(required, docs)
        self.assertIn('href="/docs/runtime/#register"', (ROOT / "public/docs/index.html").read_text())
        self.assertNotRegex(SCRIPT.read_text(), r"https://(?:license|api)\.mfenx\.com")
        self.assertNotIn("urllib.request", SCRIPT.read_text())
        self.assertNotIn("subprocess", SCRIPT.read_text())
        self.assertNotIn("PRIVATE KEY", SCRIPT.read_text())

    def test_documented_shell_preserves_client_failure_without_leaking_token(self):
        docs = (ROOT / "public/docs/runtime/index.html").read_text()
        snippet = re.search(r"<pre><code>(\(\n.*?\n\))</code></pre>", docs, re.S).group(1)
        self.assertIn("set +x", snippet)
        self.assertIn("MFENX_GATE_TOKEN || exit 1", snippet)
        parsed = subprocess.run(["bash", "-n"], input=snippet, text=True, capture_output=True, timeout=5)
        self.assertEqual(parsed.returncode, 0, parsed.stderr)
        # The fake client must be the last command in the subshell, so its error survives.
        source = "python3() { return 7; }\n" + snippet
        result = subprocess.run(["bash", "-c", source], input=TOKEN + "\n", text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 7)
        self.assertNotIn(TOKEN, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
