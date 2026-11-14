"""Retired routes require observed absence, not an unavailable edge response."""
import unittest
from unittest.mock import patch
from urllib.error import URLError

from scripts import verify_live as live


class BlockedRouteVerification(unittest.TestCase):
    origin = "https://mfenx.com"
    route = "/retired-fixture"

    def verify(self, responses):
        with patch.object(live, "BLOCKED_ROUTES", (self.route,)), \
                patch.object(live, "request_bytes", side_effect=responses) as request, \
                patch.object(live.time, "sleep") as sleep:
            errors = live.verify_blocked(self.origin)
        return errors, request.call_count, sleep.call_args_list

    def response(self, status, host=None):
        return status, b"fixture", (host or self.origin) + self.route

    def test_transient_unavailability_requires_subsequent_actual_404(self):
        errors, calls, sleeps = self.verify([self.response(503), self.response(429), self.response(404)])
        self.assertEqual(errors, [])
        self.assertEqual(calls, 3)
        self.assertEqual([call.args[0] for call in sleeps], [1.0, 2.0])

    def test_persistent_unavailability_fails_after_bounded_attempts(self):
        errors, calls, sleeps = self.verify([self.response(503)] * 4)
        self.assertEqual(calls, 4)
        self.assertEqual(len(sleeps), 3)
        self.assertEqual(errors, [self.route + ": expected HTTP 404, received 503"])

    def test_exposed_retired_content_cannot_be_hidden_by_a_later_404(self):
        errors, calls, _ = self.verify([self.response(200), self.response(404)])
        self.assertEqual(calls, 1)
        self.assertEqual(errors, [self.route + ": expected HTTP 404, received 200"])

    def test_external_404_is_not_absence_on_the_canonical_host(self):
        errors, calls, _ = self.verify([self.response(404, "https://outside.invalid")])
        self.assertEqual(calls, 1)
        self.assertIn("redirected outside canonical host", errors[0])

    def test_network_failure_can_recover_only_to_observed_404(self):
        errors, calls, _ = self.verify([URLError("edge unavailable"), self.response(404)])
        self.assertEqual(errors, [])
        self.assertEqual(calls, 2)

    def test_persistent_network_failure_is_not_a_passing_boundary(self):
        errors, calls, _ = self.verify([TimeoutError("edge unavailable")] * 4)
        self.assertEqual(calls, 4)
        self.assertIn("request failed", errors[0])


if __name__ == "__main__":
    unittest.main()
