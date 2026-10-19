#!/usr/bin/env python3
"""Generate the static tweek-ing pages (protect, verify, policy) under public/tweek/.

Dependency-free. Re-run after editing the templates below. Idempotent.
"""

from __future__ import annotations

import html
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "public" / "tweek"
CSS_V = "20261017"
OTS_HOSTS = (
    "https://a.pool.opentimestamps.org https://b.pool.opentimestamps.org "
    "https://a.pool.eternitywall.com https://alice.btc.calendar.opentimestamps.org "
    "https://bob.btc.calendar.opentimestamps.org https://finney.calendar.eternitywall.com"
)
CSP_APP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; "
    f"connect-src 'self' {OTS_HOSTS}; base-uri 'none'; form-action 'none'; object-src 'none'"
)
CSP_STATIC = (
    "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; "
    "form-action 'none'; object-src 'none'"
)

POLICIES = {
    "no-ai": (
        "Prohibit all AI/ML training and text-and-data mining",
        "http://ns.useplus.org/ldf/vocab/DMI-PROHIBITED-AIMLTRAINING", 1,
        "Use of this work for training, fine-tuning, evaluating or otherwise developing artificial "
        "intelligence or machine learning models, and any text-and-data mining, is expressly reserved "
        "and prohibited without a written licence from the rights holder.",
    ),
    "no-genai": (
        "Prohibit generative-AI training only",
        "http://ns.useplus.org/ldf/vocab/DMI-PROHIBITED-GENAIMLTRAINING", 1,
        "Use of this work for training or developing generative artificial intelligence models is "
        "expressly reserved and prohibited without a written licence from the rights holder.",
    ),
    "search-only": (
        "Prohibit mining except search-engine indexing",
        "http://ns.useplus.org/ldf/vocab/DMI-PROHIBITED-EXCEPTSEARCHENGINEINDEXING", 1,
        "Text-and-data mining and AI training are reserved and prohibited, except indexing for the "
        "purpose of operating a public search engine.",
    ),
    "all-reserved": (
        "All data mining prohibited",
        "http://ns.useplus.org/ldf/vocab/DMI-PROHIBITED", 1,
        "All text-and-data mining of this work is reserved and prohibited.",
    ),
    "allowed": (
        "Permit mining and training (provenance only)",
        "http://ns.useplus.org/ldf/vocab/DMI-ALLOWED", 0,
        "Text-and-data mining and AI training are permitted. Provenance and attribution are asserted "
        "by the embedded manifest.",
    ),
}


def header(current: str | None) -> str:
    def link(href: str, label: str, cls: str = "") -> str:
        cur = ' aria-current="page"' if href == current else ""
        c = f' class="{cls}"' if cls else ""
        return f'<a{c} href="{href}"{cur}>{label}</a>'

    return f"""    <a class="skip-link" href="#content">Skip to content</a>
    <header class="site-header">
      <a class="wordmark" href="/" aria-label="MFENX home">MFENX</a>
      <nav class="site-nav" aria-label="Main navigation">
        {link("/gate/", "Gate")}
        {link("/lightsout/", "Lights Out")}
        {link("/tweek/", "tweek-ing")}
        {link("/labs/", "Technology")}
        {link("/docs/", "Developers")}
        {link("/company/", "Company")}
        {link("/pricing/", "Pricing")}
        {link("/verify/", "Verify a receipt", "nav-start")}
      </nav>
    </header>
"""


FOOTER = """    <footer class="site-footer">
      <span>mfenx LLC</span>
      <nav aria-label="Footer">
        <a href="/tweek/verify/">tweek-ing verifier</a><a href="/verify/">Free verifier</a
        ><a href="/docs/">Documentation</a><a href="/enterprise/#data-flow">Data handling</a
        ><a href="/labs/">Research</a>
      </nav>
      <span class="end-note">San Francisco, California</span>
    </footer>
"""


