"""Local authenticated delivery manifests; no downloads, key generation or grants.

The release signing key and its independently trusted public fingerprint are
operator inputs. No key embedded in a manifest is trusted to authenticate it.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
from urllib.parse import urlsplit

from cryptography.exceptions import InvalidSignature, UnsupportedAlgorithm
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

DOMAIN = b"MFENX-GATE-DELIVERY-MANIFEST-V1\n"
SCHEMA = "mfenx.gate.delivery-manifest.v1"
PRODUCT = "mfenx-gate-licensed-runtime"
TARGET = "CPython 3.13 / Linux x86_64 / glibc >= 2.34"
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:rc[1-9][0-9]*)?")
SHA256 = re.compile(r"sha256:[0-9a-f]{64}")
MAX_ARCHIVE = 256 * 1024 * 1024
MAX_MANIFEST = 16384
MAX_VERIFIER = 65536
MAX_LIFETIME = 366 * 86400


class DeliveryError(ValueError):
    pass


def sha256(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                      allow_nan=False).encode("ascii")


def strict_json(raw):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise DeliveryError("Duplicate manifest field")
            value[key] = item
        return value
    def invalid_number(_value):
        raise DeliveryError("Manifest requires integral finite numbers")
    if not 0 < len(raw) <= MAX_MANIFEST:
        raise DeliveryError("Manifest size rejected")
    try:
        value = json.loads(raw, object_pairs_hook=unique, parse_float=invalid_number, parse_constant=invalid_number)
        if canonical(value) != raw:
            raise DeliveryError("Manifest must use exact canonical JSON bytes")
        return value
    except (UnicodeError, RecursionError, TypeError, json.JSONDecodeError):
        raise DeliveryError("Invalid manifest JSON") from None


def directory_fd(path):
    if not path.is_absolute() or ".." in path.parts:
        raise DeliveryError("An absolute non-traversing path is required")
    descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def read_regular(path, maximum, *, private=False):
    directory = directory_fd(path.parent)
    try:
        descriptor = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    finally:
        os.close(directory)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= maximum:
            raise DeliveryError("Invalid input file")
        if private and (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600):
            raise DeliveryError("Signing key must be owner-held mode 0600")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            value = stream.read(maximum + 1)
        if len(value) != info.st_size:
            raise DeliveryError("Input changed or exceeded its bound")
        return value
    finally:
        os.close(descriptor)


def public_der(pem):
    try:
        key = serialization.load_pem_public_key(pem)
    except (ValueError, TypeError, UnsupportedAlgorithm):
        raise DeliveryError("Invalid public key") from None
    if not isinstance(key, Ed25519PublicKey):
        raise DeliveryError("Ed25519 public key required")
    return key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)


def origin(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 253 or not value.isascii():
        raise DeliveryError("Invalid HTTPS origin")
    try:
        parts = urlsplit(value)
        if (parts.scheme != "https" or not parts.hostname or parts.netloc != parts.hostname
                or parts.path or parts.query or parts.fragment or "?" in value or "#" in value
                or parts.username or parts.password
                or any(char.isspace() or ord(char) < 33 for char in value)):
            raise DeliveryError("Exact HTTPS origin required")
        if any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
               for label in parts.hostname.split(".")):
            raise DeliveryError("Invalid origin hostname")
    except ValueError:
        raise DeliveryError("Invalid HTTPS origin") from None
    return value


def exact_fields(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise DeliveryError("Manifest fields differ from contract")


def validate(manifest):
    exact_fields(manifest, ("schema", "product", "version", "target", "sequence", "issued_at", "expires_at",
                            "publisher_key_sha256", "archive", "license_issuer", "verifier"))
    if manifest["schema"] != SCHEMA or manifest["product"] != PRODUCT or manifest["target"] != TARGET:
        raise DeliveryError("Manifest product or target rejected")
    version = manifest["version"]
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise DeliveryError("Invalid release version")
    for name in ("sequence", "issued_at", "expires_at"):
        if type(manifest[name]) is not int or not 0 <= manifest[name] <= 2**53 - 1:
            raise DeliveryError("Invalid manifest integer")
    if manifest["sequence"] < 1 or not 0 < manifest["expires_at"] - manifest["issued_at"] <= MAX_LIFETIME:
        raise DeliveryError("Invalid manifest validity interval")
    if not isinstance(manifest["publisher_key_sha256"], str) or not SHA256.fullmatch(manifest["publisher_key_sha256"]):
        raise DeliveryError("Invalid publisher fingerprint")
    for key in ("archive", "verifier"):
        item = manifest[key]
        exact_fields(item, ("name", "bytes", "sha256", "download_url"))
        expected_name = f"{PRODUCT}-{version}-linux-x86_64-py313.tar.gz" if key == "archive" else "delivery_manifest.py"
        maximum = MAX_ARCHIVE if key == "archive" else MAX_VERIFIER
        if item["name"] != expected_name or type(item["bytes"]) is not int or not 0 < item["bytes"] <= maximum:
            raise DeliveryError("Artifact identity or size rejected")
        if not isinstance(item["sha256"], str) or not SHA256.fullmatch(item["sha256"]):
            raise DeliveryError("Artifact digest rejected")
        url = item["download_url"]
        if (not isinstance(url, str) or len(url) > 2048 or not url.isascii()
                or any(ord(char) <= 32 or ord(char) == 127 for char in url)):
            raise DeliveryError("Invalid delivery URL")
        parts = urlsplit(url)
        origin(parts.scheme + "://" + parts.netloc)
        if (parts.query or parts.fragment or "?" in url or "#" in url or not parts.path.endswith("/" + expected_name)
                or not re.fullmatch(r"/[A-Za-z0-9_./-]+", parts.path)
                or any(part in (".", "..", "") for part in parts.path.split("/")[1:])):
            raise DeliveryError("Ambiguous delivery URL rejected")
    issuer = manifest["license_issuer"]
    exact_fields(issuer, ("origin", "environment", "key_id", "public_key_spki_base64", "public_key_sha256"))
    origin(issuer["origin"])
    if issuer["environment"] not in ("live", "sandbox") or not isinstance(issuer["key_id"], str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", issuer["key_id"]):
        raise DeliveryError("Issuer environment or key ID rejected")
    try:
        der = base64.b64decode(issuer["public_key_spki_base64"], validate=True)
        key = serialization.load_der_public_key(der)
        if (not isinstance(key, Ed25519PublicKey) or len(der) > 128
                or key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo) != der
                or base64.b64encode(der).decode() != issuer["public_key_spki_base64"]
                or sha256(der) != issuer["public_key_sha256"]):
            raise DeliveryError("Issuer public key rejected")
    except (ValueError, TypeError, UnsupportedAlgorithm):
        raise DeliveryError("Issuer public key rejected") from None
    return manifest


def make_manifest(*, archive, download_url, verifier_url, version, sequence, issued_at, expires_at,
                  publisher_key, issuer_key, issuer_origin, issuer_key_id, environment):
    private = serialization.load_pem_private_key(read_regular(publisher_key, 8192, private=True), password=None)
    if not isinstance(private, Ed25519PrivateKey):
        raise DeliveryError("Ed25519 release signing key required")
    publisher = private.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    issuer = public_der(read_regular(issuer_key, 4096))
    if issuer == publisher:
        raise DeliveryError("Release and entitlement signing keys must be separate")
    raw_archive = read_regular(archive, MAX_ARCHIVE)
    verifier = read_regular(Path(__file__).absolute(), MAX_VERIFIER)
    manifest = {"schema": SCHEMA, "product": PRODUCT, "version": version, "target": TARGET,
        "sequence": sequence, "issued_at": issued_at, "expires_at": expires_at,
        "publisher_key_sha256": sha256(publisher),
        "archive": {"name": archive.name, "bytes": len(raw_archive), "sha256": sha256(raw_archive), "download_url": download_url},
        "verifier": {"name": "delivery_manifest.py", "bytes": len(verifier), "sha256": sha256(verifier), "download_url": verifier_url},
        "license_issuer": {"origin": issuer_origin, "environment": environment, "key_id": issuer_key_id,
            "public_key_spki_base64": base64.b64encode(issuer).decode(), "public_key_sha256": sha256(issuer)}}
    validate(manifest)
    raw = canonical(manifest)
    if len(raw) > MAX_MANIFEST:
        raise DeliveryError("Manifest size rejected")
    return raw, private.sign(DOMAIN + raw)


def verify_manifest(*, raw, signature, publisher_pem, publisher_fingerprint, archive,
                    expected_version, minimum_sequence, expected_origin, environment="live", now=None):
    manifest = validate(strict_json(raw))
    if not isinstance(publisher_fingerprint, str) or not SHA256.fullmatch(publisher_fingerprint):
        raise DeliveryError("Independent publisher fingerprint required")
    publisher = public_der(publisher_pem)
    if sha256(publisher) != publisher_fingerprint or manifest["publisher_key_sha256"] != publisher_fingerprint:
        raise DeliveryError("Publisher trust pin mismatch")
    if len(signature) != 64:
        raise DeliveryError("Invalid detached signature")
    try:
        serialization.load_der_public_key(publisher).verify(signature, DOMAIN + raw)
    except InvalidSignature:
        raise DeliveryError("Delivery signature rejected") from None
    instant = int(time.time()) if now is None else now
    if type(instant) is not int or not manifest["issued_at"] <= instant < manifest["expires_at"]:
        raise DeliveryError("Manifest outside its validity interval")
    if (type(minimum_sequence) is not int or minimum_sequence < 1 or manifest["sequence"] < minimum_sequence
            or not isinstance(expected_version, str) or not VERSION.fullmatch(expected_version)
            or manifest["version"] != expected_version):
        raise DeliveryError("Release version or sequence rejected")
    issuer = manifest["license_issuer"]
    if environment not in ("live", "sandbox") or issuer["environment"] != environment or issuer["origin"] != origin(expected_origin):
        raise DeliveryError("Entitlement issuer scope rejected")
    if issuer["public_key_sha256"] == publisher_fingerprint:
        raise DeliveryError("Release and entitlement keys are not separate")
    artifact = read_regular(archive, MAX_ARCHIVE)
    if (archive.name != manifest["archive"]["name"] or len(artifact) != manifest["archive"]["bytes"]
            or sha256(artifact) != manifest["archive"]["sha256"]):
        raise DeliveryError("Downloaded archive does not match release")
    verifier = read_regular(Path(__file__).absolute(), MAX_VERIFIER)
    if (len(verifier) != manifest["verifier"]["bytes"]
            or sha256(verifier) != manifest["verifier"]["sha256"]):
        raise DeliveryError("Verifier does not match release")
    return manifest


def write_new_directory(directory, files):
    parent = directory_fd(directory.parent)
    try:
        os.mkdir(directory.name, 0o700, dir_fd=parent)
        descriptor = os.open(directory.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    finally:
        os.close(parent)
    try:
        for name, data in files.items():
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=descriptor)
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="Sign a local delivery manifest with an externally supplied release key")
    create.add_argument("--archive", type=Path, required=True)
    create.add_argument("--download-url", required=True)
    create.add_argument("--verifier-url", required=True)
    create.add_argument("--version", required=True)
    create.add_argument("--sequence", type=int, required=True)
    create.add_argument("--issued-at", type=int, default=None)
    create.add_argument("--expires-at", type=int, required=True)
    create.add_argument("--publisher-key", type=Path, required=True)
    create.add_argument("--issuer-key", type=Path, required=True)
    create.add_argument("--issuer-origin", required=True)
    create.add_argument("--issuer-key-id", required=True)
    create.add_argument("--environment", choices=("live", "sandbox"), required=True)
    create.add_argument("--output", type=Path, required=True)
    verify = commands.add_parser("verify", help="Verify local release files and optionally export public issuer trust")
    for argument in ("manifest", "signature", "publisher-key", "archive"):
        verify.add_argument("--" + argument, type=Path, required=True)
    for argument in ("publisher-key-sha256", "expected-version", "expected-origin"):
        verify.add_argument("--" + argument, required=True)
    verify.add_argument("--minimum-sequence", type=int, required=True)
    verify.add_argument("--environment", choices=("live", "sandbox"), default="live")
    verify.add_argument("--trust-directory", type=Path)
    args = parser.parse_args(argv)
    if args.command == "create":
        options = vars(args).copy()
        output = options.pop("output")
        options.pop("command")
        if options["issued_at"] is None:
            options["issued_at"] = int(time.time())
        raw, signature = make_manifest(**options)
        write_new_directory(output, {"delivery-manifest.json": raw, "delivery-manifest.sig": signature})
        print(json.dumps({"created": True, "manifest_sha256": sha256(raw), "published": False}))
    else:
        manifest = verify_manifest(raw=read_regular(args.manifest, MAX_MANIFEST), signature=read_regular(args.signature, 64),
            publisher_pem=read_regular(args.publisher_key, 4096), publisher_fingerprint=args.publisher_key_sha256,
            archive=args.archive, expected_version=args.expected_version, minimum_sequence=args.minimum_sequence,
            expected_origin=args.expected_origin, environment=args.environment)
        if args.trust_directory is not None:
            issuer = manifest["license_issuer"]
            key = serialization.load_der_public_key(base64.b64decode(issuer["public_key_spki_base64"]))
            pem = key.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
            write_new_directory(args.trust_directory, {"trusted-license-issuer.pem": pem,
                "verified-release-trust.json": canonical({"release_version": manifest["version"],
                    "minimum_sequence": manifest["sequence"], "publisher_key_sha256": args.publisher_key_sha256,
                    "manifest_sha256": sha256(canonical(manifest)), "license_issuer": issuer})})
        print(json.dumps({"verified": True, "version": manifest["version"], "sequence": manifest["sequence"],
                          "environment": args.environment, "archive_sha256": manifest["archive"]["sha256"],
                          "issuer_key_id": manifest["license_issuer"]["key_id"], "license_granted": False}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (DeliveryError, OSError, ValueError, TypeError, UnsupportedAlgorithm) as error:
        print(json.dumps({"verified": False, "error": type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
