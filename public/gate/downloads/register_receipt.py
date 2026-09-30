#!/usr/bin/env python3
"""Register a compact receipt with a customer-operated MFENX Gate runtime.

Python 3.11+ standard library only. This is an integration sample, not a receipt
verifier, model evaluator, license client or deployment authorization mechanism.
Authenticate the downloaded script before execution and verify the receipt and
artifact locally using the independently trusted Gate verifier first.
"""

import argparse
import hashlib
import http.client
import ipaddress
import json
import os
import queue
import re
import socket
import ssl
import stat
import sys
import threading
from urllib.parse import quote, urlsplit


MAX_RECEIPT = 60_000
MAX_RESPONSE = 65_536
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
IDENTIFIER = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
TOKEN = re.compile(r"mfg_[A-Za-z0-9_-]{32,128}\Z")


class RegistrationError(Exception):
    """A deliberately non-sensitive, user-facing error."""


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default diagnostics echo arbitrary argument values.
        self.exit(2, "Invalid arguments; use --help. Credentials belong only in MFENX_GATE_TOKEN.\n")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("ascii")


def digest(value):
    return "sha256:" + hashlib.sha256(value).hexdigest()


def parse_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate key")
            result[key] = value
        return result

    def reject(_):
        raise ValueError("Unsupported number")

    def inspect(value, depth=0):
        if depth > 16:
            raise ValueError("Too deeply nested")
        if value is None or type(value) is bool:
            return
        if type(value) is int and abs(value) <= 2**53 - 1:
            return
        if type(value) is str and value.isascii() and len(value) <= 4096:
            return
        if type(value) is dict and len(value) <= 64:
            for key, item in value.items():
                if not key.isascii() or len(key) > 128:
                    raise ValueError("Unsupported key")
                inspect(item, depth + 1)
            return
        if type(value) is list and len(value) <= 64:
            for item in value:
                inspect(item, depth + 1)
            return
        raise ValueError("Unsupported JSON value")

    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=pairs,
                           parse_float=reject, parse_constant=reject)
        inspect(value)
        if type(value) is not dict:
            raise ValueError("Object required")
        return value
    except (ValueError, UnicodeError, RecursionError):
        raise RegistrationError("Bounded ASCII JSON object required; duplicate keys and non-integer numbers are rejected.") from None