def head(title: str, description: str, canonical: str, csp: str, extra: str = "") -> str:
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#f7f8fa" />
    <title>MFENX</title>
    <meta property="og:title" content="{html.escape(title)}" />
    <meta name="description" content="{html.escape(description)}" />
    <link rel="canonical" href="{canonical}" />
    <link rel="icon" href="/favicon.ico" />
    <meta name="tdm-reservation" content="1" />
    <meta name="tdm-policy" content="https://mfenx.com/tweek/policy/no-ai/" />
    <meta name="robots" content="noai, noimageai" />
    <link rel="stylesheet" href="/gate.css?v=20260926-instrument" />
    <link rel="stylesheet" href="/tweek/tweek.css?v={CSS_V}" />
    <meta http-equiv="Content-Security-Policy" content="{csp}" />
{extra}  </head>
  <body>
"""


def policy_options() -> str:
    out = []
    for pid, (label, _dm, _tdm, _terms) in POLICIES.items():
        sel = " selected" if pid == "no-ai" else ""
        out.append(f'                <option value="{pid}"{sel}>{html.escape(label)}</option>')
    return "\n".join(out)


PROTECT = head(
    "tweek-ing — protect your work from AI training, in your browser | MFENX",
    "Free. Embed standards-based AI opt-out metadata, a signed provenance manifest, an invisible "
    "watermark and a Bitcoin-anchored timestamp into images, code, text, PDF, audio and video. "
    "Nothing is uploaded.",
    "https://mfenx.com/tweek/",
    CSP_APP,
    '    <script type="module" src="/tweek/app.js"></script>\n',
) + header("/tweek/") + f"""    <main class="page" id="content" tabindex="-1">
      <section class="document-head">
        <div>
          <div class="section-label">tweek-ing / Free provenance instrument</div>
          <h1>Your idea. Your terms. Written into the file.</h1>
          <p>
            Drop an image, document, source file, audio or video. tweek-ing signs it with a key only you hold,
            writes every machine-readable AI opt-out standard into it, hides a watermark that survives
            metadata stripping, and anchors the moment to Bitcoin. All in this browser. Nothing leaves your machine.
          </p>
        </div>
        <aside>
          No account.<br />No upload.<br />Free; prices subject to change.
          <p><a href="/tweek/verify/">Verify a protected file ↗</a></p>
        </aside>
      </section>
      <div class="instrument-line">
        <span>Manifest v1 · Ed25519 / SHA-256 · IPTC Data Mining · W3C TDM-Rep · XMP Rights · OpenTimestamps</span>
        <button class="plain-button" type="button" id="load-example">Try it on a sample</button>
      </div>
      <noscript><p class="note">tweek-ing runs entirely in your browser and needs JavaScript and Web Crypto.</p></noscript>
      <div class="tweek-layout">
        <form class="verify-form" id="protect-form">
          <fieldset>
            <legend>What are you protecting?</legend>
            <label class="dropzone" id="dropzone" for="files">
              <strong>Drop files here or click to choose</strong>
              JPEG · PNG · WebP · PDF · WAV · MP4/MOV/M4A · source code · Markdown · plain text
              <input id="files" name="files" type="file" multiple />
            </label>
            <div class="field field-gap">
              <label for="idea-text">…or paste the idea itself</label>
              <textarea id="idea-text" name="idea-text" spellcheck="true" placeholder="Describe the idea, paste the code, the lyric, the pitch. It becomes a protected text file with a woven fingerprint and a canary phrase."></textarea>
            </div>
            <div class="field">
              <label for="creator">Your name or handle</label>
              <input id="creator" name="creator" type="text" autocomplete="name" maxlength="120" placeholder="As it should appear in the rights statement" />
            </div>
            <div class="field">
              <label for="contact">Contact for licensing <span class="muted">(optional)</span></label>
              <input id="contact" name="contact" type="text" autocomplete="email" maxlength="200" placeholder="email or URL where a licence can be requested" />
            </div>
            <div class="field">
              <label for="policy">AI and data-mining policy</label>
              <select id="policy" name="policy">
{policy_options()}
              </select>
              <p class="note">Written as IPTC <em>Data Mining</em> (PLUS vocabulary), W3C TDM reservation, XMP rights terms and, for code, SPDX-style header lines.</p>
            </div>
            <div class="field">
              <label for="license">Licence <span class="muted">(optional)</span></label>
              <select id="license" name="license">
                <option value="">All rights reserved (no public licence)</option>
                <option value="https://creativecommons.org/licenses/by-nc-nd/4.0/">CC BY-NC-ND 4.0</option>
                <option value="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</option>
                <option value="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</option>
                <option value="https://creativecommons.org/licenses/by-nd/4.0/">CC BY-ND 4.0</option>
                <option value="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</option>
                <option value="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</option>
              </select>
            </div>
            <ul class="toggle-list">
              <li>
                <input type="checkbox" id="opt-sign" checked />
                <div><label for="opt-sign">Sign with my key</label>
                  <p class="note">An Ed25519 key is generated in this browser and kept in its local storage. Your identity is the key's fingerprint. Export it to sign from another device.</p>
                  <div class="key-panel" id="key-panel">
                    <span>Signing identity</span><code class="identity" id="identity">generating…</code>
                    <div class="row"><button class="plain-button" type="button" id="key-export">Export key</button><label class="plain-button pointer" for="key-import">Import key</label><input id="key-import" type="file" accept=".json" hidden /><button class="plain-button" type="button" id="key-rotate">New key</button></div>
                  </div>
                </div>
              </li>
              <li>
                <input type="checkbox" id="opt-watermark" checked />
                <div><label for="opt-watermark">Invisible watermark</label>
                  <p class="note">Images: a keyed DCT mark on a 256-grid, blind-detectable, survives resizing, recompression, screenshots and colour edits (not heavy crops). Text: a zero-width fingerprint woven into whitespace plus a unique canary phrase that will surface if a model memorises your work.</p>
                  <div class="sub"><label for="strength" class="plain-label">Strength</label><input type="range" id="strength" min="0.6" max="2" step="0.1" value="1" /><span id="strength-out">1.0 · ≈44 dB</span></div>
                </div>
              </li>
              <li>
                <input type="checkbox" id="opt-timestamp" checked />
                <div><label for="opt-timestamp">Bitcoin timestamp (OpenTimestamps)</label>
                  <p class="note">The signed manifest's hash is submitted to public calendar servers; the proof becomes a Bitcoin-anchored attestation within hours. This is the only network request this page makes, and it carries only a 32-byte hash.</p>
                </div>
              </li>
            </ul>
            <div class="actions">
              <button class="button" id="protect-button" type="submit">Protect locally</button
              ><button class="plain-button" id="clear-button" type="button">Clear</button>
            </div>
            <p class="privacy-note" id="input-note">Files stay in browser memory. Nothing is saved to an account or sent to a server. Reloading clears the inputs; your signing key stays in this browser until you remove it.</p>
          </fieldset>
        </form>
        <section class="results" id="results" aria-live="polite">
          <div class="result-card pending" id="intro-card">
            <div class="eyebrow">LOCAL PROTECTOR</div>
            <h2>Awaiting a file.</h2>
            <p class="result-summary">Each file comes back with a protected copy, a signed <code>.tweek.json</code> manifest, a <code>.tweek.ots</code> timestamp proof and copy-paste declarations for your website and repository.</p>
            <ul class="verification-checks">
              <li><span>Provenance manifest</span><strong>Ed25519-signed, RFC 8785 canonical JSON</strong></li>
              <li><span>AI opt-out metadata</span><strong>IPTC Data Mining · TDM-Rep · XMP Rights · SPDX</strong></li>
              <li><span>Invisible watermark</span><strong>DCT-QIM (images) · zero-width + canary (text)</strong></li>
              <li><span>Existence proof</span><strong>OpenTimestamps → Bitcoin</strong></li>
              <li><span>Verifier</span><strong><a href="/tweek/verify/">mfenx.com/tweek/verify</a>, any XMP reader, any OTS client</strong></li>
            </ul>
          </div>
        </section>
      </div>
      <section class="how" aria-label="How it works">
        <div><h3>1 · Assert</h3><p>Standards-based declarations are what compliant crawlers read and what regulators and courts look for. The EU text-and-data-mining opt-out is binding in the EU; ignoring an explicit, machine-readable reservation is the behaviour being litigated now.</p></div>
        <div><h3>2 · Prove</h3><p>The manifest binds your content's digest to your key and a Bitcoin-anchored time. Anyone can verify it offline, forever, without trusting mfenx.</p></div>
        <div><h3>3 · Detect</h3><p>Strip the metadata and the watermark still says which protected work this is. The canary phrase is unique to your file: search model outputs for it.</p></div>
      </section>
      <section class="limits" id="limits">
        <h2>What this does not do</h2>
        <ul>
          <li>It cannot physically stop a scraper that ignores declared permissions. It makes ignoring them deliberate, provable and attributable.</li>
          <li>It cannot protect what is already public without these marks. Protect before publishing.</li>
          <li>Heavy cropping, rotation and extreme warps defeat the image watermark. Deliberate Unicode normalisation removes the zero-width text fingerprint; the visible canary and the signed digest remain.</li>
          <li>Your signing key lives in this browser. Export it and keep the export somewhere safe; losing it means new work is signed by a new identity.</li>
        </ul>
      </section>
    </main>
