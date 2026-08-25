#!/usr/bin/env python3
"""Validate and authenticate the public Lights Out commercial-status record."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


SCHEMA = "mfenx.commercial-status.v2"
ENCODING = "mfenx.json.jq-cS-integer.v1"
NAMESPACE = "mfenx-commercial-status"
PRINCIPAL = "mfenx-release"
KEY_FINGERPRINT = "SHA256:Uhj/Ci2+3KA2JN/H8+Sl6nhAiTeD76zvajqvxLOYTTc"
HISTORICAL_RECORD_SHA256 = "175174d0f049fdf88895909dd6f71f40f80073c206c3f05eaff0283c0b68a715"
DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
OID_RE = re.compile(r"^[0-9a-f]{40}$")
RECORD_ID_RE = re.compile(r"^lights-out-local-supercomputer-v2-commercial-status-[0-9]{8}$")
UTC_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")

EXPECTED_SCALING = (
    ("cold_unprimed", 1, "distinct_physical_cores", "14562316443.5", "1.000000"),
    ("cold_unprimed", 2, "distinct_physical_cores", "12294541476.0", "1.184454"),
    ("cold_unprimed", 4, "distinct_physical_cores", "11072497582.0", "1.315179"),
    ("cold_unprimed", 8, "oversubscribed_round_robin", "11899606585.0", "1.223765"),
    ("cold_unprimed", 16, "oversubscribed_round_robin", "12812258960.5", "1.136592"),
    ("warm_primed", 1, "distinct_physical_cores", "14017605601.0", "1.000000"),
    ("warm_primed", 2, "distinct_physical_cores", "12094623824.0", "1.158995"),
    ("warm_primed", 4, "distinct_physical_cores", "11547331715.5", "1.213926"),
    ("warm_primed", 8, "oversubscribed_round_robin", "11632124791.5", "1.205077"),
    ("warm_primed", 16, "oversubscribed_round_robin", "12200400739.0", "1.148946"),
)


class ValidationError(ValueError):
    """A deterministic commercial-status validation failure."""


def fail(path: str, message: str) -> None:
    raise ValidationError(f"{path}: {message}")


def exact_keys(value: Any, path: str, expected: tuple[str, ...]) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(path, "must be an object")
    if set(value) != set(expected):
        missing = sorted(set(expected) - set(value))
        extra = sorted(set(value) - set(expected))
        fail(path, f"property set changed (missing={missing}, extra={extra})")
    return value


def exact(value: Any, path: str, expected: Any) -> None:
    if type(value) is not type(expected) or value != expected:  # bool must not pass as int
        fail(path, f"expected {expected!r}")


def digest(value: Any, path: str) -> None:
    if not isinstance(value, str) or not DIGEST_RE.fullmatch(value):
        fail(path, "must be a lowercase SHA-256 hex digest")


def oid(value: Any, path: str) -> None:
    if not isinstance(value, str) or not OID_RE.fullmatch(value):
        fail(path, "must be a lowercase SHA-1 Git object ID")


def reject_floats(value: Any, path: str = "$") -> None:
    if isinstance(value, float):
        fail(path, "floating-point JSON numbers are not canonical in this profile")
    if isinstance(value, dict):
        for key, child in value.items():
            reject_floats(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            reject_floats(child, f"{path}[{index}]")


def validate_record(record: Any) -> None:
    reject_floats(record)
    root = exact_keys(
        record,
        "$",
        (
            "schema",
            "record_id",
            "effective_at_utc",
            "encoding_profile",
            "product",
            "licensing",
            "technical_evidence",
            "historical_record",
            "signature",
        ),
    )
    exact(root["schema"], "$.schema", SCHEMA)
    if not isinstance(root["record_id"], str) or not RECORD_ID_RE.fullmatch(root["record_id"]):
        fail("$.record_id", "must identify the dated Lights Out V2 commercial-status record")
    if not isinstance(root["effective_at_utc"], str) or not UTC_RE.fullmatch(root["effective_at_utc"]):
        fail("$.effective_at_utc", "must use second-precision UTC RFC 3339 form")
    exact(root["encoding_profile"], "$.encoding_profile", ENCODING)

    product = exact_keys(root["product"], "$.product", ("company", "name", "generation", "software_release", "machine_class"))
    exact(product["company"], "$.product.company", "MFENX")
    exact(product["name"], "$.product.name", "Lights Out Local Supercomputer V2")
    exact(product["generation"], "$.product.generation", "v2")
    exact(product["software_release"], "$.product.software_release", "v0.1.3")
    exact(product["machine_class"], "$.product.machine_class", "software_defined_local_supercomputer_v2")

    licensing = exact_keys(
        root["licensing"],
        "$.licensing",
        (
            "current_software_license",
            "executor",
            "verifier",
            "source_available",
            "public_binary_distribution",
            "evaluation_requires_written_agreement",
            "redistribution_requires_written_agreement",
        ),
    )
    expected_licensing = {
        "current_software_license": "LicenseRef-MFENX-Commercial",
        "executor": "proprietary",
        "verifier": "proprietary",
        "source_available": False,
        "public_binary_distribution": False,
        "evaluation_requires_written_agreement": True,
        "redistribution_requires_written_agreement": True,
    }
    for key, expected in expected_licensing.items():
        exact(licensing[key], f"$.licensing.{key}", expected)

    evidence = exact_keys(
        root["technical_evidence"],
        "$.technical_evidence",
        (
            "current_software_release",
            "execution_contract",
            "accepted_release",
            "preserved_v1_comparator",
            "validation_candidate",
            "adversarial",
            "scaling",
            "reproduction",
            "external_workload",
        ),
    )
    current = exact_keys(
        evidence["current_software_release"],
        "$.technical_evidence.current_software_release",
        (
            "git_object_format",
            "commit_oid",
            "commit_tree_oid",
            "power_house_tree_oid",
            "tag",
            "tag_object_oid",
            "git_signing_key_fingerprint",
            "commit_signature_verified",
            "tag_signature_verified",
            "release_verification",
            "automated_security_assurance",
        ),
    )
    exact(current["git_object_format"], "$.technical_evidence.current_software_release.git_object_format", "sha1")
    expected_oids = {
        "commit_oid": "d0b14cc6083849675e9d943299e60de2458fd7fb",
        "commit_tree_oid": "443fc13fbf387ecc5056d5f3435fdda711a94845",
        "power_house_tree_oid": "32feafbb998d90ee7aead03d14b4f9aabb141ed4",
        "tag_object_oid": "b18e598aa942856bc0f1a5d24815314dfe5c44b3",
    }
    for key, expected in expected_oids.items():
        oid(current[key], f"$.technical_evidence.current_software_release.{key}")
        exact(current[key], f"$.technical_evidence.current_software_release.{key}", expected)
    exact(current["tag"], "$.technical_evidence.current_software_release.tag", "v0.1.3")
    exact(current["git_signing_key_fingerprint"], "$.technical_evidence.current_software_release.git_signing_key_fingerprint", KEY_FINGERPRINT)
    exact(current["commit_signature_verified"], "$.technical_evidence.current_software_release.commit_signature_verified", True)
    exact(current["tag_signature_verified"], "$.technical_evidence.current_software_release.tag_signature_verified", True)
    exact(product["software_release"], "$.product.software_release", current["tag"])

    release_verification = exact_keys(
        current["release_verification"],
        "$.technical_evidence.current_software_release.release_verification",
        ("workflow_run_id", "run_attempt", "head_commit_oid", "conclusion"),
    )
    expected_release_verification = {
        "workflow_run_id": 32800785954,
        "run_attempt": 1,
        "head_commit_oid": current["commit_oid"],
        "conclusion": "success",
    }
    for key, expected in expected_release_verification.items():
        exact(release_verification[key], f"$.technical_evidence.current_software_release.release_verification.{key}", expected)

    assurance = exact_keys(
        current["automated_security_assurance"],
        "$.technical_evidence.current_software_release.automated_security_assurance",
        (
            "workflow_run_id",
            "run_attempt",
            "head_commit_oid",
            "conclusion",
            "required_outcomes",
            "recorded_outcomes",
            "successful_outcomes",
            "failed_outcomes",
            "evidence_files",
            "evidence_archive_bytes",
            "evidence_archive_sha256",
            "evidence_signature_sha256",
            "evidence_signing_key_fingerprint",
        ),
    )
    expected_assurance = {
        "workflow_run_id": 32802684195,
        "run_attempt": 1,
        "head_commit_oid": current["commit_oid"],
        "conclusion": "success",
        "required_outcomes": 16,
        "recorded_outcomes": 16,
        "successful_outcomes": 16,
        "failed_outcomes": 0,
        "evidence_files": 46,
        "evidence_archive_bytes": 91891,
        "evidence_archive_sha256": "174f51b53f619d180097208d9b5ce00ac12ef932c626af1d024ea9122c3847d8",
        "evidence_signature_sha256": "bc9967241a84b03a7e50c0d7f2cca333bf8d0af0cc8fd5ee432544d9c0b496b3",
        "evidence_signing_key_fingerprint": "SHA256:mTHLiO34Fx2jTpLMkTZ4AY5M9AVy0jaHc0n8SCV4uoc",
    }
    for key, expected in expected_assurance.items():
        exact(assurance[key], f"$.technical_evidence.current_software_release.automated_security_assurance.{key}", expected)
    digest(assurance["evidence_archive_sha256"], "$.technical_evidence.current_software_release.automated_security_assurance.evidence_archive_sha256")
    digest(assurance["evidence_signature_sha256"], "$.technical_evidence.current_software_release.automated_security_assurance.evidence_signature_sha256")

    contract = exact_keys(evidence["execution_contract"], "$.technical_evidence.execution_contract", ("version", "release_manifest_sha256", "release_signature_sha256"))
    exact(contract["version"], "$.technical_evidence.execution_contract.version", "v1")
    exact(contract["release_manifest_sha256"], "$.technical_evidence.execution_contract.release_manifest_sha256", "bf854ef7144f11358725aaf8021a91f12fede517ac8110fc44bc08a50950b071")
    exact(contract["release_signature_sha256"], "$.technical_evidence.execution_contract.release_signature_sha256", "2b26d302e978566c95709ac3c4cf93cc10f29ac5d9a02e97470283460efbf1db")

    accepted = exact_keys(evidence["accepted_release"], "$.technical_evidence.accepted_release", ("capture_manifest_sha256", "acceptance_sha256", "executor_sha256", "source_tree_sha256", "output_root", "external_wall_ns"))
    expected_accepted = {
        "capture_manifest_sha256": "71033d917be233ea260417a1f7521c8098f27715475ad0ddf8318a5ecf2fd966",
        "acceptance_sha256": "4f101f8ec4b592b39b4024f198dd9f80cef79d2612556acf377191bee6270ebc",
        "executor_sha256": "a1043e568704163b9dedf536c5feb60b0b7fd23097a2a8f0504d55d7ddcb1e3c",
        "source_tree_sha256": "e3c87a14c466e3a335f13f86738a72459bff1629c5b5d969733f0d7f544bb9ca",
        "output_root": "4691a345a8818af410da311bc4d79131dcd093ff47384e71d4832ca08fed638c",
        "external_wall_ns": 5608764486,
    }
    for key, expected in expected_accepted.items():
        exact(accepted[key], f"$.technical_evidence.accepted_release.{key}", expected)

    comparator = exact_keys(evidence["preserved_v1_comparator"], "$.technical_evidence.preserved_v1_comparator", ("capture_manifest_sha256", "acceptance_sha256", "external_wall_ns", "same_workload", "same_output_root", "v1_over_v2_ratio_decimal"))
    expected_comparator = {
        "capture_manifest_sha256": "3a08e8a61b6eb0a9cec94959fa5b666ff1441de6c310b07f388e9ce57a80296d",
        "acceptance_sha256": "b4fb33fffa4362c6a7d9a9af963e1b1af4e5a32634d6ac5916a43b87868814be",
        "external_wall_ns": 276103268901,
        "same_workload": True,
        "same_output_root": True,
        "v1_over_v2_ratio_decimal": "49.2271104608",
    }
    for key, expected in expected_comparator.items():
        exact(comparator[key], f"$.technical_evidence.preserved_v1_comparator.{key}", expected)

    candidate = exact_keys(evidence["validation_candidate"], "$.technical_evidence.validation_candidate", ("release_id", "manifest_sha256", "executor_sha256", "verifier_sha256"))
    expected_candidate = {
        "release_id": "mfenx-local-v2-validation-candidate-20260822-a1",
        "manifest_sha256": "fb4023a172927ba7555376f0217f84c3dd2bcb057ce11d59e7b2697d02ab6229",
        "executor_sha256": "92e48bfe615ad5241202d2e49fac51d52e21d66f3d0c84c273af042d5852dac0",
        "verifier_sha256": "f3714660b9deeef3bd8ecef716c40580c7596c0903f05e89d555ed0d32e9b9fa",
    }
    for key, expected in expected_candidate.items():
        exact(candidate[key], f"$.technical_evidence.validation_candidate.{key}", expected)

    adversarial = exact_keys(evidence["adversarial"], "$.technical_evidence.adversarial", ("attempted_exactly_once", "driver_passed", "independent_passed", "mutation_cases", "restart_cases", "attestation_sha256"))
    expected_adversarial = {
        "attempted_exactly_once": 214,
        "driver_passed": 214,
        "independent_passed": 214,
        "mutation_cases": 192,
        "restart_cases": 22,
        "attestation_sha256": "08255a52606665d63bb43f1812afe928aa3f55e2ccea0248b596f190f757c716",
    }
    for key, expected in expected_adversarial.items():
        exact(adversarial[key], f"$.technical_evidence.adversarial.{key}", expected)

    scaling = exact_keys(evidence["scaling"], "$.technical_evidence.scaling", ("planned", "successful", "retained", "sample_filtering_applied", "results_sha256", "cells"))
    exact(scaling["planned"], "$.technical_evidence.scaling.planned", 100)
    exact(scaling["successful"], "$.technical_evidence.scaling.successful", 100)
    exact(scaling["retained"], "$.technical_evidence.scaling.retained", 100)
    exact(scaling["sample_filtering_applied"], "$.technical_evidence.scaling.sample_filtering_applied", False)
    exact(scaling["results_sha256"], "$.technical_evidence.scaling.results_sha256", "bb1fd8bfe6158f2e68e028b9f3085359fcf7288d09cfd59e74a9083ef4360608")
    if not isinstance(scaling["cells"], list) or len(scaling["cells"]) != len(EXPECTED_SCALING):
        fail("$.technical_evidence.scaling.cells", "must contain the ten frozen scaling cells")
    for index, (cell, expected_cell) in enumerate(zip(scaling["cells"], EXPECTED_SCALING, strict=True)):
        item = exact_keys(cell, f"$.technical_evidence.scaling.cells[{index}]", ("temperature", "lanes", "topology", "median_wall_ns_decimal", "speedup_decimal"))
        for key, expected in zip(("temperature", "lanes", "topology", "median_wall_ns_decimal", "speedup_decimal"), expected_cell, strict=True):
            exact(item[key], f"$.technical_evidence.scaling.cells[{index}].{key}", expected)

    reproduction = exact_keys(evidence["reproduction"], "$.technical_evidence.reproduction", ("jobs", "matching_output_roots", "record_sha256"))
    exact(reproduction["jobs"], "$.technical_evidence.reproduction.jobs", 3)
    exact(reproduction["matching_output_roots"], "$.technical_evidence.reproduction.matching_output_roots", 3)
    exact(reproduction["record_sha256"], "$.technical_evidence.reproduction.record_sha256", "c12a24a7f3f37f47bfcc2e94231fea9e3578eb6a2441cfb8858fdaadd7d38d73")

    workload = exact_keys(evidence["external_workload"], "$.technical_evidence.external_workload", ("name", "executor_accepted", "standalone_verifier_accepted", "independent_exact_oracle_accepted", "record_sha256"))
    exact(workload["name"], "$.technical_evidence.external_workload.name", "UCI Iris")
    exact(workload["executor_accepted"], "$.technical_evidence.external_workload.executor_accepted", True)
    exact(workload["standalone_verifier_accepted"], "$.technical_evidence.external_workload.standalone_verifier_accepted", True)
    exact(workload["independent_exact_oracle_accepted"], "$.technical_evidence.external_workload.independent_exact_oracle_accepted", True)
    exact(workload["record_sha256"], "$.technical_evidence.external_workload.record_sha256", "32b870a07c771199be685464c02df8f0c052d21a582085831047daaa466e5270")

    historical = exact_keys(root["historical_record"], "$.historical_record", ("status", "record_sha256", "controls_current_terms"))
    exact(historical["status"], "$.historical_record.status", "archived_private")
    exact(historical["record_sha256"], "$.historical_record.record_sha256", HISTORICAL_RECORD_SHA256)
    exact(historical["controls_current_terms"], "$.historical_record.controls_current_terms", False)

    signature = exact_keys(root["signature"], "$.signature", ("algorithm", "format", "namespace", "signer_identity", "public_key_fingerprint"))
    exact(signature["algorithm"], "$.signature.algorithm", "ssh-ed25519")
    exact(signature["format"], "$.signature.format", "openssh-sshsig")
    exact(signature["namespace"], "$.signature.namespace", NAMESPACE)
    exact(signature["signer_identity"], "$.signature.signer_identity", PRINCIPAL)
    exact(signature["public_key_fingerprint"], "$.signature.public_key_fingerprint", KEY_FINGERPRINT)


def no_duplicate_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail("$", f"duplicate JSON property {key!r}")
        result[key] = value
    return result


def canonical_bytes(record: Any) -> bytes:
    return (json.dumps(record, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")


def load_canonical_bytes(data: bytes) -> dict[str, Any]:
    try:
        text = data.decode("utf-8")
        record = json.loads(text, object_pairs_hook=no_duplicate_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError(f"invalid UTF-8 JSON: {exc}") from exc
    validate_record(record)
    if data != canonical_bytes(record):
        fail("$", f"bytes do not match {ENCODING}")
    return record


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def javascript_pins(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    names = ("recordSha256", "detachedSignatureSha256", "publicKeySha256", "allowedSignersSha256")
    pins: dict[str, str] = {}
    for name in names:
        match = re.search(rf"\b{name}:\s*\"([0-9a-f]{{64}})\"", text)
        if not match:
            fail(str(path), f"missing finalized {name} pin")
        pins[name] = match.group(1)
    return pins


def verify_bundle(bundle_root: Path, javascript: Path) -> None:
    files = {
        "recordSha256": bundle_root / "COMMERCIAL-STATUS.canonical.json",
        "detachedSignatureSha256": bundle_root / "COMMERCIAL-STATUS.canonical.json.sig",
        "publicKeySha256": bundle_root / "release-signing-key.pub",
        "allowedSignersSha256": bundle_root / "allowed_signers",
    }
    missing = [str(path) for path in files.values() if not path.is_file()]
    if missing:
        fail(str(bundle_root), f"signed publication bundle is incomplete: {missing}")

    raw = {name: path.read_bytes() for name, path in files.items()}
    record = load_canonical_bytes(raw["recordSha256"])
    pins = javascript_pins(javascript)
    for name, data in raw.items():
        observed = sha256(data)
        if pins[name] != observed:
            fail(str(files[name]), f"SHA-256 differs from JavaScript pin ({observed})")

    signature_text = raw["detachedSignatureSha256"].decode("ascii", errors="strict").strip()
    if not (signature_text.startswith("-----BEGIN SSH SIGNATURE-----") and signature_text.endswith("-----END SSH SIGNATURE-----")):
        fail(str(files["detachedSignatureSha256"]), "must be an armored OpenSSH signature")
    public_key = raw["publicKeySha256"].decode("ascii", errors="strict").strip().split()
    if len(public_key) < 2 or public_key[0] != "ssh-ed25519":
        fail(str(files["publicKeySha256"]), "must contain an OpenSSH Ed25519 public key")
    try:
        key_blob = base64.b64decode(public_key[1], validate=True)
    except ValueError as exc:
        raise ValidationError(f"{files['publicKeySha256']}: invalid public-key base64") from exc
    fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(key_blob).digest()).decode("ascii").rstrip("=")
    exact(fingerprint, str(files["publicKeySha256"]), KEY_FINGERPRINT)
    expected_policy = f'{PRINCIPAL} namespaces="{NAMESPACE}" ssh-ed25519 {public_key[1]}\n'.encode("ascii")
    if raw["allowedSignersSha256"] != expected_policy:
        fail(str(files["allowedSignersSha256"]), "allowed-signers policy differs from the pinned identity and namespace")
    exact(record["signature"]["public_key_fingerprint"], "$.signature.public_key_fingerprint", fingerprint)

    ssh_keygen = shutil.which("ssh-keygen")
    if not ssh_keygen:
        fail("ssh-keygen", "OpenSSH is required to authenticate the detached signature")
    result = subprocess.run(
        [ssh_keygen, "-Y", "verify", "-f", str(files["allowedSignersSha256"]), "-I", PRINCIPAL, "-n", NAMESPACE, "-s", str(files["detachedSignatureSha256"])],
        input=raw["recordSha256"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        fail(str(files["detachedSignatureSha256"]), "OpenSSH signature authentication failed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--record", type=Path, help="validate one canonical record without its signature")
    parser.add_argument("--bundle-root", type=Path, help="validate and authenticate the complete publication bundle")
    parser.add_argument("--javascript", type=Path, help="JavaScript file containing the four exact SHA-256 pins")
    args = parser.parse_args()
    try:
        if bool(args.record) == bool(args.bundle_root):
            parser.error("choose exactly one of --record or --bundle-root")
        if args.record:
            load_canonical_bytes(args.record.read_bytes())
        else:
            if not args.javascript:
                parser.error("--bundle-root requires --javascript")
            verify_bundle(args.bundle_root, args.javascript)
    except (OSError, ValidationError) as exc:
        print(f"commercial-status validation failed: {exc}", file=sys.stderr)
        return 1
    print("commercial-status validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
