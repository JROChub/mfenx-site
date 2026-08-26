#!/usr/bin/env python3
"""Fail-closed validation for the signed QQfenx v0.1.4 performance bundle."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


SCHEMA = "mfenx.qqfenx.performance-certificate.v1"
REPORT_SCHEMA = "mfenx.qqfenx.competitive-evidence.v1"
PRODUCT = {"name": "QQfenx", "release": "v0.1.4", "vendor": "MFENX"}
LICENSE = "LicenseRef-MFENX-Commercial"
PRINCIPAL = "mfenx-release"
NAMESPACE = "mfenx-qqfenx-performance"
KEY_FINGERPRINT = "SHA256:Uhj/Ci2+3KA2JN/H8+Sl6nhAiTeD76zvajqvxLOYTTc"

CERTIFICATE_NAME = "QQFENX-PERFORMANCE-CERTIFICATE.canonical.json"
SIGNATURE_NAME = CERTIFICATE_NAME + ".sig"
PUBLIC_KEY_NAME = "release-signing-key.pub"
ALLOWED_SIGNERS_NAME = "allowed_signers"
FILE_SHA256 = {
    CERTIFICATE_NAME: "b8e026e51b26949ef213d202c8bccf10533006be527c9f2e62c590a08f9ddcef",
    SIGNATURE_NAME: "79a73842fc004632a8cea5f962e89232bf0bb520a36bfe698067ecb36ed613c8",
    PUBLIC_KEY_NAME: "0f7c5f5eacc52b9f5c54eb7a5166e7e8e0a5a5b73d9a23f94dc9e2bdad244426",
    ALLOWED_SIGNERS_NAME: "631b9f59fcbb92d8e535788f4e593322bb9f1f363b43d74070d5ad946d6be027",
}

REPORT_FILE_SHA256 = "895e903045e071358066194511600f4054c192a3ad004eb65b0f1a145443cf24"
REPORT_CANONICAL_SHA256 = "29f4f57604621d7599420aa24b4143c226db73a8029340807854dd4b04b37cbe"
SOURCE_COMMIT = "01e2c6e552e96a3e0e67461827c06f7c83da061a"
SOURCE_TREE = "4441b4e2aa7414cf56a09c37ccf080cc4102ba79"
ORACLE_SHA256 = "90f359758f26cc028c4ea52ed99e30c629512b3efb6e53dfd18bb6b669c36f35"
OUTPUT_FNV1A64 = "21255eaa70abb088"
EXPECTED_OUTPUT = (
    522385,
    267343,
    348376,
    112814,
    267343,
    143040,
    167430,
    53189,
    348376,
    167430,
    258271,
    86911,
    112814,
    53189,
    86911,
    30233,
)

CASES = (
    "synthetic-q32",
    "synthetic-q16",
    "synthetic-q8-safe-u6",
    "synthetic-zero-ideal",
    "synthetic-cancellation-cascade",
    "uci-iris-feature-gram-i32-v1",
)
EXTERNAL_CASE = "uci-iris-feature-gram-i32-v1"
SOURCE_FILE_SHA256 = {
    "benchmarks/qqfenx-competitive/benchmark.schema.json": "178bdf01aa5b1e94dd36a177e1e4d2c86768cccf4f6eec7a6bcba041c925c831",
    "benchmarks/qqfenx-competitive/onednn_q8.cpp": "a2afd879ccf97900da31f2f46eb438214375d8f582f591333c3ae6ffcac4a5d7",
    "benchmarks/qqfenx-competitive/qqfenx_competitive.c": "92dd5da4c43ae1fcd41a21d2baa6b3c1c75e4b46bbd581cd744875cf16f058ae",
    "benchmarks/qqfenx-competitive/run.py": "570a98bb1e80351c61dc414547fff23f4b8b52b5bcf46437a221f76361ccf922",
    "native/qqfenx/qqfenx.c": "bc0eebf668e3b67b636f3cf89975046dbf6a5a31458a5e63b74c323f17669897",
    "native/qqfenx/qqfenx.h": "0e92a9601bc7484a027f39b7f153e1e425a1f1b6f0381549bc74d8ee7f00e87e",
    "native/qqfenx/qqfenx_scaling_bench.c": "83b3e622c16e09862f700436381d4d660800e8358c74bc5cdd99d3de6b584272",
    "packaging/external-workloads/uci-iris/adapter.py": "9bef412bdb894bb292cf295566c234889445f890a19a1dad56b24ca4b7805a97",
    "packaging/external-workloads/uci-iris/bezdekIris.data": "0fed2a99db77ec533a62dc66894d3ec6df3b58b6a8f3cf4a6b47e4086b7f97dc",
    "packaging/external-workloads/uci-iris/oracle.json": "bf171968b1883ecc3f54d218d132711cacc902ac288c1da9041a82516159bb13",
}

ROOT_KEYS = (
    "builds",
    "configuration",
    "coverage",
    "direct_comparisons",
    "external_workload",
    "host",
    "license",
    "measurements",
    "methodology",
    "packed_kernel_proof",
    "product",
    "report_binding",
    "scaling",
    "schema",
    "status",
)
MEDIAN_KEYS = ("end_to_end_cold", "end_to_end_warm", "prepared_cold", "prepared_warm")
C_WORK_KEYS = (
    "annihilated_macs",
    "executed_macs",
    "logical_macs",
    "promoted_tiles",
    "promotion_bits",
    "q16_macs",
    "q24_macs",
    "q32_macs",
    "q8_macs",
)
C_MEASUREMENT_KEYS = (
    "active_lanes",
    "active_lanes_observed",
    "case",
    "compiler",
    "configured_lanes",
    "end_to_end_scope",
    "engine",
    "exact_match",
    "general_wrapping_u32",
    "implementation",
    "medians_ns",
    "output_fnv1a64",
    "reserved_workspace_bytes",
    "sample_counts",
    "semantic_scope",
    "source",
    "status",
    "threads",
    "timing_scope",
    "work",
)
ONEDNN_MEASUREMENT_KEYS = (
    "case",
    "compiler",
    "end_to_end_scope",
    "engine",
    "exact_match",
    "general_wrapping_u32",
    "implementation",
    "medians_ns",
    "output_fnv1a64",
    "sample_counts",
    "semantic_scope",
    "source",
    "status",
    "thread_control",
    "threading_runtime",
    "threads",
    "timing_scope",
    "work",
)
DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
OID_RE = re.compile(r"^[0-9a-f]{40}$")
FNV_RE = re.compile(r"^[0-9a-f]{16}$")
MAX_CERTIFICATE_BYTES = 256 * 1024


class ValidationError(ValueError):
    """The publication bundle or certificate violated a frozen invariant."""


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
    if type(value) is not type(expected) or value != expected:
        fail(path, f"expected {expected!r}")


def array(value: Any, path: str, length: int) -> list[Any]:
    if not isinstance(value, list) or len(value) != length:
        fail(path, f"must contain exactly {length} entries")
    return value


def nonempty_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value:
        fail(path, "must be a nonempty string")
    return value


def nonnegative_integer(value: Any, path: str) -> int:
    if type(value) is not int or value < 0:
        fail(path, "must be a nonnegative integer")
    return value


def positive_integer(value: Any, path: str) -> int:
    result = nonnegative_integer(value, path)
    if result == 0:
        fail(path, "must be positive")
    return result


def positive_float(value: Any, path: str) -> float:
    if type(value) is not float or not math.isfinite(value) or value <= 0.0:
        fail(path, "must be a positive finite JSON floating-point number")
    return value


def digest(value: Any, path: str) -> str:
    if not isinstance(value, str) or DIGEST_RE.fullmatch(value) is None:
        fail(path, "must be a lowercase SHA-256 digest")
    return value


def validate_builds(value: Any) -> None:
    builds = exact_keys(value, "$.builds", ("c", "onednn"))
    c_builds = array(builds["c"], "$.builds.c", 2)
    if [item.get("compiler") for item in c_builds if isinstance(item, dict)] != ["gcc", "clang"]:
        fail("$.builds.c", "must preserve the ordered GCC and Clang builds")
    for index, value in enumerate(c_builds):
        item = exact_keys(
            value,
            f"$.builds.c[{index}]",
            ("binary_sha256", "compiler", "openblas_compiled", "telemetry_instrumented", "version"),
        )
        digest(item["binary_sha256"], f"$.builds.c[{index}].binary_sha256")
        exact(item["openblas_compiled"], f"$.builds.c[{index}].openblas_compiled", True)
        exact(item["telemetry_instrumented"], f"$.builds.c[{index}].telemetry_instrumented", False)
        nonempty_string(item["version"], f"$.builds.c[{index}].version")
    onednn = exact_keys(
        builds["onednn"],
        "$.builds.onednn",
        (
            "binary_sha256",
            "compiler_version",
            "effective_cpu_isa",
            "implementation",
            "openmp_control_build_enabled",
            "threading_runtime",
        ),
    )
    digest(onednn["binary_sha256"], "$.builds.onednn.binary_sha256")
    exact(onednn["openmp_control_build_enabled"], "$.builds.onednn.openmp_control_build_enabled", True)
    exact(onednn["threading_runtime"], "$.builds.onednn.threading_runtime", "openmp")


def validate_configuration(value: Any) -> None:
    expected = {
        "backend": "auto",
        "cache_scrub_mib": 32,
        "cold_samples": 5,
        "compilers": ["gcc", "clang"],
        "extent": 384,
        "thread_counts": [1, 4],
        "tile": 32,
        "timeout_seconds": 900,
        "warm_samples": 15,
        "workspace_mib": 64,
    }
    exact(value, "$.configuration", expected)


def validate_coverage(value: Any) -> None:
    expected = {
        "all_c_reports_exact": True,
        "all_engine_measurements_exact": True,
        "all_onednn_reports_exact": True,
        "c_engine_measurement_count": 56,
        "c_execution_count": 4,
        "external_oracle_observation_count": 14,
        "onednn_1_to_4_scaling_count": 2,
        "onednn_engine_measurement_count": 4,
        "onednn_execution_count": 2,
        "openblas_1_to_4_scaling_count": 4,
        "published_direct_comparison_count": 28,
        "published_direct_ratio_value_count": 56,
        "published_direct_ratio_values_below_one_count": 40,
        "qqfenx_1_to_4_scaling_count": 12,
    }
    exact(value, "$.coverage", expected)


def validate_medians(item: dict[str, Any], path: str) -> None:
    medians = exact_keys(item["medians_ns"], f"{path}.medians_ns", MEDIAN_KEYS)
    samples = exact_keys(item["sample_counts"], f"{path}.sample_counts", MEDIAN_KEYS)
    for key in MEDIAN_KEYS:
        positive_integer(medians[key], f"{path}.medians_ns.{key}")
        expected_samples = 5 if key.endswith("cold") else 15
        exact(samples[key], f"{path}.sample_counts.{key}", expected_samples)


def validate_retained_output(item: dict[str, Any], path: str) -> None:
    is_external = item["case"] == EXTERNAL_CASE
    if ("retained_output_u32" in item) is not is_external:
        fail(path, "retained oracle output presence differs from the external-workload case")
    if is_external:
        exact(item["retained_output_u32"], f"{path}.retained_output_u32", list(EXPECTED_OUTPUT))


def validate_c_measurements(value: Any) -> None:
    measurements = array(value, "$.measurements.c_engines", 56)
    expected_identities = {
        (compiler, threads, case, engine)
        for compiler in ("gcc", "clang")
        for threads in (1, 4)
        for case in CASES
        for engine in ("qqfenx-c11", "dense-c-blocked")
    }
    expected_identities |= {
        (compiler, threads, case, "openblas-sgemm")
        for compiler in ("gcc", "clang")
        for threads in (1, 4)
        for case in ("synthetic-q8-safe-u6", EXTERNAL_CASE)
    }
    identities: set[tuple[Any, ...]] = set()
    for index, value in enumerate(measurements):
        path = f"$.measurements.c_engines[{index}]"
        allowed = C_MEASUREMENT_KEYS + (("retained_output_u32",) if isinstance(value, dict) and "retained_output_u32" in value else ())
        item = exact_keys(value, path, allowed)
        exact(item["source"], f"{path}.source", "c-run")
        exact(item["status"], f"{path}.status", "measured")
        exact(item["exact_match"], f"{path}.exact_match", True)
        if item["compiler"] not in ("gcc", "clang") or item["case"] not in CASES:
            fail(path, "compiler or case differs from the retained matrix")
        if item["engine"] not in ("qqfenx-c11", "dense-c-blocked", "openblas-sgemm"):
            fail(f"{path}.engine", "unknown engine")
        if type(item["threads"]) is not int or item["threads"] not in (1, 4):
            fail(f"{path}.threads", "must be 1 or 4")
        expected_configured = 1 if item["engine"] == "dense-c-blocked" else item["threads"]
        expected_active = 0 if item["engine"] == "openblas-sgemm" else expected_configured
        expected_observed = item["engine"] != "openblas-sgemm"
        exact(item["configured_lanes"], f"{path}.configured_lanes", expected_configured)
        exact(item["active_lanes"], f"{path}.active_lanes", expected_active)
        exact(item["active_lanes_observed"], f"{path}.active_lanes_observed", expected_observed)
        if type(item["general_wrapping_u32"]) is not bool:
            fail(path, "arithmetic-scope flag must be a boolean")
        nonempty_string(item["implementation"], f"{path}.implementation")
        if not isinstance(item["output_fnv1a64"], str) or FNV_RE.fullmatch(item["output_fnv1a64"]) is None:
            fail(f"{path}.output_fnv1a64", "must be a lowercase FNV-1a identity")
        nonnegative_integer(item["reserved_workspace_bytes"], f"{path}.reserved_workspace_bytes")
        for field in ("end_to_end_scope", "semantic_scope", "timing_scope"):
            nonempty_string(item[field], f"{path}.{field}")
        validate_medians(item, path)
        work = exact_keys(item["work"], f"{path}.work", C_WORK_KEYS)
        for key in C_WORK_KEYS:
            nonnegative_integer(work[key], f"{path}.work.{key}")
        positive_integer(work["logical_macs"], f"{path}.work.logical_macs")
        if work["executed_macs"] + work["annihilated_macs"] != work["logical_macs"]:
            fail(f"{path}.work", "executed and annihilated MACs do not partition logical work")
        if item["engine"] == "qqfenx-c11" and sum(work[key] for key in ("q8_macs", "q16_macs", "q24_macs", "q32_macs")) != work["executed_macs"]:
            fail(f"{path}.work", "QQfenx quotient classes do not partition executed work")
        validate_retained_output(item, path)
        identity = (item["compiler"], item["threads"], item["case"], item["engine"])
        if identity in identities:
            fail(path, "duplicate retained engine measurement")
        identities.add(identity)
    if identities != expected_identities:
        fail("$.measurements.c_engines", "retained compiler/thread/case/engine coverage differs")


def validate_onednn_measurements(value: Any) -> None:
    measurements = array(value, "$.measurements.onednn_engines", 4)
    expected_identities = {(threads, case) for threads in (1, 4) for case in ("synthetic-q8-safe-u6", EXTERNAL_CASE)}
    identities: set[tuple[Any, ...]] = set()
    for index, value in enumerate(measurements):
        path = f"$.measurements.onednn_engines[{index}]"
        allowed = ONEDNN_MEASUREMENT_KEYS + (("retained_output_u32",) if isinstance(value, dict) and "retained_output_u32" in value else ())
        item = exact_keys(value, path, allowed)
        exact(item["source"], f"{path}.source", "onednn-run")
        exact(item["status"], f"{path}.status", "measured")
        exact(item["exact_match"], f"{path}.exact_match", True)
        exact(item["compiler"], f"{path}.compiler", "oneDNN")
        exact(item["engine"], f"{path}.engine", "onednn-matmul-u8s8s32")
        exact(item["general_wrapping_u32"], f"{path}.general_wrapping_u32", False)
        exact(item["implementation"], f"{path}.implementation", None)
        exact(item["threading_runtime"], f"{path}.threading_runtime", "openmp")
        if type(item["threads"]) is not int or item["threads"] not in (1, 4):
            fail(f"{path}.threads", "must be 1 or 4")
        if item["case"] not in ("synthetic-q8-safe-u6", EXTERNAL_CASE):
            fail(f"{path}.case", "unexpected oneDNN case")
        controls = exact_keys(
            item["thread_control"],
            f"{path}.thread_control",
            (
                "dynamic_enabled",
                "mechanism",
                "observed_max_threads",
                "observed_team_threads",
                "requested_threads",
                "runtime",
                "verified",
            ),
        )
        exact(controls["dynamic_enabled"], f"{path}.thread_control.dynamic_enabled", False)
        exact(controls["runtime"], f"{path}.thread_control.runtime", "openmp")
        exact(controls["verified"], f"{path}.thread_control.verified", True)
        for key in ("requested_threads", "observed_max_threads", "observed_team_threads"):
            exact(controls[key], f"{path}.thread_control.{key}", item["threads"])
        validate_medians(item, path)
        work = exact_keys(item["work"], f"{path}.work", ("annihilated_macs", "executed_macs", "logical_macs"))
        for key in work:
            nonnegative_integer(work[key], f"{path}.work.{key}")
        positive_integer(work["logical_macs"], f"{path}.work.logical_macs")
        if work["executed_macs"] + work["annihilated_macs"] != work["logical_macs"]:
            fail(f"{path}.work", "executed and annihilated MACs do not partition logical work")
        for field in ("end_to_end_scope", "semantic_scope", "timing_scope"):
            nonempty_string(item[field], f"{path}.{field}")
        if not isinstance(item["output_fnv1a64"], str) or FNV_RE.fullmatch(item["output_fnv1a64"]) is None:
            fail(f"{path}.output_fnv1a64", "must be a lowercase FNV-1a identity")
        validate_retained_output(item, path)
        identity = (item["threads"], item["case"])
        if identity in identities:
            fail(path, "duplicate oneDNN measurement")
        identities.add(identity)
    if identities != expected_identities:
        fail("$.measurements.onednn_engines", "retained oneDNN coverage differs")


def validate_measurements(value: Any) -> None:
    measurements = exact_keys(value, "$.measurements", ("c_engines", "onednn_engines"))
    validate_c_measurements(measurements["c_engines"])
    validate_onednn_measurements(measurements["onednn_engines"])
    if len(measurements["c_engines"]) + len(measurements["onednn_engines"]) != 60:
        fail("$.measurements", "must retain exactly 60 engine measurements")


def validate_comparisons(value: Any) -> None:
    comparisons = array(value, "$.direct_comparisons", 28)
    identities: set[tuple[Any, ...]] = set()
    ratios: list[float] = []
    for index, value in enumerate(comparisons):
        path = f"$.direct_comparisons[{index}]"
        if not isinstance(value, dict):
            fail(path, "must be an object")
        source = value.get("source")
        common = (
            "baseline",
            "baseline_over_candidate_end_to_end",
            "baseline_over_candidate_prepared",
            "candidate",
            "case",
            "compiler",
            "interpretation",
            "ratio_published",
            "same_observed_output",
            "source",
            "threads",
        )
        if source == "c-run":
            item = exact_keys(value, path, common + ("matched_configured_lanes",))
            exact(item["matched_configured_lanes"], f"{path}.matched_configured_lanes", True)
            if item["baseline"] not in ("dense-c-blocked", "openblas-sgemm"):
                fail(f"{path}.baseline", "unexpected C baseline")
        elif source == "onednn-comparison":
            item = exact_keys(
                value,
                path,
                common
                + (
                    "baseline_threading_runtime",
                    "requested_thread_counts_equal",
                    "thread_control_verified",
                ),
            )
            exact(item["baseline"], f"{path}.baseline", "onednn-matmul-u8s8s32")
            exact(item["baseline_threading_runtime"], f"{path}.baseline_threading_runtime", "openmp")
            exact(item["requested_thread_counts_equal"], f"{path}.requested_thread_counts_equal", True)
            exact(item["thread_control_verified"], f"{path}.thread_control_verified", True)
        else:
            fail(f"{path}.source", "unexpected comparison source")
        exact(item["candidate"], f"{path}.candidate", "qqfenx-c11")
        exact(item["ratio_published"], f"{path}.ratio_published", True)
        exact(item["same_observed_output"], f"{path}.same_observed_output", True)
        if item["case"] not in CASES or item["compiler"] not in ("gcc", "clang"):
            fail(path, "comparison compiler or case differs")
        if type(item["threads"]) is not int or item["threads"] not in (1, 4):
            fail(f"{path}.threads", "must be 1 or 4")
        nonempty_string(item["interpretation"], f"{path}.interpretation")
        ratios.extend(
            (
                positive_float(item["baseline_over_candidate_prepared"], f"{path}.baseline_over_candidate_prepared"),
                positive_float(item["baseline_over_candidate_end_to_end"], f"{path}.baseline_over_candidate_end_to_end"),
            )
        )
        identity = (source, item["compiler"], item["threads"], item["case"], item["baseline"])
        if identity in identities:
            fail(path, "duplicate direct comparison")
        identities.add(identity)
    if len(ratios) != 56:
        fail("$.direct_comparisons", "must publish exactly 56 direct ratio values")
    if sum(value < 1.0 for value in ratios) != 40:
        fail("$.direct_comparisons", "must retain exactly 40 below-one ratio values")


def validate_scaling_rows(value: Any, path: str, length: int, engine: str) -> list[dict[str, Any]]:
    rows = array(value, path, length)
    keys = (
        "active_lanes",
        "baseline_configured_lanes",
        "case",
        "compiler",
        "configured_lanes",
        "end_to_end_warm_speedup",
        "engine",
        "prepared_warm_speedup",
    )
    for index, value in enumerate(rows):
        item_path = f"{path}[{index}]"
        item = exact_keys(value, item_path, keys)
        exact(item["engine"], f"{item_path}.engine", engine)
        exact(item["baseline_configured_lanes"], f"{item_path}.baseline_configured_lanes", 1)
        exact(item["configured_lanes"], f"{item_path}.configured_lanes", 4)
        positive_float(item["prepared_warm_speedup"], f"{item_path}.prepared_warm_speedup")
        positive_float(item["end_to_end_warm_speedup"], f"{item_path}.end_to_end_warm_speedup")
    return rows


def validate_scaling(value: Any) -> None:
    scaling = exact_keys(
        value,
        "$.scaling",
        ("onednn_1_to_4_threads", "openblas_1_to_4_lanes", "qqfenx_1_to_4_lanes"),
    )
    qqfenx = validate_scaling_rows(scaling["qqfenx_1_to_4_lanes"], "$.scaling.qqfenx_1_to_4_lanes", 12, "qqfenx-c11")
    expected = {(compiler, case) for compiler in ("gcc", "clang") for case in CASES}
    observed = set()
    for index, row in enumerate(qqfenx):
        exact(row["active_lanes"], f"$.scaling.qqfenx_1_to_4_lanes[{index}].active_lanes", 4)
        if row["compiler"] not in ("gcc", "clang") or row["case"] not in CASES:
            fail(f"$.scaling.qqfenx_1_to_4_lanes[{index}]", "compiler or case differs")
        observed.add((row["compiler"], row["case"]))
    if observed != expected:
        fail("$.scaling.qqfenx_1_to_4_lanes", "must cover both compilers and all six cases exactly once")
    openblas = validate_scaling_rows(scaling["openblas_1_to_4_lanes"], "$.scaling.openblas_1_to_4_lanes", 4, "openblas-sgemm")
    for index, row in enumerate(openblas):
        exact(row["active_lanes"], f"$.scaling.openblas_1_to_4_lanes[{index}].active_lanes", 0)
    onednn_rows = array(scaling["onednn_1_to_4_threads"], "$.scaling.onednn_1_to_4_threads", 2)
    onednn_keys = (
        "baseline_threading_runtime",
        "baseline_threads",
        "case",
        "end_to_end_warm_speedup",
        "prepared_warm_speedup",
        "speedup_published",
        "thread_control_verified",
        "threading_runtime",
        "threads",
    )
    for index, value in enumerate(onednn_rows):
        path = f"$.scaling.onednn_1_to_4_threads[{index}]"
        row = exact_keys(value, path, onednn_keys)
        exact(row["baseline_threading_runtime"], f"{path}.baseline_threading_runtime", "openmp")
        exact(row["threading_runtime"], f"{path}.threading_runtime", "openmp")
        exact(row["baseline_threads"], f"{path}.baseline_threads", 1)
        exact(row["threads"], f"{path}.threads", 4)
        exact(row["speedup_published"], f"{path}.speedup_published", True)
        exact(row["thread_control_verified"], f"{path}.thread_control_verified", True)
        positive_float(row["prepared_warm_speedup"], f"{path}.prepared_warm_speedup")
        positive_float(row["end_to_end_warm_speedup"], f"{path}.end_to_end_warm_speedup")


def validate_external_workload(value: Any) -> None:
    workload = exact_keys(
        value,
        "$.external_workload",
        (
            "all_observations_exact",
            "dataset_id",
            "doi",
            "expected_output_u32",
            "left_sha256",
            "observations",
            "operation",
            "oracle_sha256",
            "publisher",
            "right_sha256",
            "shape",
            "source_member",
            "source_sha256",
            "workload_id",
        ),
    )
    expected_metadata = {
        "all_observations_exact": True,
        "dataset_id": 53,
        "doi": "10.24432/C56C76",
        "left_sha256": "ba39b677d07ee0258c56d9dd0df40d1b42927255450399ec9b76c0858f4fc2ba",
        "operation": "transpose(X10) * X10",
        "oracle_sha256": ORACLE_SHA256,
        "publisher": "UCI Machine Learning Repository",
        "right_sha256": "658164630a3c710c59a6cddaa35b2e011c6b77746851ecb6369f1c2f80c3b417",
        "shape": {"k": 150, "m": 4, "n": 4},
        "source_member": "bezdekIris.data",
        "source_sha256": "0fed2a99db77ec533a62dc66894d3ec6df3b58b6a8f3cf4a6b47e4086b7f97dc",
        "workload_id": EXTERNAL_CASE,
    }
    for key, expected in expected_metadata.items():
        exact(workload[key], f"$.external_workload.{key}", expected)
    exact(workload["expected_output_u32"], "$.external_workload.expected_output_u32", list(EXPECTED_OUTPUT))
    oracle_bytes = b"".join(word.to_bytes(4, "little") for word in EXPECTED_OUTPUT)
    exact(hashlib.sha256(oracle_bytes).hexdigest(), "$.external_workload.expected_output_u32", ORACLE_SHA256)
    observations = array(workload["observations"], "$.external_workload.observations", 14)
    expected_identities = {
        ("c-run", compiler, threads, engine)
        for compiler in ("gcc", "clang")
        for threads in (1, 4)
        for engine in ("qqfenx-c11", "dense-c-blocked", "openblas-sgemm")
    }
    expected_identities |= {("onednn-run", "oneDNN", threads, "onednn-matmul-u8s8s32") for threads in (1, 4)}
    identities: set[tuple[Any, ...]] = set()
    keys = ("compiler", "engine", "exact_match", "output_fnv1a64", "retained_output_u32", "source", "threads")
    for index, value in enumerate(observations):
        path = f"$.external_workload.observations[{index}]"
        item = exact_keys(value, path, keys)
        exact(item["exact_match"], f"{path}.exact_match", True)
        exact(item["output_fnv1a64"], f"{path}.output_fnv1a64", OUTPUT_FNV1A64)
        exact(item["retained_output_u32"], f"{path}.retained_output_u32", list(EXPECTED_OUTPUT))
        identity = (item["source"], item["compiler"], item["threads"], item["engine"])
        if identity in identities:
            fail(path, "duplicate independent-oracle observation")
        identities.add(identity)
    if identities != expected_identities:
        fail("$.external_workload.observations", "independent-oracle observation coverage differs")


def validate_packed_proof(value: Any) -> None:
    proof = exact_keys(
        value,
        "$.packed_kernel_proof",
        (
            "backend",
            "binary_sha256",
            "compiler",
            "compiler_version",
            "q16",
            "q8",
            "status",
            "telemetry_instrumented",
            "timings_used_as_competitive_results",
        ),
    )
    exact(proof["status"], "$.packed_kernel_proof.status", "pass")
    exact(proof["telemetry_instrumented"], "$.packed_kernel_proof.telemetry_instrumented", True)
    exact(proof["timings_used_as_competitive_results"], "$.packed_kernel_proof.timings_used_as_competitive_results", False)
    exact(proof["backend"], "$.packed_kernel_proof.backend", "SSE4.1")
    exact(proof["compiler"], "$.packed_kernel_proof.compiler", "gcc")
    digest(proof["binary_sha256"], "$.packed_kernel_proof.binary_sha256")
    counter_keys = ("packed_avx2_q16_calls", "packed_avx2_q8_calls", "packed_sse41_q16_calls", "packed_sse41_q8_calls")
    q8 = exact_keys(proof["q8"], "$.packed_kernel_proof.q8", counter_keys)
    q16 = exact_keys(proof["q16"], "$.packed_kernel_proof.q16", counter_keys)
    for path, counters in (("$.packed_kernel_proof.q8", q8), ("$.packed_kernel_proof.q16", q16)):
        for key in counter_keys:
            nonnegative_integer(counters[key], f"{path}.{key}")
    positive_integer(q8["packed_sse41_q8_calls"], "$.packed_kernel_proof.q8.packed_sse41_q8_calls")
    positive_integer(q16["packed_sse41_q16_calls"], "$.packed_kernel_proof.q16.packed_sse41_q16_calls")


def validate_report_binding(value: Any) -> None:
    binding = exact_keys(
        value,
        "$.report_binding",
        (
            "canonical_payload_algorithm",
            "canonical_payload_sha256",
            "file_name",
            "file_sha256",
            "generated_at_utc",
            "schema",
            "source_commit",
            "source_dirty",
            "source_file_sha256",
            "source_tree",
            "status",
        ),
    )
    expected = {
        "canonical_payload_algorithm": "sha256",
        "canonical_payload_sha256": REPORT_CANONICAL_SHA256,
        "file_name": "i5-2500s-extent384-20260826.json",
        "file_sha256": REPORT_FILE_SHA256,
        "schema": REPORT_SCHEMA,
        "source_commit": SOURCE_COMMIT,
        "source_dirty": False,
        "source_tree": SOURCE_TREE,
        "status": "pass",
    }
    for key, expected_value in expected.items():
        exact(binding[key], f"$.report_binding.{key}", expected_value)
    nonempty_string(binding["generated_at_utc"], "$.report_binding.generated_at_utc")
    exact(binding["source_file_sha256"], "$.report_binding.source_file_sha256", SOURCE_FILE_SHA256)
    for key in ("canonical_payload_sha256", "file_sha256"):
        digest(binding[key], f"$.report_binding.{key}")
    if not isinstance(binding["source_commit"], str) or OID_RE.fullmatch(binding["source_commit"]) is None:
        fail("$.report_binding.source_commit", "must be a lowercase SHA-1 Git object ID")
    if not isinstance(binding["source_tree"], str) or OID_RE.fullmatch(binding["source_tree"]) is None:
        fail("$.report_binding.source_tree", "must be a lowercase SHA-1 Git object ID")


def validate_structural_metadata(record: dict[str, Any]) -> None:
    methodology = exact_keys(
        record["methodology"],
        "$.methodology",
        (
            "arithmetic",
            "clock",
            "cold_definition",
            "execution_order",
            "host_load_policy",
            "iris_external_exactness",
            "onednn_saturation_control",
            "onednn_thread_policy",
            "publication_policy",
            "q8_openblas_exactness",
            "ratio_direction",
            "scope_warning",
            "warm_definition",
        ),
    )
    for key, value in methodology.items():
        nonempty_string(value, f"$.methodology.{key}")
    exact(methodology["arithmetic"], "$.methodology.arithmetic", "wrapping-u32 modulo 2^32")
    host = exact_keys(
        record["host"],
        "$.host",
        (
            "architecture",
            "cores_per_socket",
            "cpu_max_mhz",
            "cpu_model",
            "kernel",
            "l1d_cache",
            "l1i_cache",
            "l2_cache",
            "l3_cache",
            "logical_cpus",
            "measurement_window",
            "memory_total_kib",
            "numa_nodes",
            "os",
            "process_affinity",
            "sockets",
            "threads_per_core",
        ),
    )
    exact(host["architecture"], "$.host.architecture", "x86_64")
    positive_integer(host["logical_cpus"], "$.host.logical_cpus")
    positive_integer(host["memory_total_kib"], "$.host.memory_total_kib")
    exact(host["process_affinity"], "$.host.process_affinity", [0, 1, 2, 3])


def validate_record(record: Any) -> None:
    root = exact_keys(record, "$", ROOT_KEYS)
    exact(root["schema"], "$.schema", SCHEMA)
    exact(root["product"], "$.product", PRODUCT)
    exact(root["license"], "$.license", LICENSE)
    exact(root["status"], "$.status", "pass")
    validate_builds(root["builds"])
    validate_configuration(root["configuration"])
    validate_coverage(root["coverage"])
    validate_measurements(root["measurements"])
    validate_comparisons(root["direct_comparisons"])
    validate_scaling(root["scaling"])
    validate_external_workload(root["external_workload"])
    validate_packed_proof(root["packed_kernel_proof"])
    validate_report_binding(root["report_binding"])
    validate_structural_metadata(root)


def no_duplicate_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail("$", f"duplicate JSON property {key!r}")
        result[key] = value
    return result


def reject_nonfinite(token: str) -> None:
    fail("$", f"non-finite JSON number {token!r} is forbidden")


def canonical_bytes(record: Any) -> bytes:
    try:
        text = json.dumps(
            record,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
            allow_nan=False,
        )
    except (TypeError, ValueError) as error:
        raise ValidationError(f"$: record cannot be encoded canonically: {error}") from error
    return (text + "\n").encode("utf-8")


def load_canonical_bytes(data: bytes) -> dict[str, Any]:
    if not data or len(data) > MAX_CERTIFICATE_BYTES:
        fail("$", "certificate byte length is empty or exceeds the fixed bound")
    if not data.endswith(b"\n") or data.endswith(b"\n\n"):
        fail("$", "canonical JSON must have exactly one final newline")
    try:
        text = data.decode("utf-8", errors="strict")
        record = json.loads(
            text,
            object_pairs_hook=no_duplicate_object,
            parse_constant=reject_nonfinite,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValidationError(f"invalid UTF-8 JSON: {error}") from error
    validate_record(record)
    if data != canonical_bytes(record):
        fail("$", "bytes are not compact, key-sorted canonical JSON with one final newline")
    return record


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_bundle(bundle_root: Path) -> dict[str, Any]:
    if bundle_root.is_symlink() or not bundle_root.is_dir():
        fail(str(bundle_root), "bundle root must be a real directory")
    entries = list(bundle_root.iterdir())
    observed_names = {entry.name for entry in entries}
    if observed_names != set(FILE_SHA256):
        missing = sorted(set(FILE_SHA256) - observed_names)
        extra = sorted(observed_names - set(FILE_SHA256))
        fail(str(bundle_root), f"bundle file set changed (missing={missing}, extra={extra})")
    files = {name: bundle_root / name for name in FILE_SHA256}
    for name, path in files.items():
        if path.is_symlink() or not path.is_file():
            fail(str(path), "bundle member must be a regular non-symlink file")
    raw = {name: path.read_bytes() for name, path in files.items()}
    for name, expected in FILE_SHA256.items():
        exact(sha256(raw[name]), str(files[name]), expected)
    record = load_canonical_bytes(raw[CERTIFICATE_NAME])

    try:
        signature_text = raw[SIGNATURE_NAME].decode("ascii", errors="strict")
        key_text = raw[PUBLIC_KEY_NAME].decode("ascii", errors="strict")
    except UnicodeDecodeError as error:
        raise ValidationError("signature and public key must be strict ASCII") from error
    signature_lines = signature_text.splitlines()
    if signature_lines[:1] != ["-----BEGIN SSH SIGNATURE-----"] or signature_lines[-1:] != ["-----END SSH SIGNATURE-----"]:
        fail(str(files[SIGNATURE_NAME]), "must be an armored OpenSSH SSHSIG")
    if not key_text.endswith("\n") or key_text.count("\n") != 1:
        fail(str(files[PUBLIC_KEY_NAME]), "must contain exactly one newline-terminated public key")
    key_line = key_text[:-1]
    key_fields = key_line.split()
    if len(key_fields) < 2 or key_fields[0] != "ssh-ed25519":
        fail(str(files[PUBLIC_KEY_NAME]), "must contain an OpenSSH Ed25519 public key")
    try:
        key_blob = base64.b64decode(key_fields[1], validate=True)
    except ValueError as error:
        raise ValidationError(f"{files[PUBLIC_KEY_NAME]}: invalid public-key base64") from error
    fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(key_blob).digest()).decode("ascii").rstrip("=")
    exact(fingerprint, str(files[PUBLIC_KEY_NAME]), KEY_FINGERPRINT)
    expected_policy = f'{PRINCIPAL} namespaces="{NAMESPACE}" {key_line}\n'.encode("ascii")
    exact(raw[ALLOWED_SIGNERS_NAME], str(files[ALLOWED_SIGNERS_NAME]), expected_policy)

    ssh_keygen = shutil.which("ssh-keygen")
    if ssh_keygen is None:
        fail("ssh-keygen", "OpenSSH is required to authenticate the SSHSIG")
    try:
        result = subprocess.run(
            [
                ssh_keygen,
                "-Y",
                "verify",
                "-f",
                str(files[ALLOWED_SIGNERS_NAME]),
                "-I",
                PRINCIPAL,
                "-n",
                NAMESPACE,
                "-s",
                str(files[SIGNATURE_NAME]),
            ],
            input=raw[CERTIFICATE_NAME],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=15,
        )
    except subprocess.TimeoutExpired as error:
        raise ValidationError("ssh-keygen: signature authentication timed out") from error
    if result.returncode != 0:
        fail(str(files[SIGNATURE_NAME]), "OpenSSH SSHSIG authentication failed")
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--record", type=Path, help="validate canonical certificate bytes without authenticating the bundle")
    choice.add_argument("--bundle-root", type=Path, help="validate and authenticate the complete signed bundle")
    args = parser.parse_args()
    try:
        if args.record is not None:
            load_canonical_bytes(args.record.read_bytes())
        else:
            verify_bundle(args.bundle_root)
    except (OSError, ValidationError) as error:
        print(f"QQfenx performance validation failed: {error}", file=sys.stderr)
        return 1
    print("QQfenx performance validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
