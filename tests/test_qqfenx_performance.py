#!/usr/bin/env python3
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "public/lightsout/qqfenx-performance-v0.1.4"
CERTIFICATE = BUNDLE / "QQFENX-PERFORMANCE-CERTIFICATE.canonical.json"
SPEC = importlib.util.spec_from_file_location(
    "qqfenx_performance", ROOT / "scripts/qqfenx_performance.py"
)
assert SPEC and SPEC.loader
qqfenx_performance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(qqfenx_performance)


class QqfenxPerformanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.raw = CERTIFICATE.read_bytes()
        cls.record = qqfenx_performance.load_canonical_bytes(cls.raw)

    def changed(self) -> dict[str, object]:
        return copy.deepcopy(self.record)

    def assert_record_rejected(self, record: object) -> None:
        with self.assertRaises(qqfenx_performance.ValidationError):
            qqfenx_performance.validate_record(record)

    def test_valid_certificate_is_canonical_and_complete(self) -> None:
        self.assertEqual(qqfenx_performance.canonical_bytes(self.record), self.raw)
        self.assertEqual(
            hashlib.sha256(self.raw).hexdigest(),
            qqfenx_performance.FILE_SHA256[qqfenx_performance.CERTIFICATE_NAME],
        )

    def test_authenticates_complete_public_bundle(self) -> None:
        verified = qqfenx_performance.verify_bundle(BUNDLE)
        self.assertEqual(verified, self.record)

    def test_rejects_noncanonical_and_ambiguous_json(self) -> None:
        pretty = (json.dumps(self.record, indent=2, sort_keys=True) + "\n").encode()
        duplicate = self.raw.replace(
            b'{"builds":', b'{"schema":"duplicate","builds":', 1
        )
        candidates = {
            "pretty": pretty,
            "missing-final-newline": self.raw[:-1],
            "extra-final-newline": self.raw + b"\n",
            "duplicate-property": duplicate,
        }
        for label, candidate in candidates.items():
            with self.subTest(label=label):
                with self.assertRaises(qqfenx_performance.ValidationError):
                    qqfenx_performance.load_canonical_bytes(candidate)

    def test_rejects_root_identity_and_license_mutations(self) -> None:
        mutations = (
            (("schema",), "wrong.schema"),
            (("product", "name"), "QCascade"),
            (("product", "vendor"), "Other"),
            (("product", "release"), "v0.1.3"),
            (("license",), "Apache-2.0"),
            (("status",), "fail"),
        )
        for path, value in mutations:
            with self.subTest(path=path):
                changed = self.changed()
                target = changed
                for key in path[:-1]:
                    target = target[key]  # type: ignore[index,assignment]
                target[path[-1]] = value  # type: ignore[index]
                self.assert_record_rejected(changed)

    def test_rejects_report_binding_mutations(self) -> None:
        mutations = {
            "file_sha256": "0" * 64,
            "canonical_payload_sha256": "1" * 64,
            "source_commit": "2" * 40,
            "source_tree": "3" * 40,
            "source_dirty": True,
            "status": "fail",
        }
        for field, value in mutations.items():
            with self.subTest(field=field):
                changed = self.changed()
                changed["report_binding"][field] = value
                self.assert_record_rejected(changed)

    def test_rejects_source_closure_mutation(self) -> None:
        changed = self.changed()
        changed["report_binding"]["source_file_sha256"][
            "native/qqfenx/qqfenx.c"
        ] = "0" * 64
        self.assert_record_rejected(changed)

    def test_rejects_packed_kernel_proof_mutations(self) -> None:
        mutations = (
            ("status", "fail"),
            ("telemetry_instrumented", False),
            ("timings_used_as_competitive_results", True),
        )
        for field, value in mutations:
            with self.subTest(field=field):
                changed = self.changed()
                changed["packed_kernel_proof"][field] = value
                self.assert_record_rejected(changed)
        for quotient, counter in (
            ("q8", "packed_sse41_q8_calls"),
            ("q16", "packed_sse41_q16_calls"),
        ):
            with self.subTest(quotient=quotient):
                changed = self.changed()
                changed["packed_kernel_proof"][quotient][counter] = 0
                self.assert_record_rejected(changed)

    def test_rejects_measurement_count_and_exactness_mutations(self) -> None:
        changed = self.changed()
        changed["measurements"]["c_engines"].pop()
        self.assert_record_rejected(changed)

        for collection in ("c_engines", "onednn_engines"):
            with self.subTest(collection=collection):
                changed = self.changed()
                changed["measurements"][collection][0]["exact_match"] = False
                self.assert_record_rejected(changed)

    def test_rejects_measurement_coverage_and_work_partition_mutations(self) -> None:
        changed = self.changed()
        changed["measurements"]["c_engines"][0]["case"] = "synthetic-q16"
        self.assert_record_rejected(changed)

        changed = self.changed()
        changed["measurements"]["c_engines"][0]["work"]["executed_macs"] -= 1
        self.assert_record_rejected(changed)

    def test_rejects_direct_comparison_mutations(self) -> None:
        changed = self.changed()
        changed["direct_comparisons"].pop()
        self.assert_record_rejected(changed)

        for field in ("same_observed_output", "ratio_published"):
            with self.subTest(field=field):
                changed = self.changed()
                changed["direct_comparisons"][0][field] = False
                self.assert_record_rejected(changed)

        changed = self.changed()
        below_one = next(
            comparison
            for comparison in changed["direct_comparisons"]
            if comparison["baseline_over_candidate_prepared"] < 1.0
        )
        below_one["baseline_over_candidate_prepared"] = 1.25
        self.assert_record_rejected(changed)

    def test_rejects_qqfenx_scaling_count_and_identity_mutations(self) -> None:
        changed = self.changed()
        changed["scaling"]["qqfenx_1_to_4_lanes"].pop()
        self.assert_record_rejected(changed)

        changed = self.changed()
        changed["scaling"]["qqfenx_1_to_4_lanes"][0]["active_lanes"] = 3
        self.assert_record_rejected(changed)

    def test_rejects_external_oracle_mutations(self) -> None:
        changed = self.changed()
        changed["external_workload"]["observations"].pop()
        self.assert_record_rejected(changed)

        changed = self.changed()
        changed["external_workload"]["observations"][0]["exact_match"] = False
        self.assert_record_rejected(changed)

        changed = self.changed()
        changed["external_workload"]["observations"][0]["retained_output_u32"][0] += 1
        self.assert_record_rejected(changed)

        changed = self.changed()
        changed["external_workload"]["oracle_sha256"] = "0" * 64
        self.assert_record_rejected(changed)

    def test_rejects_declared_coverage_mutation(self) -> None:
        changed = self.changed()
        changed["coverage"]["published_direct_ratio_values_below_one_count"] = 39
        self.assert_record_rejected(changed)

    def test_rejects_unknown_properties(self) -> None:
        changed = self.changed()
        changed["marketing"] = {}
        self.assert_record_rejected(changed)

    def test_rejects_each_pinned_bundle_member_mutation(self) -> None:
        for name in qqfenx_performance.FILE_SHA256:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                copied = Path(temporary) / "bundle"
                shutil.copytree(BUNDLE, copied)
                path = copied / name
                path.write_bytes(path.read_bytes() + b"x")
                with self.assertRaises(qqfenx_performance.ValidationError):
                    qqfenx_performance.verify_bundle(copied)

    def test_rejects_bundle_file_set_expansion(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            copied = Path(temporary) / "bundle"
            shutil.copytree(BUNDLE, copied)
            (copied / "unreviewed.txt").write_text("unreviewed\n", encoding="ascii")
            with self.assertRaises(qqfenx_performance.ValidationError):
                qqfenx_performance.verify_bundle(copied)


if __name__ == "__main__":
    unittest.main()
