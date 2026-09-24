# MFENX Gate organization runtime — release 0.3.0rc3

The organization runtime is a customer-operated add-on. Its software archive,
release authentication and purchased license are three separate objects. A
successful payment is not a software-integrity check; a signed release manifest
is not a software license or evidence that a model passed behavioral evaluation.
Standalone Gate receipt verification remains free and does not use this license.

This delivery procedure targets the unchanged `0.3.0rc3` runtime bundle: CPython
3.13 on Linux x86_64 with glibc 2.34 or newer. Python's `venv`, pip bootstrap and
OpenSSL with Ed25519 support must already be installed. The bundle contains 22
locked wheels, not an operating system, Python, a customer identity provider or
the CKODMK/ONNX evaluation dependencies.

## Obtain the release and the purchase record

The delivery channel must provide all of the following, outside the archive:

| File or value | Purpose |
| --- | --- |
| `mfenx-gate-licensed-runtime-0.3.0rc3-linux-x86_64-py313.tar.gz` | Runtime, installer, notices and installed acceptance |
| `delivery-manifest.json` and `delivery-manifest.sig` | Exact release description and detached Ed25519 signature |
| `delivery_manifest.py` | Local verification and authenticated public-trust export |
| Publisher's Ed25519 public PEM | Release signature verification |
| Independently confirmed publisher SPKI SHA-256, exact version and minimum release sequence | Publisher authentication and rollback policy |
| Independently confirmed license origin and intended environment | Entitlement issuer scope |

The checksum beside an archive is not publisher authentication. Do not obtain
the trusted fingerprint from that same unsigned checksum, an unverified manifest
or a downloaded license. Confirm it through an already trusted release channel
or an administrator-managed trust configuration. Keep the highest accepted
sequence in that configuration. An offline verifier cannot discover a newer
release or key revocation; a reliable local clock and externally maintained
trust policy remain necessary.

## Download this release

The signed delivery packet is published at:

https://mfenx.com/gate/downloads/runtime-0.3.0rc3/

Use the exact file URLs listed on https://mfenx.com/docs/runtime/. The release
version is `0.3.0rc3`, minimum sequence `1`, and the publisher SPKI SHA-256 is:

`sha256:c11c70a4a29721aec1df7322a5dfae328ff4a60ebed110570cbd27279bca12a2`

The separately signed entitlement issuer is `https://license.mfenx.com`, key ID
`mfenx-license-live-20260924`, environment `live`, public SPKI SHA-256:

`sha256:2c04b488e5151534ec5cc58d2cbcd66e7924db207a45d3789a0c24ad68088e4d`

The downloadable `release-pins.json` is a public enrollment reference. A copy
beside the archive does not authenticate itself. Confirm the publisher pin
through an already trusted MFENX channel or administrator-managed configuration;
retain the accepted version and sequence floor separately from the downloads.

This signed software release does not activate checkout or issue a purchased
license. Its issuer trust is scoped to live grants; it must not accept sandbox
licenses. Purchase availability is reported by the licensing service. Receipt
verification remains free independently of a purchase.

Download without executing the downloaded verifier:

```sh
set -e
umask 077
MFENX_RELEASE_DIR=$(mktemp -d)
cd "$MFENX_RELEASE_DIR"
MFENX_RELEASE_URL=https://mfenx.com/gate/downloads/runtime-0.3.0rc3
for release_file in \
  mfenx-gate-licensed-runtime-0.3.0rc3-linux-x86_64-py313.tar.gz \
  delivery-manifest.json delivery-manifest.sig delivery_manifest.py publisher.pem
do
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
    --max-time 120 --output "$release_file" "$MFENX_RELEASE_URL/$release_file"
done
```

