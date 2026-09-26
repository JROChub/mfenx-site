"""Static contract checks for the owner-approved customer software terms."""

import hashlib
from html.parser import HTMLParser
from pathlib import Path
import unittest
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1] / "public"
PAGES = ("terms", "privacy", "refunds", "support")
CONTACT = "mailto:lexluger.dev@proton.me"


class Document(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.tags, self.links, self.ids, self.text = [], [], [], []
        self.footer_links, self.in_footer = [], False
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append((tag, attrs))
        if tag == "footer":
            self.in_footer = True
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "a":
            self.links.append(attrs.get("href", ""))
            if self.in_footer:
                self.footer_links.append(attrs.get("href", ""))

    def handle_endtag(self, tag):
        if tag == "footer":
            self.in_footer = False

    def handle_data(self, data):
        self.text.append(data)

    @property
    def prose(self):
        return " ".join(" ".join(self.text).split())


class LegalPages(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pages = {page: Document((ROOT / page / "index.html").read_text()) for page in PAGES}

    def test_pages_have_semantic_landmarks_shared_style_and_current_navigation(self):
        for name, page in self.pages.items():
            with self.subTest(page=name):
                for tag in ("html", "title", "h1", "main", "footer"):
                    self.assertEqual(sum(t == tag for t, _ in page.tags), 1)
                self.assertIn(("html", {"lang": "en"}), page.tags)
                self.assertIn(("link", {"rel": "stylesheet", "href": "/gate.css"}), page.tags)
                self.assertIn(("link", {"rel": "canonical", "href": f"https://mfenx.com/{name}/"}), page.tags)
                self.assertIn("#content", page.links)
                self.assertEqual(len(page.ids), len(set(page.ids)))
                self.assertTrue({"/gate/", "/verify/", "/docs/", "/pricing/", "/labs/"} <= set(page.links))
                self.assertTrue({f"/{p}/" for p in PAGES} <= set(page.links))
                self.assertTrue(any(t == "a" and a.get("href") == f"/{name}/"
                                    and a.get("aria-current") == "page" for t, a in page.tags))
                self.assertIn("mfenx LLC", page.prose)

    def test_all_local_links_and_fragment_targets_resolve(self):
        for name, page in self.pages.items():
            for link in page.links:
                with self.subTest(page=name, link=link):
                    target = urlsplit(link)
                    if target.scheme or target.netloc:
                        continue
                    if target.path:
                        self.assertTrue(target.path.startswith("/"))
                        destination = ROOT / target.path.lstrip("/")
                        if target.path.endswith("/"):
                            destination /= "index.html"
                        self.assertTrue(destination.is_file(), destination)
                    if not target.path and target.fragment:
                        self.assertIn(target.fragment, page.ids)

    def test_document_pages_need_no_script_tracker_or_form(self):
        for name, page in self.pages.items():
            with self.subTest(page=name):
                self.assertFalse(any(tag in ("script", "iframe", "form", "input") for tag, _ in page.tags))
                for link in page.links:
                    target = urlsplit(link)
                    if target.scheme == "mailto":
                        self.assertEqual(link, CONTACT)
                    elif target.netloc:
                        self.assertEqual(target.scheme, "https")
                        allowed = {"www.paddle.com", "paddle.net"}
                        if name == "support" and link == "https://license.mfenx.com/gate/license/":
                            allowed.add("license.mfenx.com")
                        self.assertIn(target.netloc, allowed)

    def test_purchase_and_product_surfaces_expose_legal_pages_in_footer(self):
        for path in ("index.html", "gate/index.html", "pricing/index.html", "docs/index.html",
                     "enterprise/index.html", "gate/license/index.html"):
            with self.subTest(page=path):
                page = Document((ROOT / path).read_text())
                prefix = "https://mfenx.com" if path == "gate/license/index.html" else ""
                self.assertTrue({prefix + f"/{name}/" for name in PAGES} <= set(page.footer_links))

    def test_paid_license_is_explicit_internal_proprietary_and_separate_from_free_use(self):
        prose = self.pages["terms"].prose
        for phrase in ("grants you a nonexclusive license", "one customer-operated deployment",
                       "internal business use", "software remains proprietary",
                       "separate written OEM agreement", "Third-party components retain their own licenses"):
            self.assertIn(phrase, prose)
        for path in ("/gate/downloads/LICENSE.txt", "/gate/downloads/VERIFIER-TERMS.txt", "/pricing/"):
            self.assertIn(path, self.pages["terms"].links)

    def test_platform_and_entitlement_semantics_are_visible(self):
        terms = self.pages["terms"].prose
        for phrase in ("CPython 3.13", "Linux x86_64", "glibc 2.34 or newer",
                       "model-evaluation SDK", "separate installation", "no more than 24 hours",
                       "annual offline entitlement", "until its signed expiry after cancellation",
                       "does not provide instant revocation", "Automatic usage overage charges are not part"):
            self.assertIn(phrase, terms)
        self.assertIn("does not automatically schedule", terms)
        self.assertIn("does not stop subscription renewal", self.pages["support"].prose)

    def test_privacy_describes_metadata_infrastructure_and_request_limits(self):
        prose = self.pages["privacy"].prose
        for phrase in ("public-key hash", "opaque purchase and subscription references", "accepted commercial-terms digest",
                       "pseudonymous, not necessarily anonymous", "GitHub Pages", "DigitalOcean",
                       "IP addresses", "no automatic deletion schedule", "support request",
                       "does not itself prove control", "compact release receipt can disclose"):
            self.assertIn(phrase, prose)
        self.assertIn("https://www.paddle.com/legal/privacy", self.pages["privacy"].links)
        self.assertIn(CONTACT, self.pages["privacy"].links)

    def test_refunds_and_support_use_actual_channels_without_new_guarantees(self):
        page = self.pages["refunds"]
        for link in ("https://www.paddle.com/legal/refund-policy", "https://www.paddle.com/legal/buyer-terms",
                     "https://paddle.net/", CONTACT):
            self.assertIn(link, page.links)
        self.assertIn("No additional unconditional refund window", page.prose)
        self.assertIn("Nothing here limits mandatory consumer rights", page.prose)
        self.assertIn("no guaranteed response time", self.pages["support"].prose)
        self.assertIn("cannot promise to recover a lost private key", self.pages["support"].prose)

    def test_existing_license_and_free_use_terms_are_not_relicensed(self):
        expected = {"LICENSE.txt": "782727eb7a626433a8b08b7874c6bcc199c86d13b234525b2281f3909ac9f97f",
                    "VERIFIER-TERMS.txt": "0e3fdf0370313153b9b7e7dda51fd382836ae2a3c04c6eb7ddc92e4eb10ccd6e"}
        for filename, digest in expected.items():
            with self.subTest(file=filename):
                self.assertEqual(hashlib.sha256((ROOT / "gate/downloads" / filename).read_bytes()).hexdigest(), digest)


if __name__ == "__main__":
    unittest.main()
