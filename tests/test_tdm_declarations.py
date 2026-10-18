"""Every published page and the site root carry the text-and-data-mining reservation."""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import apply_tdm_declarations as tdm  # noqa: E402

PUBLIC = ROOT / "public"
POLICY = "https://mfenx.com/tweek/policy/no-ai/"
AI_AGENTS = ("GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "Bytespider", "PerplexityBot", "meta-externalagent")


class TdmDeclarations(unittest.TestCase):
    def test_every_page_declares_reservation(self) -> None:
        pages = sorted(PUBLIC.rglob("*.html"))
        self.assertTrue(pages)
        for page in pages:
            text = page.read_text(encoding="utf-8")
            head = text[: text.lower().find("</head>")]
            with self.subTest(page=page.relative_to(PUBLIC).as_posix()):
                self.assertRegex(head, r'<meta name="tdm-reservation" content="1"\s*/?>')
                self.assertRegex(head, r'<meta name="tdm-policy" content="' + re.escape(POLICY) + r'"\s*/?>')
                robots = re.findall(r'<meta name="robots" content="([^"]*)"', head)
                self.assertEqual(len(robots), 1, "exactly one robots meta")
                self.assertIn("noai", robots[0])
                self.assertEqual(len(re.findall(r'name="tdm-reservation"', head)), 1)

    def test_apply_is_idempotent_and_merges_robots(self) -> None:
        page = '<!doctype html>\n<html>\n  <head>\n    <meta charset="utf-8" />\n    <meta name="robots" content="noindex" />\n  </head>\n</html>\n'
        once = tdm.apply(page)
        self.assertIn('<meta name="robots" content="noindex, noai, noimageai" />', once)
        self.assertIn('<meta name="tdm-reservation" content="1" />', once)
        self.assertEqual(tdm.apply(once), once)
        plain = tdm.apply('<html><head><meta charset="UTF-8"><title>x</title></head></html>')
        self.assertIn('<meta name="tdm-policy" content="' + POLICY + '">', plain)
        self.assertEqual(plain.count('name="robots"'), 1)

    def test_policy_page_exists_and_matches(self) -> None:
        policy_page = PUBLIC / "tweek" / "policy" / "no-ai" / "index.html"
        self.assertTrue(policy_page.is_file())
        self.assertIn('<meta name="tdm-policy" content="' + POLICY + '"', policy_page.read_text(encoding="utf-8"))

    def test_robots_txt_blocks_ai_agents_without_blocking_search(self) -> None:
        text = (PUBLIC / "robots.txt").read_text(encoding="utf-8")
        for agent in AI_AGENTS:
            self.assertRegex(text, rf"User-agent: {re.escape(agent)}\nDisallow: /\n")
        self.assertNotRegex(text, r"User-agent: \*\nDisallow: /\n", "search engines stay allowed")
        self.assertIn("Sitemap: https://mfenx.com/sitemap.txt", text)
        for line in (PUBLIC / "sitemap.txt").read_text(encoding="utf-8").splitlines():
            self.assertTrue(line.startswith("https://mfenx.com/"), line)

    def test_tdmrep_json(self) -> None:
        data = json.loads((PUBLIC / ".well-known" / "tdmrep.json").read_text(encoding="utf-8"))
        self.assertEqual(data, [{"location": "/*", "tdm-reservation": 1, "tdm-policy": POLICY}])

    def test_checker_passes_on_tree(self) -> None:
        self.assertEqual(tdm.check_files(PUBLIC), [])


if __name__ == "__main__":
    unittest.main()