At https://license.mfenx.com/gate/license/, an available purchase flow creates a browser key and an
encrypted recovery file. Save that file and its passphrase separately, record
the browser's own displayed key fingerprint, and complete the selected checkout.
Refresh the license state and use **Download license** only after payment is
confirmed. Preserve the purchase/license identifier. A license document cannot
recover a lost key. Do not upload the recovery file or passphrase to MFENX.

There are three independent key roles:

| Key | Where it belongs |
| --- | --- |
| Release publisher's signing key | Publisher only; customers pin its public fingerprint |
| Entitlement issuer's signing key | License service only; its public key is bound by the authenticated release manifest |
| Customer's purchase key | Customer browser/recovery custody; the runtime needs only its independently known public fingerprint |

## Authenticate before executing downloaded code

Use a new private, operator-owned directory for the downloaded files. Do not let
other users modify it, its files or mutable parent directories during this
procedure. Do not use symlinks. Publisher and entitlement private keys must never
be present in a customer delivery directory.

First derive the public release key's SPKI fingerprint:

```sh
openssl pkey -pubin -in publisher.pem -outform DER | openssl dgst -sha256
```

Compare the complete digest with the independently confirmed publisher pin. Stop
on any mismatch. The pin used by the Python tool is that digest with a `sha256:`
prefix; it is not a hash of the PEM's text formatting.

The signature covers the ASCII prefix `MFENX-GATE-DELIVERY-MANIFEST-V1` followed
by one newline and the exact manifest bytes. It does not cover a parsed or
reformatted JSON document. In that private download directory, prepare the
verification input without executing downloaded code:

```sh
python3.13 -I - <<'PY'
from pathlib import Path
raw = Path('delivery-manifest.json').read_bytes()
if not 0 < len(raw) <= 16384:
    raise SystemExit('Manifest size rejected')
with Path('signed-message.bin').open('xb') as output:
    output.write(b'MFENX-GATE-DELIVERY-MANIFEST-V1\n' + raw)
PY
openssl pkeyutl -verify -pubin -inkey publisher.pem -rawin \
  -in signed-message.bin -sigfile delivery-manifest.sig
```

Continue only if OpenSSL exits successfully. Inspect the now-authenticated JSON
as data. Check its product, target, exact version, release sequence, issuer origin
and environment against the independent values above; check that the current
UTC time lies in `[issued_at, expires_at)`. Use a sequence at least as high as
your saved floor. An expired or older signed release must not be accepted merely
because its signature is valid.

Before extracting or running anything, compare the exact byte lengths and
SHA-256 values of both the archive and `delivery_manifest.py` against the signed
`archive` and `verifier` records:

```sh
wc -c mfenx-gate-licensed-runtime-0.3.0rc3-linux-x86_64-py313.tar.gz delivery_manifest.py
sha256sum mfenx-gate-licensed-runtime-0.3.0rc3-linux-x86_64-py313.tar.gz delivery_manifest.py
```

Do not execute a script first and then use that same script as the only proof of
its authenticity. This OpenSSL bootstrap requires no Python package download.
The supplied verifier can instead run in an existing trusted environment with
`cryptography` installed. It never fetches files or trusts a key from the manifest
to authenticate that same manifest.

## Install and export public issuer trust

Extract the authenticated archive into a new operator-owned directory. From the
extracted `mfenx-gate-licensed-runtime` directory, run:

```sh
python3.13 -I install.py /absolute/path/to/new-runtime-venv
```

The destination must not exist. The installer checks the bundle inventory and
installs the exact hashed wheels without an index, dependency resolution or
network package downloads. It does not register or start a service. Its detailed
filesystem requirements are in the bundled `README.md`.

Use the installed runtime's Python to verify the complete delivery contract and
export its authenticated **public** entitlement trust into a new directory:

