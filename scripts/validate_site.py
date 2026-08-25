#!/usr/bin/env python3
"""Dependency-free validation for the exact MFENX Pages payload."""

from __future__ import annotations

import argparse
import json
import re
import stat
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


REQUIRED_FILES = (
    ".nojekyll",
    "CNAME",
    "favicon.ico",
    "index.html",
    "app.css",
    "app.js",
    "campaign.html",
    "register.html",
    "status.html",
    "slbit.html",
    "ckodmk/index.html",
    "lightsout/index.html",
    "lightsout/current-release/COMMERCIAL-STATUS.canonical.json",
    "lightsout/current-release/COMMERCIAL-STATUS.canonical.json.sig",
    "lightsout/current-release/COMMERCIAL-STATUS.schema.json",
    "lightsout/current-release/allowed_signers",
    "lightsout/current-release/release-signing-key.pub",
    "sain/index.html",
    "tessaryn/index.html",
    "network/177155.json",
    "THIRD_PARTY_NOTICES.md",
    "vendor/lucide/LICENSE",
    "vendor/three.LICENSE.txt",
)

PROHIBITED_LIGHTSOUT_PREFIXES = (
    "lightsout/step2/",
    "lightsout/candidate/",
    "lightsout/contract-v1/release/",
    "lightsout/release/bin/",
    "lightsout/release-v1/bin/",
    "lightsout/validation-record/",
)

PROHIBITED_LIGHTSOUT_PATHS = (
    "lightsout/contract-v1/claim_ledger.md",
)

PROHIBITED_LIGHTSOUT_SUFFIXES = (
    ".7z",
    ".a",
    ".dll",
    ".dylib",
    ".exe",
    ".o",
    ".py",
    ".pyc",
    ".pyo",
    ".rs",
    ".so",
    ".tar",
    ".tar.gz",
    ".tar.zst",
    ".tgz",
    ".zip",
    ".zst",
)

