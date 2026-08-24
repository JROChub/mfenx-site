#!/usr/bin/env python3
"""Verify that every production asset is live with byte-identical content."""

from __future__ import annotations

import argparse
import hashlib
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlsplit
from urllib.request import Request, urlopen


BLOCKED_ROUTES = (
    "/README.md",
    "/LICENSE",
    "/SECURITY.md",
    "/docs/OPERATIONS.md",
    "/scripts/validate_site.py",
    "/.github/workflows/site.yml",
    "/lightsout/release/bin/mfenx-local",
    "/lightsout/release-v1/bin/mfenx-local",
    "/lightsout/step2/verifier/bin/mfenx-contract-v1-verifier",
    "/lightsout/candidate/README.md",
    "/lightsout/candidate/downloads/mfenx-local-v2-validation-candidate-20260822-a1-signed-x86_64-unknown-linux-gnu.tar.zst",
    "/lightsout/contract-v1/release/RELEASE-MANIFEST.canonical.json",
    "/lightsout/contract-v1/release/mfenx-local-v2.sbom.cdx.json",
    "/lightsout/validation-record/validation-status.json",
    "/lightsout/validation-record/release/VALIDATION-RECORD.canonical.json",
    "/lightsout/validation-record/inputs/commercial_evaluation_distribution_archive/mfenx-apache-technical-evaluation-20260822-a1-x86_64-unknown-linux-gnu.tar.zst",
)


def request_bytes(url: str, timeout: float = 30.0) -> tuple[int, bytes, str]:
    request = Request(
        url,
        headers={
            "Accept-Encoding": "identity",
            "Cache-Control": "no-cache",
            "User-Agent": "mfenx-production-verifier/1",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, response.read(), response.geturl()
    except HTTPError as exc:
        return exc.code, exc.read(), exc.geturl()


def public_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and not path.relative_to(root).as_posix().startswith(".")
    )


def live_url(origin: str, relative: str) -> str:
    encoded = "/".join(quote(part, safe="") for part in relative.split("/"))
    return urljoin(origin.rstrip("/") + "/", encoded)


def verify_file(root: Path, origin: str, path: Path) -> str | None:
    relative = path.relative_to(root).as_posix()
    expected = hashlib.sha256(path.read_bytes()).hexdigest()
    url = live_url(origin, relative) + "?mfenx_verify=" + expected[:16]
    last = "no response"
    for delay in (0.0, 1.0, 2.0, 4.0):
        if delay:
            time.sleep(delay)
        try:
            status, body, final_url = request_bytes(url)
        except (TimeoutError, URLError) as exc:
            last = f"request failed: {exc}"
            continue
        if urlsplit(final_url).netloc != urlsplit(origin).netloc:
            return f"{relative}: redirected outside canonical host to {final_url}"
        observed = hashlib.sha256(body).hexdigest()
        if status == 200 and expected == observed:
            return None
        last = f"HTTP {status}, SHA-256 {observed} (expected {expected})"
        if status < 500 and status != 429 and status == 200:
            continue
        if status < 500 and status != 429:
            break
    return f"{relative}: {last}"


def wait_for_release(root: Path, origin: str, attempts: int, interval: float) -> None:
    expected = hashlib.sha256((root / "index.html").read_bytes()).hexdigest()
    url = live_url(origin, "index.html") + "?mfenx_verify=" + expected[:16]
    last = "no response"
    for attempt in range(1, attempts + 1):
        try:
            status, body, final_url = request_bytes(url)
            observed = hashlib.sha256(body).hexdigest()
            last = f"HTTP {status}, SHA-256 {observed}, URL {final_url}"
            if status == 200 and observed == expected:
                print(f"release visible after attempt {attempt}")
                return
        except (TimeoutError, URLError) as exc:
            last = str(exc)
        if attempt < attempts:
            time.sleep(interval)
    raise RuntimeError(f"deployed homepage did not reach the edge: {last}")


def verify_blocked(origin: str) -> list[str]:
    errors: list[str] = []
    for route in BLOCKED_ROUTES:
        url = urljoin(origin.rstrip("/") + "/", route.lstrip("/"))
        try:
            status, _, _ = request_bytes(url)
        except (TimeoutError, URLError) as exc:
            errors.append(f"{route}: request failed: {exc}")
            continue
        if status != 404:
            errors.append(f"{route}: expected HTTP 404, received {status}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--attempts", type=int, default=12)
    parser.add_argument("--interval", type=float, default=10.0)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    root = args.root.resolve()
    if not root.is_dir() or not (root / "index.html").is_file():
        raise SystemExit("invalid production root")
    parsed_origin = urlsplit(args.origin)
    if parsed_origin.scheme != "https" or not parsed_origin.netloc:
        raise SystemExit("origin must be an HTTPS URL")

    wait_for_release(root, args.origin, args.attempts, args.interval)
    files = public_files(root)
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(verify_file, root, args.origin, path): path
            for path in files
        }
        for future in as_completed(futures):
            error = future.result()
            if error:
                errors.append(error)
    errors.extend(verify_blocked(args.origin))

    if errors:
        for error in sorted(errors):
            print(f"ERROR: {error}")
        return 1
    print(f"production verification: PASS ({len(files)} exact files, {len(BLOCKED_ROUTES)} blocked routes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
