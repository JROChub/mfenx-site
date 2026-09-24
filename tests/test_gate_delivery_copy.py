"""Commercial publication checks for the customer-operated launch offer."""
from html.parser import HTMLParser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1] / "public"


class Rows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        if tag in ("th", "td") and self.row is not None:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("th", "td") and self.cell is not None:
            self.row.append(" ".join(" ".join(self.cell).split()))
            self.cell = None
        if tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None


class DeliveryCopy(unittest.TestCase):
    def test_launch_prices_and_deployment_match_customer_operated_offer(self):
        parser = Rows()
        parser.feed((ROOT / "pricing/index.html").read_text())
        rows = {row[0]: row[1:] for row in parser.rows[1:]}
        self.assertEqual(set(rows), {"Team", "Business", "Private"})
        for plan, price, period in (("Team", "$399", "month"),
                                    ("Business", "$1,499", "month"),
                                    ("Private", "$24,000", "year")):
            self.assertEqual(rows[plan][0], f"{price} per {period}")
            self.assertEqual(rows[plan][2], "Customer environment")
        self.assertIn("/ organization / month", rows["Team"][1])
        self.assertIn("/ organization / month", rows["Business"][1])

    def test_no_checkout_before_delivery_and_activation(self):
        source = (ROOT / "pricing/index.html").read_text()
        self.assertNotIn("/account/", source)
        self.assertNotIn("pay.paddle", source)
        self.assertNotIn("Managed service", source)
        self.assertIn("No payment is collected on this page.", source)
        self.assertIn("software\n        delivery and live payment activation", source)

    def test_free_verification_is_not_an_organization_subscription(self):
        source = (ROOT / "pricing/index.html").read_text()
        self.assertIn("Unlimited receipt verification", source)
        self.assertIn('href="/verify/"', source)
        self.assertIn('href="/gate/downloads/VERIFIER-TERMS.txt"', source)
        self.assertIn("Receipt verification does not consume an allowance.", source)


if __name__ == "__main__":
    unittest.main()
