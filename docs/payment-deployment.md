# Isolated payment document root

Publish only `index.html`, `payment.js`, `payment.css` and a deployment-specific
`checkout-config.json` at **https://pay.mfenx.com/**. This directory is a separate
document root, not an additional payment route on the main website or licensing
origin. The checked-in configuration disables checkout.

The page accepts one five-minute Ed25519-signed checkout ticket in the URL
fragment. It clears query and fragment before requesting configuration. Local
schema failures cause no configuration request; signature verification requires
only the same-origin configuration. Paddle is loaded only after verification and
an explicit click. Reloading the page requires a newly prepared link.

## Configuration and signature

Provision the issuer public key independently from the licensing service. Do
not obtain a key or origin from the incoming ticket. The configuration has
exactly these keys:

```text
schema                 mfenx.gate.checkout-config.v1
enabled                boolean
environment            sandbox | live
issuer                 https://license.mfenx.com
origin                 https://pay.mfenx.com
paddle_client_token    public test_… or live_… client token, matching environment
key_id                 pinned issuer key identifier
public_key_spki_base64  canonical base64 of the 44-byte Ed25519 SPKI
```

For an enabled deployment, serialize configuration as canonical ASCII JSON:
sorted keys, compact separators, no whitespace or trailing newline. The ticket
envelope and payload use the same canonicalization. The signature covers the
canonical payload bytes, whose schema is `mfenx.gate.checkout.v1`; a checkout
ticket is not an entitlement. The page accepts only the named Team, Business and
Private prices, USD, quantity one and the corresponding month/year interval.
Configuration and ticket decoding are bounded to 4,096 bytes/encoded characters,
respectively. A configuration request is limited to ten seconds; SDK loading to
fifteen seconds. Ticket expiry is rechecked after asynchronous loading.

## Server boundary

Serve through HTTPS without cookies or server-side session state. Set
`Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`,
`X-Frame-Options: DENY` and an HTTP Content-Security-Policy containing
`frame-ancestors 'none'`. Preserve the page's other CSP restrictions when adding
the response policy. Do not allow CORS. No model, signing key, license-recovery
file, passphrase, account endpoint or license API belongs on this origin.

Paddle's script runs on this isolated origin after the user continues; Paddle
handles its payment interface and purchaser information. MFENX's page code does
not read or write browser storage or cookies. This is not a claim about storage
inside Paddle's independently operated payment interface.

The page opens an existing transaction only. It supplies no line items, customer
fields, custom data or event callback. The return URL is fixed to the licensing
origin. Payment completion and license issuance must still be established by
server-side payment reconciliation. A valid ticket can be reopened during its
short lifetime; it is not a one-time payment token or a revocation mechanism.

## Validation

From the site repository, with pytest, cryptography, Playwright and Chromium:

```sh
python -m pytest tests/browser_gate_payment.py -q
```

The browser suite intercepts all network requests and uses synthetic signing
keys and a Paddle SDK double. It exercises browser cryptography, UI boundaries
and rejection behavior; it does not prove payment collection, merchant approval
or live delivery. Qualify the separately deployed sandbox checkout before live
activation.

Paddle interfaces: [Initialize](https://developer.paddle.com/paddle-js/methods/paddle-initialize/),
[Checkout.open](https://developer.paddle.com/paddle-js/methods/paddle-checkout-open/),
[environment selection](https://developer.paddle.com/paddle-js/methods/paddle-environment-set/).