PRIVATE_PATTERNS = (
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(rb"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(rb"ghp_[A-Za-z0-9]{20,}"),
    re.compile(rb"AKIA[0-9A-Z]{16}"),
)

TEXT_SUFFIXES = {
    "",
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".mjs",
    ".svg",
    ".txt",
    ".webmanifest",
    ".xml",
    ".yaml",
    ".yml",
}


class ReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if not value:
                continue
            if name in {"href", "src", "poster", "manifest"}:
                self.references.append((name, value))
            elif name == "srcset":
                for candidate in value.split(","):
                    url = candidate.strip().split(" ", 1)[0]
                    if url:
                        self.references.append((name, url))


def local_target(root: Path, source: Path, raw: str) -> Path | None:
    raw = raw.strip()
    if not raw or raw.startswith(("#", "//")):
        return None
    if "${" in raw or "{{" in raw:
        return None
    parsed = urlsplit(raw)
    if parsed.scheme or parsed.netloc:
        return None
    path = unquote(parsed.path)
    if not path:
        return None
    target = root / path.lstrip("/") if path.startswith("/") else source.parent / path
    target = target.resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return Path("/__outside_public_root__")
    if target.is_dir() or path.endswith("/"):
        target /= "index.html"
    return target


def validate(root: Path) -> list[str]:
    errors: list[str] = []
    root = root.resolve()

    for relative in REQUIRED_FILES:
        if not (root / relative).is_file():
            errors.append(f"missing required production file: {relative}")

    cname = root / "CNAME"
    if cname.is_file() and cname.read_text(encoding="utf-8").strip() != "mfenx.com":
        errors.append("CNAME must contain exactly mfenx.com")

    files = sorted(path for path in root.rglob("*") if path.is_file() or path.is_symlink())
    for path in files:
        relative = path.relative_to(root).as_posix()
        lower = relative.lower()

        if path.is_symlink():
            errors.append(f"symlink is not allowed in production payload: {relative}")
            continue

        mode = path.stat().st_mode
        if mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH):
            errors.append(f"executable file mode is not allowed: {relative}")

        if lower.startswith(".github/") or "/.git/" in f"/{lower}/":
            errors.append(f"repository control file leaked into production payload: {relative}")

        if lower.endswith(".map"):
            errors.append(f"source map is not allowed in the production payload: {relative}")

        if lower.startswith("lightsout/"):
            if lower in PROHIBITED_LIGHTSOUT_PATHS:
                errors.append(f"prohibited Lights Out publication file: {relative}")
            if any(lower.startswith(prefix) for prefix in PROHIBITED_LIGHTSOUT_PREFIXES):
                errors.append(f"prohibited Lights Out publication path: {relative}")
            if any(lower.endswith(suffix) for suffix in PROHIBITED_LIGHTSOUT_SUFFIXES):
                errors.append(f"prohibited Lights Out executable/source/archive type: {relative}")
            if "/bin/" in f"/{lower}":
                errors.append(f"prohibited Lights Out binary directory: {relative}")
            if path.name in {"Cargo.lock", "Cargo.toml", "test-commercial-ui.mjs"}:
                errors.append(f"prohibited Lights Out source/test file: {relative}")
            header = path.read_bytes()[:4]
            if header.startswith((b"\x7fELF", b"MZ")) or header in {
                b"\xca\xfe\xba\xbe",
                b"\xce\xfa\xed\xfe",
                b"\xcf\xfa\xed\xfe",
                b"\xfe\xed\xfa\xce",
                b"\xfe\xed\xfa\xcf",
            }:
                errors.append(f"prohibited Lights Out executable object: {relative}")

        if path.stat().st_size <= 8 * 1024 * 1024:
            data = path.read_bytes()
            for pattern in PRIVATE_PATTERNS:
                if pattern.search(data):
                    errors.append(f"possible credential or private key in: {relative}")
                    break

        if path.suffix.lower() == ".json":
            try:
                json.loads(path.read_text(encoding="utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                errors.append(f"invalid JSON {relative}: {exc}")

        if path.suffix.lower() == ".html":
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError as exc:
                errors.append(f"invalid UTF-8 HTML {relative}: {exc}")
                continue
            parser = ReferenceParser()
            parser.feed(text)
            for attribute, raw in parser.references:
                target = local_target(root, path, raw)
                if target is not None and not target.is_file():
                    errors.append(
                        f"broken local {attribute} in {relative}: {raw}"
                    )

        if path.suffix.lower() in TEXT_SUFFIXES and path.stat().st_size <= 8 * 1024 * 1024:
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if "JROChub/mfenx-local-supercomputer" in text:
                errors.append(f"private product repository reference published in: {relative}")
            if "sourceMappingURL" in text and path.suffix.lower() in {".js", ".mjs"}:
                errors.append(f"dangling source-map directive published in: {relative}")
            if lower.startswith("lightsout/"):
                lowered_text = text.lower()
                for prohibited in (
                    "jrochub/power_house",
                    "apache-2.0",
                    "claim_ledger.md",
                    "not established; do not claim",
                    "open-source",
                    "open_source",
                ):
                    if prohibited in lowered_text:
                        errors.append(f"prohibited first-party Lights Out term {prohibited!r} in: {relative}")

    homepage_sources = [root / "index.html", root / "app.js", root / "bootstrap.js"]
    for path in homepage_sources:
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8").lower()
        for prohibited in (
            "rpc.mfenx.com",
            "status.html",
            "campaign.html",
            "register.html",
            "refreshnetworkstatus",
        ):
            if prohibited in text:
                errors.append(f"homepage exposes unavailable network feature {prohibited!r} in: {path.name}")

    product_page = root / "lightsout/index.html"
    if product_page.is_file():
        product_text = product_page.read_text(encoding="utf-8")
        product_lower = product_text.lower()
        for required in (
            "a local <em>supercomputer</em>",
            "release v0.1.3",
            'id="hero-current-release"',
            'id="qqfenx"',
            "qqfenx",
            "32 → 8 → 0",
            "q8 · q16 · q24 · q32",
            "standalone full-ring replay",
            "how it works",
            "commercial-licensing.html",
        ):
            if required not in product_lower:
                errors.append(f"Lights Out product page is missing required current-release content {required!r}")
        for prohibited in (
            "hackathon",
            "devpost",
            "we do not claim",
            "claim-boundary",
            "trust-boundary",
        ):
            if prohibited in product_lower:
                errors.append(f"Lights Out product page contains prohibited public-page language {prohibited!r}")

    total_bytes = sum(path.stat().st_size for path in files if path.is_file())
    print(f"validated {len(files)} production files ({total_bytes} bytes)")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()

    if not args.root.is_dir():
        print(f"production root does not exist: {args.root}", file=sys.stderr)
        return 2

    errors = validate(args.root)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("production payload validation: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