""" + FOOTER + "  </body>\n</html>\n"


VERIFY = head(
    "Verify a tweek-ing protected file | MFENX",
    "Check a tweek-ing protected file locally: signature, content digest, declared AI policy, "
    "invisible watermark and Bitcoin timestamp. Nothing is uploaded.",
    "https://mfenx.com/tweek/verify/",
    CSP_APP,
    '    <script type="module" src="/tweek/verify/app.js"></script>\n',
) + header(None) + """    <main class="page" id="content" tabindex="-1">
      <section class="document-head">
        <div>
          <div class="section-label">tweek-ing / Free verification</div>
          <h1>Read what the file says about itself.</h1>
          <p>Drop a protected file. The verifier recomputes the content digest, checks the signature against the embedded key, reads the declared AI policy, scans for the invisible watermark and inspects the timestamp proof. Your files are processed in this browser.</p>
        </div>
        <aside>No account.<br />No upload.<br />No verification fee.<p><a href="/tweek/">Protect a file ↗</a></p></aside>
      </section>
      <div class="instrument-line"><span>Manifest v1 · Ed25519 / ES256 · SHA-256 · OpenTimestamps</span><a class="plain-button" href="/tweek/#limits">Known limits</a></div>
      <div class="tweek-layout">
        <form class="verify-form" id="verify-form">
          <fieldset>
            <legend>Local inputs</legend>
            <div class="field">
              <label for="file">Protected file</label><input id="file" name="file" type="file" required />
              <p class="note">Any file produced by tweek-ing, or any image or text you suspect carries a tweek-ing watermark.</p>
            </div>
            <div class="field">
              <label for="sidecar">Sidecar manifest <span class="muted">(optional, .tweek.json)</span></label><input id="sidecar" name="sidecar" type="file" accept=".json,application/json" />
              <p class="note">Needed to verify signatures on code and text files, or when the file's metadata was stripped.</p>
            </div>
            <div class="field">
              <label for="ots">Timestamp proof <span class="muted">(optional, .tweek.ots)</span></label><input id="ots" name="ots" type="file" accept=".ots" />
            </div>
            <div class="actions">
              <button class="button" id="verify-button" type="submit">Verify locally</button><button class="plain-button" id="clear-button" type="button">Clear inputs</button>
            </div>
            <p class="privacy-note">Files stay in browser memory. The only network request this page can make is an optional timestamp upgrade to the OpenTimestamps calendar named inside your .ots proof.</p>
          </fieldset>
        </form>
        <section class="results" id="results" aria-live="polite">
          <div class="result-card pending" id="result-card">
            <div class="eyebrow" id="result-state">LOCAL VERIFIER</div>
            <h2 id="result-title">Awaiting a file.</h2>
            <p class="result-summary" id="result-summary">The result separates authorship (signature), integrity (content digest), declared terms (policy), resilience (watermark) and time (Bitcoin attestation).</p>
            <ul class="verification-checks" id="checks"></ul>
            <dl class="meta" id="meta" hidden></dl>
            <div class="downloads" id="actions" hidden></div>
            <details class="receipt-details" id="manifest-details" hidden><summary>Inspect the signed manifest</summary><pre class="code" id="manifest-json"></pre></details>
            <details class="receipt-details" id="xmp-details" hidden><summary>Inspect embedded XMP fields</summary><pre class="code" id="xmp-fields"></pre></details>
          </div>
        </section>
      </div>
    </main>
