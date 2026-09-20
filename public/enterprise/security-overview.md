# MFENX Gate — technical procurement record

mfenx LLC · San Francisco, California

## Product and data flow

Gate is a local model-admission workflow and compact signed release-receipt format. The static browser verifier performs cryptographic checks with Web Crypto. The Python CLI verifies receipts, invokes the separately licensed CKODMK engine for supported ONNX evaluation, and inspects checkpoint integrity.

Model weights, evaluation samples and private signing keys are processed locally. They are not included in a compact receipt. A PCM package is different: it contains bound model and evaluation payloads and must be handled accordingly. Opening a public example downloads only that example. User-selected files are not uploaded, logged, stored in browser persistence or sent to an analytics service by the receipt instrument.

A receipt can disclose issuer name, artifact commitments, evaluation counts and policy identity. Share it deliberately. A managed history service is optional and requires explicit registration of receipt metadata.

## Trust and assurance

The recipient selects a trusted P-256 SPKI public key independently. The verifier checks a strict versioned schema, canonical signature, content root, time validity, profile consistency and supplied artifact/policy commitments. Receipt authentication is an issuer attestation, not a proof of execution. Behavioral replay is separate. A recorded source identity does not establish an independently approved ancestry chain.

The release operator is responsible for signing-key custody, policy approval, local runtime trust, current trusted keys and system time. The deployment must load the exact bytes it checked. Current local verification does not query a revocation service. Apply rotation and expiry through the receiving trust policy.

## Execution profiles

ONNX issuance executes the approved CKODMK CPU classification contract and issues only on PASS. Inspection supports supported Safetensors/PyTorch inventory formats; receipt v1 Safetensors integrity issuance is single-file and does not attest to behavior. A finite evaluation does not establish behavior for untested inputs.

## Deployment controls

Pin packages, approved policy digests and runtime dependencies. Separate signing authority from model submissions. Do not make signing secrets available to untrusted pull requests. Retain evaluation evidence in access-controlled local storage and back up issuer material according to organization policy. Test updates and recovery before promotion.

An optional control-plane deployment additionally needs authenticated organization membership, TLS, durable storage, backup/recovery, protected entitlement keys and verified payment-provider configuration. Payment completion redirects do not grant an entitlement. Duplicate payment events and idempotent receipt registration require transactional handling. Offline verification remains independent of subscription state.

## Procurement artifacts

The exact delivered component package contains its applicable license and third-party notices. Deployment-specific commercial terms, DPA, service commitments, tax forms and data-retention selections are separate executed documents. This technical record is not a security certification, penetration-test report or warranty of defect-free operation.

Technical interfaces: https://mfenx.com/docs/
Free verifier: https://mfenx.com/verify/
Evidence: https://mfenx.com/evidence/
