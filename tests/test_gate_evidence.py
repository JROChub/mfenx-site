"""Keep the public measured specimen tied to its actual retained execution."""
import hashlib
import json
from pathlib import Path
import unittest
import tempfile
import zipfile

from scripts.build_gate_technical_pack import MEMBERS, build

ROOT = Path(__file__).resolve().parents[1] / "public"


def digest(path):
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


class GateEvidence(unittest.TestCase):
    def setUp(self):
        self.example = ROOT / "verify/example"
        self.evidence = ROOT / "evidence/onnx-release"
        self.receipt = json.loads((self.example / "release-receipt.json").read_text())
        self.statement = self.receipt["statement"]
        self.report = json.loads((self.evidence / "evaluation-report.json").read_text())

    def test_exact_report_and_contract_are_bound(self):
        self.assertEqual(self.statement["evaluation"]["report_sha256"], digest(self.evidence / "evaluation-report.json"))
        self.assertEqual(self.statement["contract_sha256"], digest(self.evidence / "approved-contract.json"))
        self.assertEqual(self.report["decision"], "PASS")

    def test_actual_input_files_match_execution(self):
        for label, name in (("source", "source.onnx"), ("candidate", "candidate.onnx"), ("dataset", "dataset.npz")):
            path = self.evidence / name
            self.assertEqual(self.report["artifacts"][label]["sha256"], digest(path))
            self.assertEqual(self.report["artifacts"][label]["bytes"], path.stat().st_size)
        self.assertEqual((self.example / "model.onnx").read_bytes(), (self.evidence / "candidate.onnx").read_bytes())
        self.assertEqual(self.statement["parent_sha256"], digest(self.evidence / "source.onnx"))
        self.assertEqual(self.receipt["issuer"]["key_id"], digest(self.example / "issuer-public.der"))

    def test_published_counts_match_raw_observations(self):
        raw = self.report["raw_observation_evidence"]
        labels, source, candidate = (raw[k] for k in ("labels", "source_decisions", "candidate_decisions"))
        self.assertEqual(len(labels), len(source))
        self.assertEqual(len(labels), len(candidate))
        observed = {"samples": len(labels), "source_correct": sum(a == b for a, b in zip(source, labels)),
                    "candidate_correct": sum(a == b for a, b in zip(candidate, labels)),
                    "decision_changes": sum(a != b for a, b in zip(source, candidate))}
        self.assertEqual(observed, {"samples": 1797, "source_correct": 1729, "candidate_correct": 1729, "decision_changes": 0})
        for key, value in observed.items():
            self.assertEqual(self.statement["evaluation"][key], value)
        self.assertEqual(self.statement["evaluation"]["candidate_p95_latency_ns"], self.report["measurements"]["candidate_p95_latency_ns"])
        summary = json.loads((self.example / "evidence.json").read_text())
        self.assertEqual(summary["evaluation"], self.statement["evaluation"])

    def test_demonstration_is_identified_and_no_private_hostname(self):
        self.assertEqual(self.receipt["issuer"]["name"], "MFENX demonstration key")
        self.assertEqual(self.report["device"]["observed_before"]["node_name"], "mfenx-gate-validation")
        self.assertEqual(self.report["device"]["observed_after"]["node_name"], "mfenx-gate-validation")
        self.assertEqual(self.report["authentication"], "none")

    def test_sdk_inventory_identifies_the_distributed_wheel(self):
        record = json.loads((ROOT / "enterprise/GATE-SBOM.validation.json").read_text())
        self.assertEqual(record["sbom_sha256"], digest(ROOT / "enterprise/GATE-SBOM.cdx.json").removeprefix("sha256:"))
        self.assertEqual(record["frozen_wheel_sha256"], digest(ROOT / "gate/downloads/mfenx_gate-1.0.0-py3-none-any.whl").removeprefix("sha256:"))
        self.assertEqual(record["status"], "PASS")

    def test_technical_pack_has_exact_allowlisted_content(self):
        path = ROOT / "enterprise/mfenx-gate-technical-pack-v1.zip"
        with zipfile.ZipFile(path) as archive:
            self.assertEqual(set(archive.namelist()), set(MEMBERS))
            self.assertEqual(len(archive.namelist()), len(MEMBERS))
            for name, relative in MEMBERS.items():
                self.assertEqual(archive.read(name), (ROOT / relative).read_bytes())
        with tempfile.TemporaryDirectory() as temporary:
            repeat = Path(temporary) / "pack.zip"
            build(ROOT, repeat)
            self.assertEqual(repeat.read_bytes(), path.read_bytes())


if __name__ == "__main__":
    unittest.main()