```sh
/absolute/path/to/new-runtime-venv/bin/python -I /absolute/download/delivery_manifest.py verify \
  --manifest /absolute/download/delivery-manifest.json \
  --signature /absolute/download/delivery-manifest.sig \
  --publisher-key /absolute/download/publisher.pem \
  --publisher-key-sha256 sha256:c11c70a4a29721aec1df7322a5dfae328ff4a60ebed110570cbd27279bca12a2 \
  --archive /absolute/download/mfenx-gate-licensed-runtime-0.3.0rc3-linux-x86_64-py313.tar.gz \
  --expected-version 0.3.0rc3 \
  --minimum-sequence 1 \
  --expected-origin https://license.mfenx.com \
  --trust-directory /absolute/private/new-trust-directory
```

The default environment is `live`; sandbox validation must explicitly use
`--environment sandbox` and a sandbox-scoped manifest. All input paths must be
absolute, regular files, without symlinks or hard links. The tool refuses an
existing output directory, unknown fields, noncanonical or duplicate JSON,
invalid signatures, time/version/sequence mismatches and mismatched file bytes.
The executing verifier must itself match the signed verifier record.

Success creates `trusted-license-issuer.pem` and `verified-release-trust.json`
with private filesystem permissions. It does not issue or activate a license.
The latter file records the authenticated issuer, key ID and environment, but
does not automatically edit runtime configuration or your saved sequence floor.

## Configure, accept and renew

Follow the bundle's `runtime-configuration.md`. Supply your own database, OIDC
provider and public runtime origin. Set the license file path, exported issuer
PEM, authenticated issuer key ID/origin/environment and the holder fingerprint
recorded from your own purchase key. Never derive that holder trust pin solely
from a downloaded license. Set the intended organization plan explicitly; the
runtime's default organization allowance remains Developer and cannot exceed
the purchased plan.

Independently check the downloaded license before starting the governed service:

```sh
/absolute/path/to/new-runtime-venv/bin/python -I -m gate_control.license_verify \
  /absolute/private/runtime/license.json \
  --issuer-key /absolute/private/new-trust-directory/trusted-license-issuer.pem \
  --key-id mfenx-license-live-20260924 \
  --issuer https://license.mfenx.com \
  --holder-sha256 sha256:OWN_PURCHASE_KEY_FINGERPRINT
```

Run the bundled `acceptance.py` as documented in its README, then start the
licensed entry point behind your own appropriately configured TLS proxy:

```sh
/absolute/path/to/new-runtime-venv/bin/uvicorn \
  gate_control.licensed_app:create_app --factory \
  --host 127.0.0.1 --port 8090 --workers 1 --no-access-log
```

Do not substitute the legacy `gate_control.app:create_app` factory. Missing or
invalid licenses fail governed requests closed; valid licenses do not replace
customer authorization. An HTTP 200 health response is liveness, not proof of
paid admission: inspect `paid_features_available` and test an authorized governed
operation in your deployment. The installed acceptance uses synthetic licenses
and identities; customer OIDC/TLS/storage integration requires customer testing.

Team and Business grants require renewal before their signed expiry. The bundle
includes `tools/renew_license.py` and `docs/customer-license-renewal.md`. First run
that one-shot helper with the customer's protected recovery/passphrase files,
independent trust pins and exact existing purchase ID. Inspect the verified
grant before enabling an operator-managed scheduled job. No scheduler is
installed automatically. Private air-gap licenses use manual disconnected
delivery instead; do not add an online renewal dependency to that deployment.

Receipt verification remains free if the organization license expires. A
canceled subscription prevents fresh entitlement issuance, not use of an
already issued offline grant before its original expiry. Protect the clock,
monitor renewal failures and retain backups under your own policy.

## Terms and support

Commercial software rights are governed by https://mfenx.com/terms/ and the
applicable order. The archive's original MFENX and third-party notices are
unchanged. The externally signed manifest authenticates this retained archive;
it does not rewrite its older build-time candidate descriptions or grant new
rights. For installation or purchase questions, see https://mfenx.com/support/.
Do not send private keys, recovery passphrases, models or datasets with a support
request.
