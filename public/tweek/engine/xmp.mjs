// XMP packet construction and parsing for tweek-ing provenance + AI permission declarations.
// Standards written into every packet:
//   - IPTC Photo Metadata 2023.1 "Data Mining" (plus:DataMining, PLUS vocabulary)
//   - W3C TDM Reservation Protocol (tdm-reservation / tdm-policy)
//   - XMP Rights Management (xmpRights:Marked, WebStatement, UsageTerms)
//   - Dublin Core creator / rights
//   - xmpMM DocumentID / InstanceID
//   - tweek namespace: manifest digest, signature, canary and watermark binding

export const NS = {
  x: "adobe:ns:meta/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  dc: "http://purl.org/dc/elements/1.1/",
  xmp: "http://ns.adobe.com/xap/1.0/",
  xmpRights: "http://ns.adobe.com/xap/1.0/rights/",
  xmpMM: "http://ns.adobe.com/xap/1.0/mm/",
  photoshop: "http://ns.adobe.com/photoshop/1.0/",
  plus: "http://ns.useplus.org/ldf/xmp/1.0/",
  Iptc4xmpExt: "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
  tdm: "https://www.w3.org/ns/tdmrep#",
  cc: "http://creativecommons.org/ns#",
  tweek: "https://mfenx.com/tweek/ns/1.0/",
};

// PLUS Data Mining vocabulary (IPTC 2023.1)
export const DATA_MINING = {
  UNSPECIFIED: "http://ns.useplus.org/ldf/vocab/DMI-UNSPECIFIED",
  ALLOWED: "http://ns.useplus.org/ldf/vocab/DMI-ALLOWED",
  PROHIBITED: "http://ns.useplus.org/ldf/vocab/DMI-PROHIBITED",
  PROHIBITED_AIMLTRAINING: "http://ns.useplus.org/ldf/vocab/DMI-PROHIBITED-AIMLTRAINING",
  PROHIBITED_GENAIMLTRAINING: "http://ns.useplus.org/ldf/vocab/DMI-PROHIBITED-GENAIMLTRAINING",
  PROHIBITED_EXCEPTSEARCHENGINEINDEXING: "http://ns.useplus.org/ldf/vocab/DMI-PROHIBITED-EXCEPTSEARCHENGINEINDEXING",
  PROHIBITED_SEE_EMBEDDEDRIGHTSEXPR: "http://ns.useplus.org/ldf/vocab/DMI-PROHIBITED-SEEEMBEDDEDRIGHTSEXPR",
};