""" + FOOTER + "  </body>\n</html>\n"


def policy_page(pid: str) -> str:
    label, dm, tdm, terms = POLICIES[pid]
    url = f"https://mfenx.com/tweek/policy/{pid}/"
    return head(
        f"tweek-ing policy: {label} | MFENX",
        "Machine-readable and human-readable text-and-data-mining policy referenced by tweek-ing protected files.",
        url,
        CSP_STATIC,
        "",
    ) + header(None) + f"""    <main class="page" id="content" tabindex="-1">
      <section class="document-head">
        <div>
          <div class="section-label">tweek-ing / TDM policy <code>{pid}</code></div>
          <h1>{html.escape(label)}.</h1>
          <p>This page is the <em>tdm-policy</em> target referenced by files protected with tweek-ing under the policy identifier <code>{pid}</code>. The embedded, signed manifest in each file is authoritative for the rights holder's identity; this page states the terms that identifier denotes.</p>
        </div>
        <aside>W3C TDM Reservation Protocol<br />IPTC Photo Metadata 2023.1<br /><p><a href="/tweek/verify/">Verify a file ↗</a></p></aside>
      </section>
      <section class="policy-body">
        <h2>Terms</h2>
        <p>{html.escape(terms)}</p>
        <h2>Machine-readable equivalents</h2>
        <dl>
          <dt>tdm-reservation</dt><dd>{tdm}</dd>
          <dt>tdm-policy</dt><dd>{url}</dd>
          <dt>plus:DataMining</dt><dd>{dm}</dd>
          <dt>xmpRights:Marked</dt><dd>True</dd>
          <dt>Legal basis</dt><dd>Directive (EU) 2019/790 Art. 4(3) machine-readable reservation; national implementations; contractual terms where applicable; copyright in all jurisdictions.</dd>
        </dl>
        <h2>How to obtain a licence</h2>
        <p>Each protected file carries the rights holder's name and, where provided, a contact in its manifest (<code>creator.contact</code>). Requests for a licence should be addressed to the rights holder, not to mfenx. mfenx is not a party to the work and does not hold rights in it.</p>
        <p class="note"><a href="/tweek/">Back to tweek-ing</a></p>
      </section>
    </main>
""" + FOOTER + "  </body>\n</html>\n"


def main() -> None:
    (ROOT / "index.html").write_text(PROTECT, encoding="utf-8")
    (ROOT / "verify").mkdir(exist_ok=True)
    (ROOT / "verify" / "index.html").write_text(VERIFY, encoding="utf-8")
    for pid in POLICIES:
        d = ROOT / "policy" / pid
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(policy_page(pid), encoding="utf-8")
    print(f"wrote protect, verify and {len(POLICIES)} policy pages under {ROOT}")


if __name__ == "__main__":
    main()
