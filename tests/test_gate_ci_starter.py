"""Check the published CI starter with public demonstration trust only."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
STARTER = PUBLIC / "docs/model-release.yml"
WHEEL = PUBLIC / "gate/downloads/mfenx_gate-1.0.0-py3-none-any.whl"
FIXTURE = PUBLIC / "verify/example"
WHEEL_SHA = "aac76f6f516f93d5aeb58f373ec747b34acc790fafabcbb3643f26b1f9365b4d"
ACTION_SHA = "3b0ede631c1038bbdf76e3a1a1b439606f14e9a6"
CHECKOUT_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1"


class GateCIStarter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = STARTER.read_text()
        cls.approved = json.loads((FIXTURE / "release-receipt.json").read_text())["statement"]["contract_sha256"]
        cls.key = base64.b64encode((FIXTURE / "issuer-public.der").read_bytes()).decode()
        cls.trust_script = cls.source.split("      - name: Write independently approved public trust\n", 1)[1].split("      - name:", 1)[0].split("        run: |\n", 1)[1]
        cls.trust_script = "\n".join(line[10:] for line in cls.trust_script.splitlines())

    def test_immutable_dependencies_and_read_only_manual_scope(self):
        self.assertEqual(hashlib.sha256(WHEEL.read_bytes()).hexdigest(), WHEEL_SHA)
        self.assertEqual(re.findall(r"^        uses: (.+)$", self.source, re.M), [
            "actions/checkout@" + CHECKOUT_SHA, "JROChub/model-gate-action@" + ACTION_SHA])
        self.assertIn("on:\n  workflow_dispatch:\n", self.source)
        self.assertIn("permissions:\n  contents: read\n", self.source)
        self.assertIn("    environment: model-release\n", self.source)
        self.assertIn("          persist-credentials: false\n", self.source)
        self.assertIn("ref: ${{ github.event.repository.default_branch }}", self.source)
        self.assertIn(WHEEL_SHA, self.source)
        self.assertIn("sha256sum --check --strict", self.source)
        self.assertIn("--max-time 60 --max-filesize 10485760", self.source)
        for forbidden in ("pull_request:", "pull_request_target:", "contents: write", "id-token: write", "continue-on-error", "secrets.", "@v1", "admit-onnx", "keygen"):
            self.assertNotIn(forbidden, self.source)
        self.assertEqual(re.findall(r"^          ([a-z0-9-]+):", self.source.split("uses: JROChub/model-gate-action@", 1)[1], re.M), ["receipt", "model", "trusted-public-key", "approved-contract-sha256"])

    def test_shell_blocks_parse_without_execution(self):
        blocks = re.findall(r"        run: \|\n((?:          .*\n|\n)+)", self.source)
        self.assertEqual(len(blocks), 2)
        for block in blocks:
            script = "\n".join(line[10:] for line in block.splitlines())
            result = subprocess.run(["bash", "-n"], input=script, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def trust(self, directory, **overrides):
        env = {**os.environ, "RUNNER_TEMP": directory, "MFENX_TRUST_SPKI": self.key,
               "MFENX_APPROVED_CONTRACT": self.approved, **overrides}
        return subprocess.run(["bash", "-c", self.trust_script], env=env, cwd=directory, capture_output=True, timeout=10)

    def verify(self, directory, **overrides):
        values = {"receipt": str(FIXTURE / "release-receipt.json"), "model": str(FIXTURE / "model.onnx"),
                  "key": str(Path(directory) / "mfenx-issuer.der"), "policy": self.approved, **overrides}
        # These positional/option bindings match the reviewed pinned composite action.
        command = [sys.executable, "-m", "mfenx_gate", "verify", "--trusted-public-key=" + values["key"],
                   "--model=" + values["model"], "--expected-contract-sha256=" + values["policy"], "--", values["receipt"]]
        return subprocess.run(command, cwd=directory, env={**os.environ, "PYTHONPATH": str(WHEEL)},
                              capture_output=True, text=True, timeout=20)

    def test_valid_fixture_has_explicit_no_replay_result(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(self.trust(directory).returncode, 0)
            self.assertEqual((Path(directory) / "mfenx-issuer.der").read_bytes(), (FIXTURE / "issuer-public.der").read_bytes())
            result = self.verify(directory)
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(result.stdout)
            self.assertEqual(data["status"], "ATTESTATION_VERIFIED")
            self.assertEqual(data["artifactStatus"], "MATCH")
            self.assertEqual(data["contractStatus"], "MATCH")
            self.assertEqual(data["replayStatus"], "NOT_PERFORMED")

    def test_missing_or_malformed_protected_configuration_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            for overrides in ({"MFENX_TRUST_SPKI": ""}, {"MFENX_TRUST_SPKI": "not base64!"},
                              {"MFENX_APPROVED_CONTRACT": ""}, {"MFENX_APPROVED_CONTRACT": "--help"},
                              {"MFENX_APPROVED_CONTRACT": "sha256:" + "A" * 64},
                              {"MFENX_APPROVED_CONTRACT": "$(touch injected)"}):
                with self.subTest(overrides=overrides):
                    self.assertNotEqual(self.trust(directory, **overrides).returncode, 0)
            self.assertFalse((Path(directory) / "injected").exists())

    def test_wrong_policy_changed_model_and_option_like_inputs_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(self.trust(directory).returncode, 0)
            for key in ("receipt", "model", "key", "policy"):
                with self.subTest(key=key):
                    self.assertNotEqual(self.verify(directory, **{key: "--help"}).returncode, 0)
            wrong = "sha256:" + ("1" if self.approved == "sha256:" + "0" * 64 else "0") * 64
            self.assertNotEqual(self.verify(directory, policy=wrong).returncode, 0)
            changed = Path(directory) / "changed.onnx"
            changed.write_bytes(b"changed artifact")
            self.assertNotEqual(self.verify(directory, model=str(changed)).returncode, 0)

    def test_docs_explain_setup_and_verification_boundary(self):
        docs = (PUBLIC / "docs/index.html").read_text()
        for text in ('href="/docs/model-release.yml" download', "MODEL_RELEASE_TRUST_SPKI_BASE64",
                     "MODEL_RELEASE_CONTRACT_SHA256", "protected default branch", "required",
                     "No\n            signing private key", "replayStatus: NOT_PERFORMED", "exact bytes that passed"):
            self.assertIn(text, docs)


if __name__ == "__main__":
    unittest.main()
