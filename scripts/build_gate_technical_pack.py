#!/usr/bin/env python3
"""Build the public technical pack from an explicit, non-secret allowlist."""
import argparse
import hashlib
from pathlib import Path
import zipfile

MEMBERS = {
    "security-and-data-flow.md": "enterprise/security-overview.md",
    "sdk-inventory.cdx.json": "enterprise/GATE-SBOM.cdx.json",
    "inventory-validation.json": "enterprise/GATE-SBOM.validation.json",
    "LICENSE.txt": "gate/downloads/LICENSE.txt",
    "VERIFIER-TERMS.txt": "gate/downloads/VERIFIER-TERMS.txt",
    "sdk-SHA256SUMS": "gate/downloads/SHA256SUMS",
    "measured-run.json": "evidence/onnx-release/run-manifest.json",
    "evaluation-method.md": "evidence/onnx-release/README.md",
    "evidence-SHA256SUMS": "evidence/onnx-release/SHA256SUMS",
}


def build(root: Path, destination: Path) -> None:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, relative in sorted(MEMBERS.items()):
            source = root / relative
            if source.is_symlink() or not source.is_file():
                raise ValueError(f"Unsafe or absent public pack member: {relative}")
            data = source.read_bytes()
            if b"PRIVATE KEY-----" in data:
                raise ValueError("Private signing material cannot enter the technical pack")
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data, compresslevel=9)
    print(f"{hashlib.sha256(destination.read_bytes()).hexdigest()}  {destination.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("public"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.root.resolve(), args.output)
