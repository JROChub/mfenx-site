"""Prevent accidentally republishing or linking the retired game."""
from html.parser import HTMLParser
from pathlib import Path
import unittest
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1] / "public"


class References(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.targets = []
        self.feed(source)

    def handle_starttag(self, _tag, attrs):
        self.targets.extend(value for name, value in attrs if name in {"href", "src"} and value)


class RetiredAtomic(unittest.TestCase):
    def test_game_payload_is_not_published(self):
        self.assertFalse((ROOT / "lightsout/atomic").exists())

    def test_no_public_document_links_or_loads_retired_game(self):
        for path in ROOT.rglob("*.html"):
            base = "https://mfenx.com/" + path.relative_to(ROOT).as_posix()
            for target in References(path.read_text()).targets:
                resolved = urlsplit(urljoin(base, target))
                if resolved.hostname in {"mfenx.com", "www.mfenx.com"}:
                    self.assertFalse(resolved.path.rstrip("/") == "/lightsout/atomic" or
                                     resolved.path.startswith("/lightsout/atomic/"), (path, target))

    def test_no_public_document_promotes_retired_game(self):
        for path in ROOT.rglob("*.html"):
            self.assertNotIn("atomic roc roc", path.read_text().lower(), path)


if __name__ == "__main__":
    unittest.main()