export const POLICIES = {
  // id -> human label, PLUS term, TDM reservation flag, rights statement text
  "no-ai": {
    label: "Prohibit all AI/ML training and text-and-data mining",
    dataMining: DATA_MINING.PROHIBITED_AIMLTRAINING,
    tdmReservation: 1,
    usageTerms: "Use of this work for training, fine-tuning, evaluating or otherwise developing artificial intelligence or machine learning models, and any text-and-data mining, is expressly reserved and prohibited without a written licence from the rights holder.",
  },
  "no-genai": {
    label: "Prohibit generative AI training only",
    dataMining: DATA_MINING.PROHIBITED_GENAIMLTRAINING,
    tdmReservation: 1,
    usageTerms: "Use of this work for training or developing generative artificial intelligence models is expressly reserved and prohibited without a written licence from the rights holder.",
  },
  "search-only": {
    label: "Prohibit mining except search-engine indexing",
    dataMining: DATA_MINING.PROHIBITED_EXCEPTSEARCHENGINEINDEXING,
    tdmReservation: 1,
    usageTerms: "Text-and-data mining and AI training are reserved and prohibited, except indexing for the purpose of operating a public search engine.",
  },
  "all-reserved": {
    label: "All data mining prohibited",
    dataMining: DATA_MINING.PROHIBITED,
    tdmReservation: 1,
    usageTerms: "All text-and-data mining of this work is reserved and prohibited.",
  },
  "allowed": {
    label: "Permit mining and training (provenance only)",
    dataMining: DATA_MINING.ALLOWED,
    tdmReservation: 0,
    usageTerms: "Text-and-data mining and AI training are permitted. Provenance and attribution are asserted by the embedded manifest.",
  },
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const XMP_HEADER = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>';
export const XMP_TRAILER = '<?xpacket end="w"?>';

/**
 * Build an XMP packet.
 * @param {object} m — the tweek manifest (see manifest.mjs) ; uses m.creator, m.policy, m.asset, m.signature, m.canary, m.watermark, m.id
 */
export function buildXmp(m, { padding = 2048 } = {}) {
  const pol = POLICIES[m.policy.id] || POLICIES["no-ai"];
  const policyUrl = m.policy.url || `https://mfenx.com/tweek/policy/${m.policy.id}/`;
  const lines = [];
  lines.push(XMP_HEADER);
  lines.push('<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="tweek-ing/1.0 mfenx.com">');
  lines.push(' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">');
  const ns = Object.entries(NS).filter(([k]) => !["x", "rdf"].includes(k)).map(([k, v]) => `xmlns:${k}="${v}"`).join("\n    ");
  lines.push(`  <rdf:Description rdf:about=""\n    ${ns}`);
  lines.push(`    xmpMM:DocumentID="${esc(m.asset.documentId)}"`);
  lines.push(`    xmpMM:InstanceID="${esc(m.asset.instanceId)}"`);
  lines.push(`    xmp:MetadataDate="${esc(m.created)}"`);
  lines.push(`    xmp:CreatorTool="tweek-ing/1.0 (https://mfenx.com/tweek/)"`);
  lines.push(`    xmpRights:Marked="True"`);
  lines.push(`    xmpRights:WebStatement="${esc(m.policy.webStatement || policyUrl)}"`);
  lines.push(`    plus:DataMining="${esc(pol.dataMining)}"`);
  lines.push(`    tdm:reservation="${pol.tdmReservation}"`);
  lines.push(`    tdm:policy="${esc(policyUrl)}"`);
  if (m.policy.license) lines.push(`    cc:license="${esc(m.policy.license)}"`);
  lines.push(`    tweek:version="1"`);
  lines.push(`    tweek:id="${esc(m.id)}"`);
  lines.push(`    tweek:contentDigest="${esc(m.asset.contentDigest)}"`);
  lines.push(`    tweek:originalDigest="${esc(m.asset.originalDigest)}"`);
  lines.push(`    tweek:canary="${esc(m.canary)}"`);
  if (m.watermark) lines.push(`    tweek:watermark="${esc(m.watermark.scheme)}:${esc(m.watermark.payload)}"`);
  if (m.signature) {
    lines.push(`    tweek:signatureAlg="${esc(m.signature.alg)}"`);
    lines.push(`    tweek:publicKey="${esc(m.signature.publicKey)}"`);
    lines.push(`    tweek:signature="${esc(m.signature.value)}"`);
    lines.push(`    tweek:signer="${esc(m.creator.identity)}"`);
  }
  lines.push(`    tweek:manifestDigest="${esc(m.manifestDigest || "")}"`);
  lines.push(`    tweek:verify="https://mfenx.com/tweek/verify/">`);
  lines.push(`   <dc:creator><rdf:Seq><rdf:li>${esc(m.creator.name || m.creator.identity)}</rdf:li></rdf:Seq></dc:creator>`);
  lines.push(`   <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${esc(m.policy.rights || `© ${m.created.slice(0, 4)} ${m.creator.name || m.creator.identity}. All rights reserved.`)}</rdf:li></rdf:Alt></dc:rights>`);
  if (m.asset.title) lines.push(`   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(m.asset.title)}</rdf:li></rdf:Alt></dc:title>`);
  lines.push(`   <xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${esc(pol.usageTerms)}</rdf:li></rdf:Alt></xmpRights:UsageTerms>`);
  lines.push(`   <xmpRights:Owner><rdf:Bag><rdf:li>${esc(m.creator.name || m.creator.identity)}</rdf:li></rdf:Bag></xmpRights:Owner>`);
  lines.push(`   <photoshop:Credit>${esc(m.creator.name || m.creator.identity)}</photoshop:Credit>`);
  lines.push(`   <tweek:manifest><![CDATA[${m.manifestJson.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></tweek:manifest>`);
  lines.push("  </rdf:Description>");
  lines.push(" </rdf:RDF>");
  lines.push("</x:xmpmeta>");
  let s = lines.join("\n") + "\n";
  // XMP spec recommends 2–4 KB of whitespace padding so editors can update in place.
  if (padding > 0) {
    const pad = " ".repeat(99) + "\n";
    for (let i = 0; i < Math.ceil(padding / 100); i++) s += pad;
  }
  s += XMP_TRAILER;
  return s;
}

/** Return true if an XMP string was produced by tweek-ing (so we replace rather than duplicate). */
export const isTweekXmp = (s) => s.includes(NS.tweek);

/** Minimal, forgiving XMP parser: returns a flat map of qualified-name -> value for attributes and simple elements. */
export function parseXmp(s) {
  const out = {};
  const attr = /([A-Za-z0-9_]+:[A-Za-z0-9_]+)="([^"]*)"/g;
  let m;
  while ((m = attr.exec(s))) if (!m[1].startsWith("xmlns:")) out[m[1]] = unesc(m[2]);
  const simple = /<([A-Za-z0-9_]+:[A-Za-z0-9_]+)>([^<]*)<\/\1>/g;
  while ((m = simple.exec(s))) out[m[1]] = unesc(m[2]);
  const alt = /<([A-Za-z0-9_]+:[A-Za-z0-9_]+)>\s*<rdf:(?:Alt|Seq|Bag)>\s*<rdf:li[^>]*>([^<]*)<\/rdf:li>/g;
  while ((m = alt.exec(s))) out[m[1]] = unesc(m[2]);
  const cdata = /<tweek:manifest><!\[CDATA\[([\s\S]*?)\]\]><\/tweek:manifest>/.exec(s);
  if (cdata) out["tweek:manifest"] = cdata[1].replace(/\]\]\]\]><!\[CDATA\[>/g, "]]>");
  return out;
}
function unesc(s) { return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"); }
