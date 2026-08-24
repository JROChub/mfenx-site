#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("commercial_status", ROOT / "scripts/commercial_status.py")
assert SPEC and SPEC.loader
commercial_status = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(commercial_status)
FIXTURE = ROOT / "tests/fixtures/commercial-status.valid.json"


class CommercialStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.raw = FIXTURE.read_bytes()
        self.record = commercial_status.load_canonical_bytes(self.raw)

    def test_valid_fixture_is_canonical_and_complete(self) -> None:
        self.assertEqual(commercial_status.canonical_bytes(self.record), self.raw)

    def test_rejects_a_license_semantics_change(self) -> None:
        changed = copy.deepcopy(self.record)
        changed["licensing"]["source_available"] = True
        with self.assertRaises(commercial_status.ValidationError):
            commercial_status.validate_record(changed)

    def test_rejects_a_measured_cell_change(self) -> None:
        changed = copy.deepcopy(self.record)
        changed["technical_evidence"]["scaling"]["cells"][2]["speedup_decimal"] = "9.999999"
        with self.assertRaises(commercial_status.ValidationError):
            commercial_status.validate_record(changed)

    def test_rejects_unknown_properties(self) -> None:
        changed = copy.deepcopy(self.record)
        changed["marketing"] = {}
        with self.assertRaises(commercial_status.ValidationError):
            commercial_status.validate_record(changed)

    def test_rejects_noncanonical_bytes(self) -> None:
        pretty = (json.dumps(self.record, indent=2, sort_keys=True) + "\n").encode()
        with self.assertRaises(commercial_status.ValidationError):
            commercial_status.load_canonical_bytes(pretty)

    def test_rejects_duplicate_json_properties(self) -> None:
        duplicate = self.raw.replace(b'{"effective_at_utc":', b'{"schema":"duplicate","effective_at_utc":', 1)
        with self.assertRaises(commercial_status.ValidationError):
            commercial_status.load_canonical_bytes(duplicate)


if __name__ == "__main__":
    unittest.main()
