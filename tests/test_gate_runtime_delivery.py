"""Published delivery bytes, independent OpenSSL signature and document contracts.

No downloaded verifier code is executed by these tests. They do not contact the
licensing service or claim that checkout or a customer's entitlement is active.
"""

import base64
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1] / "public"
PACKET = ROOT / "gate/downloads/runtime-0.3.0rc3"
ARCHIVE = "mfenx-gate-licensed-runtime-0.3.0rc3-linux-x86_64-py313.tar.gz"
PUBLISHER = "c11c70a4a29721aec1df7322a5dfae328ff4a60ebed110570cbd27279bca12a2"
ISSUER = "2c04b488e5151534ec5cc58d2cbcd66e7924db207a45d3789a0c24ad68088e4d"
ARCHIVE_HASH = "180f92ca6cf053eb7ebb10a0bbf2ad2e9f1a060e9ad761d4669fabb5047769b5"
VERIFIER_HASH = "3340d0452be607204064a463af1149f8a5684f83f4184395b885234a83846cff"
DOMAIN = b"MFENX-GATE-DELIVERY-MANIFEST-V1\n"


class Document(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.tags, self.links, self.ids, self.text, self.stack = [], [], [], [], []
        self.feed(source)
        self.close()
        if self.stack:
            raise AssertionError("Unclosed HTML elements: " + repr(self.stack))

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        self.tags.append((tag, data))
        if tag not in self.VOID:
            self.stack.append(tag)
        if "id" in data:
            self.ids.append(data["id"])
        if tag == "a":
            self.links.append(data.get("href", ""))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag not in self.VOID and (not self.stack or self.stack.pop() != tag):
            raise AssertionError("Mismatched HTML closing element: " + tag)

    def handle_data(self, data):
        self.text.append(data)

    @property
    def prose(self):
        return " ".join(" ".join(self.text).split())


class RuntimeDelivery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = (PACKET / "delivery-manifest.json").read_bytes()
        cls.manifest = json.loads(cls.raw)
        cls.page = Document((ROOT / "docs/runtime/index.html").read_text())

    def test_packet_is_exact_public_release_set_without_private_key_material(self):
        self.assertEqual({item.name for item in PACKET.iterdir()}, {
            ARCHIVE, "delivery-manifest.json", "delivery-manifest.sig", "delivery_manifest.py",
            "publisher.pem", "quickstart.md", "release-pins.json"})
        for item in PACKET.iterdir():
            self.assertTrue(item.is_file() and not item.is_symlink())
            self.assertEqual(item.stat().st_nlink, 1)
            if item.name != ARCHIVE:
                self.assertNotIn(b"-----BEGIN PRIVATE KEY-----", item.read_bytes())
                self.assertNotIn(b"-----BEGIN ENCRYPTED PRIVATE KEY-----", item.read_bytes())

    def test_manifest_canonical_domain_scope_and_separate_public_pins(self):
        self.assertEqual(json.dumps(self.manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode(), self.raw)
        self.assertEqual(self.manifest["schema"], "mfenx.gate.delivery-manifest.v1")
        self.assertEqual(self.manifest["product"], "mfenx-gate-licensed-runtime")
        self.assertEqual(self.manifest["version"], "0.3.0rc3")
        self.assertEqual(self.manifest["sequence"], 1)
        self.assertEqual(self.manifest["target"], "CPython 3.13 / Linux x86_64 / glibc >= 2.34")
        self.assertEqual(self.manifest["issued_at"], 1790214000)
        self.assertEqual(self.manifest["expires_at"], 1821750000)
        self.assertEqual(self.manifest["publisher_key_sha256"], "sha256:" + PUBLISHER)
        issuer = self.manifest["license_issuer"]
        self.assertEqual(issuer["origin"], "https://license.mfenx.com")
        self.assertEqual(issuer["environment"], "live")
        self.assertEqual(issuer["key_id"], "mfenx-license-live-20260924")
        self.assertEqual(issuer["public_key_sha256"], "sha256:" + ISSUER)
        self.assertEqual(hashlib.sha256(base64.b64decode(issuer["public_key_spki_base64"], validate=True)).hexdigest(), ISSUER)
        self.assertNotEqual(ISSUER, PUBLISHER)

    def test_archive_and_verifier_match_immutable_signed_bytes(self):
        for key, name, size, digest in (("archive", ARCHIVE, 8600105, ARCHIVE_HASH),
                                         ("verifier", "delivery_manifest.py", 17460, VERIFIER_HASH)):
            with self.subTest(artifact=key):
                data = (PACKET / name).read_bytes()
                self.assertEqual(len(data), size)
                self.assertEqual(hashlib.sha256(data).hexdigest(), digest)
                self.assertEqual(self.manifest[key], {"name": name, "bytes": size, "sha256": "sha256:" + digest,
                    "download_url": "https://mfenx.com/gate/downloads/runtime-0.3.0rc3/" + name})

    def test_openssl_independently_authenticates_signature_and_rejects_tampering(self):
        der = subprocess.run(["openssl", "pkey", "-pubin", "-in", str(PACKET / "publisher.pem"), "-outform", "DER"],
                             capture_output=True, check=True, timeout=10).stdout
        self.assertEqual(hashlib.sha256(der).hexdigest(), PUBLISHER)
        self.assertEqual(len((PACKET / "delivery-manifest.sig").read_bytes()), 64)
        with tempfile.TemporaryDirectory(prefix="mfenx-delivery-signature-") as directory:
            message = Path(directory) / "signed-message.bin"
            message.write_bytes(DOMAIN + self.raw)
            command = ["openssl", "pkeyutl", "-verify", "-pubin", "-inkey", str(PACKET / "publisher.pem"),
                       "-rawin", "-in", str(message), "-sigfile", str(PACKET / "delivery-manifest.sig")]
            result = subprocess.run(command, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, "Detached OpenSSL signature verification failed")
            for modified in (self.raw, DOMAIN + self.raw + b"\n", DOMAIN + self.raw.replace(b'"sequence":1', b'"sequence":2')):
                message.write_bytes(modified)
                self.assertNotEqual(subprocess.run(command, capture_output=True, timeout=10).returncode, 0)

    def test_archive_extracts_no_links_or_parent_traversals(self):
        with tarfile.open(PACKET / ARCHIVE) as archive:
            members = archive.getmembers()
        self.assertTrue(members)
        for member in members:
            name = Path(member.name)
            self.assertFalse(name.is_absolute())
            self.assertNotIn("..", name.parts)
            self.assertEqual(name.parts[0], "mfenx-gate-licensed-runtime")
            self.assertTrue(member.isfile() or member.isdir())

    def test_public_pins_are_enrollment_reference_not_an_entitlement(self):
        pins = json.loads((PACKET / "release-pins.json").read_bytes())
        self.assertEqual(pins["publisher_spki_sha256"], "sha256:" + PUBLISHER)
        self.assertEqual(pins["license_issuer_spki_sha256"], "sha256:" + ISSUER)
        self.assertEqual(pins["license_environment"], "live")
        self.assertEqual(pins["minimum_sequence"], 1)
        self.assertIn("not an independent signature or entitlement", pins["trust_note"])

    def test_document_is_semantic_balanced_and_static(self):
        for tag in ("html", "title", "h1", "main", "footer"):
            self.assertEqual(sum(found == tag for found, _ in self.page.tags), 1)
        self.assertFalse(any(tag in ("script", "iframe", "form", "input") for tag, _ in self.page.tags))
        self.assertEqual(len(self.page.ids), len(set(self.page.ids)))
        self.assertIn(("html", {"lang": "en"}), self.page.tags)
        self.assertIn(("link", {"rel": "canonical", "href": "https://mfenx.com/docs/runtime/"}), self.page.tags)
        self.assertIn(("link", {"rel": "stylesheet", "href": "/gate.css"}), self.page.tags)
        self.assertIn("#content", self.page.links)
        levels = [int(tag[1]) for tag, _ in self.page.tags if tag in ("h1", "h2", "h3", "h4")]
        self.assertEqual(levels[0], 1)
        self.assertTrue(all(b <= a + 1 for a, b in zip(levels, levels[1:])))

    def test_downloads_and_local_links_exist(self):
        self.assertTrue({"/gate/downloads/runtime-0.3.0rc3/" + name for name in
                         (ARCHIVE, "delivery-manifest.json", "delivery-manifest.sig", "delivery_manifest.py", "publisher.pem", "quickstart.md", "release-pins.json")}
                        <= set(self.page.links))
        for href in self.page.links:
            target = urlsplit(href)
            if target.netloc and target.netloc != "mfenx.com":
                self.assertEqual(target.netloc, "license.mfenx.com")
                continue
            if target.path:
                self.assertTrue(target.path.startswith("/"))
                file = ROOT / target.path.lstrip("/")
                if target.path.endswith("/"):
                    file /= "index.html"
                self.assertTrue(file.is_file(), href)
                if target.fragment:
                    self.assertIn(target.fragment, Document(file.read_text()).ids)
            elif target.fragment:
                self.assertIn(target.fragment, self.page.ids)

    def test_documentation_enterprise_and_license_link_to_installation(self):
        for name in ("docs/index.html", "enterprise/index.html", "gate/license/index.html"):
            page = Document((ROOT / name).read_text())
            target = "https://mfenx.com/docs/runtime/" if name.startswith("gate/license") else "/docs/runtime/"
            self.assertIn(target, page.links)

    def test_instructions_keep_release_license_and_runtime_boundaries_distinct(self):
        prose = self.page.prose
        for phrase in ("not a purchased entitlement", "live checkout is enabled", "separate SDK", "22 locked wheels",
                       "before extracting or executing", "14-case acceptance", "synthetic licenses",
                       "gate_control.licensed_app:create_app", "paid_features_available", "Free receipt verification",
                       "holder fingerprint", "not solely from the downloaded license", "does not grant a license"):
            self.assertIn(phrase, prose)
        for pin in (PUBLISHER, ISSUER, ARCHIVE_HASH, VERIFIER_HASH):
            self.assertIn(pin, prose)
        guide = (PACKET / "quickstart.md").read_text()
        self.assertNotIn("INDEPENDENT_LICENSE_HOST", guide)
        self.assertNotIn("INDEPENDENT_PUBLISHER_FINGERPRINT", guide)
        self.assertIn("--minimum-sequence 1", guide)
        self.assertIn("does not activate checkout", guide)
        self.assertIn("--proto '=https'", guide)

    def test_security_record_separates_customer_runtime_from_merchant_service(self):
        text = (ROOT / "enterprise/security-overview.md").read_text()
        self.assertNotIn("verified payment-provider configuration", text)
        self.assertNotIn("A managed history service is optional", text)
        self.assertIn("not an MFENX-hosted receipt-history service", text)
        self.assertIn("does not need Paddle credentials", text)
        self.assertIn("The original technical-pack ZIP", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