def read_receipt(path):
    # Refuse devices, FIFOs and a final symlink without waiting for a writer.
    flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        if stat.S_ISLNK(os.lstat(path).st_mode):
            raise RegistrationError("Receipt must be a regular file, not a symlink.")
        with os.fdopen(os.open(path, flags), "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_RECEIPT:
                raise RegistrationError("Receipt must be a regular file of 1–60000 bytes.")
            raw = source.read(MAX_RECEIPT + 1)
    except OSError:
        raise RegistrationError("Cannot read the receipt as a regular file.") from None
    if not 0 < len(raw) <= MAX_RECEIPT:
        raise RegistrationError("Receipt must contain 1–60000 bytes.")
    value = parse_json(raw)
    if (set(value) != {"schema", "issuer", "root_id", "signature", "statement"}
            or value.get("schema") != "mfenx/release-receipt/v1"):
        raise RegistrationError("Select a compact Release Receipt v1 JSON file, not a model or license document.")
    return raw.decode("ascii"), digest(canonical(value))


def runtime_origin(value, allow_loopback_http=False):
    try:
        if not value.isascii() or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError()
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
        if (not host or parsed.username is not None or parsed.password is not None
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or "?" in value or "#" in value or "\\" in value or "%" in value):
            raise ValueError()
        if parsed.scheme == "http":
            # A literal loopback address cannot be changed through DNS resolution.
            if not allow_loopback_http or not ipaddress.ip_address(host).is_loopback:
                raise ValueError()
        elif parsed.scheme != "https":
            raise ValueError()
        if port is not None and not 1 <= port <= 65535:
            raise ValueError()
    except (ValueError, TypeError):
        raise RegistrationError("Use an HTTPS runtime origin without credentials, path, query or fragment; development HTTP requires a literal loopback address and --allow-loopback-http.") from None
    return parsed.scheme, host, port


class Transport:
    def __init__(self, origin, token, timeout):
        self.origin, self.token, self.timeout = origin, token, timeout
        self.cancelled = threading.Event()
        self.connection = None

    def close(self):
        self.cancelled.set()
        connection = self.connection
        if connection is not None:
            if connection.sock is not None:
                try:
                    connection.sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            connection.close()

    def request(self, method, path, body=None, idempotency=None):
        if self.cancelled.is_set():
            raise RegistrationError("Request cancelled.")
        scheme, host, port = self.origin
        if scheme == "https":
            connection = http.client.HTTPSConnection(host, port, timeout=self.timeout,
                                                      context=ssl.create_default_context())
        else:
            connection = http.client.HTTPConnection(host, port, timeout=self.timeout)
        self.connection = connection
        headers = {"Authorization": "Bearer " + self.token, "Accept": "application/json",
                   "Accept-Encoding": "identity", "Connection": "close"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if idempotency is not None:
            headers["Idempotency-Key"] = idempotency
        response = None
        try:
            connection.connect()
            if self.cancelled.is_set():
                raise RegistrationError("Request cancelled.")
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            # http.client never follows redirects and never reads proxy/netrc settings.
            if response.status != 200:
                meanings = {401: "credentials rejected", 403: "membership or token scope denied",
                            404: "runtime route or organization policy missing", 409: "policy or idempotency conflict",
                            422: "receipt or policy rejected", 429: "registration allowance reached",
                            503: "licensed runtime unavailable"}
                label = "redirect refused" if 300 <= response.status < 400 else meanings.get(response.status, "request rejected")
                raise RegistrationError(f"Runtime HTTP {response.status}: {label}.")
            lengths = response.headers.get_all("Content-Length", [])
            if len(lengths) > 1 or (lengths and (not lengths[0].isdigit() or int(lengths[0]) > MAX_RESPONSE)):
                raise RegistrationError("Runtime response exceeds the size limit or has an invalid length.")
            if response.getheader("Content-Encoding", "identity").lower() != "identity":
                raise RegistrationError("Compressed runtime responses are not accepted.")
            if response.getheader("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                raise RegistrationError("Runtime did not return JSON.")
            raw = response.read(MAX_RESPONSE + 1)
            if not raw or len(raw) > MAX_RESPONSE:
                raise RegistrationError("Runtime response must contain 1–65536 bytes.")
            if lengths and len(raw) != int(lengths[0]):
                raise RegistrationError("Runtime response was incomplete.")
            return parse_json(raw)
        except (OSError, http.client.HTTPException):
            raise RegistrationError("Runtime connection failed; check customer network and TLS configuration.") from None
        finally:
            if response is not None:
                response.close()
            connection.close()


def register(transport, organization, receipt_json, receipt_sha256, expected_policy, retain_metadata=False):
    path = "/v1/orgs/" + quote(organization, safe="")
    policy = transport.request("GET", path + "/policies/current")
    if (policy.get("sha256") != expected_policy or type(policy.get("version")) is not int
            or policy["version"] < 1 or type(policy.get("policy")) is not dict
            or type(policy["policy"].get("require_artifact_binding")) is not bool
            or type(policy["policy"].get("require_behavioral_replay")) is not bool
            or type(policy["policy"].get("allowed_parent_sha256")) is not list
            or digest(canonical(policy["policy"])) != expected_policy):
        raise RegistrationError("Current runtime policy does not match the independently approved policy digest; nothing was registered.")
    # Same canonical receipt + organization always produces the same retry key.
    # Changing policy or metadata selection deliberately does not evade conflicts.
    retry_key = "mfenx-" + hashlib.sha256(canonical({"organization": organization,
                                                    "receipt_sha256": receipt_sha256})).hexdigest()
    result = transport.request("POST", path + "/receipts",
                               canonical({"receipt_json": receipt_json, "retain_metadata": retain_metadata}), retry_key)
    checks = result.get("required_local_checks")
    expected_checks = (["artifact_binding"] if policy["policy"]["require_artifact_binding"] else [])
    expected_checks += (["behavioral_replay"] if policy["policy"]["require_behavioral_replay"] else [])
    expected_lineage = "APPROVED_PARENT" if policy["policy"]["allowed_parent_sha256"] else "NOT_CHECKED"
    if (result.get("registered") is not True or result.get("receipt_sha256") != receipt_sha256
            or result.get("policy_sha256") != expected_policy or result.get("policy_version") != policy["version"]
            or type(result.get("policy_version")) is not int or type(result.get("replayed")) is not bool
            or result.get("attestation_status") != "ATTESTATION_VERIFIED"
            or result.get("artifact_status") != "NOT_CHECKED" or result.get("replay_status") != "NOT_PERFORMED"
            or result.get("deployment_authorized") is not False
            or result.get("lineage_status") != expected_lineage
            or type(checks) is not list
            or any(type(item) is not str or item not in ("artifact_binding", "behavioral_replay") for item in checks)
            or len(checks) != len(set(checks)) or checks != expected_checks):
        raise RegistrationError("Runtime result did not match the expected receipt, policy or registration-only boundary.")
    # Never echo server-controlled prose, receipt contents, URL or credentials.
    return {key: result[key] for key in ("receipt_sha256", "registered", "attestation_status",
            "artifact_status", "replay_status", "deployment_authorized", "policy_sha256",
            "policy_version", "lineage_status", "required_local_checks", "replayed")}


def main(argv=None):
    parser = SafeParser(description=__doc__)
    parser.add_argument("--runtime-url", required=True, help="Explicit customer HTTPS origin, never the MFENX license host")
    parser.add_argument("--organization", required=True)
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--expected-policy-sha256", required=True, help="Independently approved organization policy digest (not evaluation contract digest)")
    parser.add_argument("--retain-metadata", action="store_true", help="Explicitly retain searchable receipt metadata in your runtime")
    parser.add_argument("--allow-loopback-http", action="store_true", help="Development only: permit HTTP to a literal loopback address")
    parser.add_argument("--timeout", type=int, default=20, choices=range(1, 61), metavar="1..60", help="Overall network deadline in seconds (default 20)")
    args = parser.parse_args(argv)
    transport = None
    try:
        origin = runtime_origin(args.runtime_url, args.allow_loopback_http)
        if not IDENTIFIER.fullmatch(args.organization) or not DIGEST.fullmatch(args.expected_policy_sha256):
            raise RegistrationError("A valid organization identifier and sha256: lowercase policy digest are required.")
        token = os.environ.get("MFENX_GATE_TOKEN", "")
        if not TOKEN.fullmatch(token):
            raise RegistrationError("Set MFENX_GATE_TOKEN to a customer runtime scoped token with policies:read and receipts:write.")
        receipt_json, receipt_sha256 = read_receipt(args.receipt)
        transport = Transport(origin, token, min(args.timeout, 10))
        results = queue.Queue(maxsize=1)

        def work():
            try:
                results.put(register(transport, args.organization, receipt_json, receipt_sha256,
                                     args.expected_policy_sha256, args.retain_metadata))
            except RegistrationError as error:
                results.put(error)
            except Exception:
                results.put(RegistrationError("Unexpected runtime response; no unvalidated result was accepted."))

        # A daemon worker bounds even a peer trickling HTTP headers or body bytes.
        # On failure/timeout a POST may already have been accepted; never auto-retry.
        threading.Thread(target=work, daemon=True).start()
        try:
            result = results.get(timeout=args.timeout)
        except queue.Empty:
            raise RegistrationError("Overall runtime request deadline exceeded.") from None
        if isinstance(result, RegistrationError):
            raise result
        print(json.dumps(result, sort_keys=True, indent=2))
        return 0
    except RegistrationError as error:
        print("Registration failed: " + str(error), file=sys.stderr)
        print("If a POST was sent, registration may have occurred. Retry only the unchanged receipt, organization, policy and metadata choice. This tool never authorizes deployment.", file=sys.stderr)
        return 1
    finally:
        if transport is not None:
            transport.close()


if __name__ == "__main__":
    raise SystemExit(main())
