# MFENX Gate — organization runtime security and data flow

mfenx LLC · San Francisco, California

This is the current deployment record for the separately licensed organization runtime. The original technical-pack v1 ZIP and its security overview are retained unchanged as a historical SDK record, not as the current runtime configuration guide.

## Product and data flow

Gate is a local model-admission workflow and compact signed release-receipt format. The static browser verifier performs cryptographic checks with Web Crypto. The Python CLI verifies receipts, invokes the separately licensed CKODMK engine for supported ONNX evaluation, and inspects checkpoint integrity.

Model weights, evaluation samples and private signing keys are processed locally. They are not included in a compact receipt. A PCM package is different: it contains bound model and evaluation payloads and must be handled accordingly. Opening a public example downloads only that example. User-selected files are not uploaded, logged, stored in browser persistence or sent to an analytics service by the receipt instrument.

A receipt can disclose issuer name, artifact commitments, evaluation counts and policy identity. Share it deliberately. The optional organization runtime stores explicitly registered receipt metadata in the customer's own database; it is not an MFENX-hosted receipt-history service.

## Trust and assurance

The recipient selects a trusted P-256 SPKI public key independently. The verifier checks a strict versioned schema, canonical signature, content root, time validity, profile consistency and supplied artifact/policy commitments. Receipt authentication is an issuer attestation, not a proof of execution. Behavioral replay is separate. A recorded source identity does not establish an independently approved ancestry chain.

The release operator is responsible for signing-key custody, policy approval, local runtime trust, current trusted keys and system time. The deployment must load the exact bytes it checked. Current local verification does not query a revocation service. Apply rotation and expiry through the receiving trust policy.

## Execution profiles

ONNX issuance executes the approved CKODMK CPU classification contract and issues only on PASS. Inspection supports supported Safetensors/PyTorch inventory formats; receipt v1 Safetensors integrity issuance is single-file and does not attest to behavior. A finite evaluation does not establish behavior for untested inputs.

## Deployment controls

Pin packages, approved policy digests and runtime dependencies. Separate signing authority from model submissions. Do not make signing secrets available to untrusted pull requests. Retain evaluation evidence in access-controlled local storage and back up issuer material according to organization policy. Test updates and recovery before promotion.

The optional customer-operated organization runtime needs authenticated organization membership, TLS, durable storage, backup/recovery, independently trusted public entitlement keys and a valid signed license. It does not need Paddle credentials, an MFENX issuer private key or hosted billing routes. Receipt registration is transactional and idempotent. Organization policy and receipt records remain in the customer's environment.

MFENX's separate licensing service handles pseudonymous purchase-key and payment references; Paddle handles purchaser and payment information. Payment redirects do not establish entitlement. The licensing service reconciles current provider state before issuing a grant. Team and Business customers may run the optional one-shot renewal helper using protected customer-held recovery credentials; the organization runtime does not collect or host those credentials. Private air-gap grants retain disconnected delivery. Previously issued offline grants remain valid until their signed expiry; cancellation prevents new issuance, not instant offline revocation. Standalone receipt verification remains independent of subscription state.

The signed software-delivery manifest authenticates the exact organization-runtime archive and verifier and binds the separate public license issuer. It is neither a purchased entitlement nor a model-admission receipt. Installation instructions and independently enrolled publisher pins are at https://mfenx.com/docs/runtime/. The original technical-pack ZIP and component notices remain unchanged; this document describes the current separated deployment.

## Procurement artifacts

The exact delivered component package contains its applicable license and third-party notices. Paid internal use follows the published commercial terms at https://mfenx.com/terms/ and any applicable order. Deployment-specific data agreements, service commitments and requested tax forms are separate documents. This technical record is not a security certification, penetration-test report or warranty of defect-free operation.

Technical interfaces: https://mfenx.com/docs/
Free verifier: https://mfenx.com/verify/
Evidence: https://mfenx.com/evidence/

Software-admission candidate

Gate 1.1.0rc1 and organization service 0.4.0rc1 are development candidates;
the published Gate 1.0.0 distribution remains the installed-release reference.
Release Receipt v1 and its signature transcript are unchanged. Candidate
qualification is separate from the installed runtime described above.

The candidate `onnx-cpu-owned-bytes/v1` loader accepts self-contained ONNX
models up to 64 MiB. It authenticates the receipt, independent issuer and
contract pins, explicit release approval and protected deployment policy, then
verifies and retains immutable bytes through CPU loading and inference. External
tensor dependencies, custom operators and unsupported runtime profiles reject.
Policy epochs, rollback floors, short leases and per-call checks govern serving;
receipt registration alone does not activate a session. Finite evaluation
attestation and local replay remain separate results.

The accompanying browser change binds asynchronous evaluation to the selected
model, contract, dataset and issuer. A changed input invalidates download
permission; completion of a superseded evaluation cannot restore it.

These software controls trust the kernel and runtime process. They do not
establish confidential GPU execution, hardware-bound key delivery or a proof
of model inference. Those profiles require independent hardware and workload
qualification before deployment. Protected publication and deployment must
reverify the exact promoted object rather than resolve a mutable model tag.

Observed CUDA and publication boundaries

The additive candidate profile `onnx-cuda12-owned-bytes/v1` was exercised on
an RTX 4090 with ONNX Runtime GPU 1.26.0 and CUDA 12.8. Fifteen combined CUDA/proof-admission tests
passed without skips, including loading after pathname replacement, repeated
device execution, runtime-configuration pinning and native CPU-placement
fallback rejection. Under a separately declared test contract, 1,797 rows
produced identical CPU/CUDA class decisions; maximum absolute logit difference
was 7.62939453125e-06 against a predeclared tolerance of 0.0001. The test used
a temporary test authority. It does not alter the existing CPU release
contract or authorize production deployment. The 2 GiB CUDA provider arena rejected an actual signed 3 GiB allocation.
This is not a total device-memory quota; aggregate fleet enforcement is separate.

The model-gate action also completed an
[immutable publication transport test](https://github.com/JROChub/model-gate-action/actions/runs/43557513072).
A separate runner downloaded the exact artifact ID and checked retained model,
receipt and promotion-record digests before repeating Gate verification with
an independent test key. Same-size substitutions and an unauthorized issuer
were rejected. This test does not configure a customer's protected release
authority or permanent artifact registry.

The Power House security candidate upgrades the optional RISC Zero backend to
3.1.0 for
[GHSA-g6qg-9j8p-7j87](https://github.com/risc0/risc0/security/advisories/GHSA-g6qg-9j8p-7j87).
Earlier execution receipts require regeneration. Historical PHA core and
Rootprint identities remain distinct from acceptance of their external proof
attachments; pre-upgrade proof-conformance logs are not current security
qualification.

The candidate also includes an indexed model-evaluation guest, using the patched
SFCS backend, and Linux policy `mfenx/admission-policy/v2`. The verified journal
binds exact model and dataset identities, sample index and result commitment.
Admission requires the independently approved guest, journal and verifier and
rejects unrelated or missing evidence before model parsing. The retained proof
identity is recorded with the serving session. Fifteen combined tests exercised
these checks and actual proof-backed CUDA activation. This relation proves one
ordered FP32 guest evaluation, not CUDA execution or general model safety.

Extended deployment and recovery acceptance

The complete deployment suite passed 269 tests and 143 subtests with no skips
under CPython 3.13 and checksum-pinned Caddy 2.11.9. Actual offline installation,
installed-runtime acceptance, browser-format renewal, database backup and all
three executable proxy configurations were exercised. Four additional CPU
serving tests observed signer rotation, consistent snapshot recovery with
retained policy floors, authority outage and lost durable state. These use
synthetic authorities; live merchant settlement and confidential hardware
recovery are separate boundaries.

Protected publication and authenticated staging serving

The protected main-only publication environment completed
[run 43584975561](https://github.com/JROChub/model-gate-action/actions/runs/43584975561).
Its [immutable release](https://github.com/JROChub/model-gate-action/releases/tag/publication-qualification-43584975561-1)
retained asset 747114439, SHA-256
`06a64a1e220967630a52741882a5b01b7801213f3e4013a8c0881554e6b99230`.
Both publisher and owner mutation attempts denied after successful draft-edit
controls; the downloaded bytes remained identical. This test authority does
not authorize customer production releases.

The final H100 run passed 16 CUDA/proof tests and five gateway tests with
zero skips, failures or errors. The independently authenticated HTTPS gateway
returned CUDA outputs from the retained model after pathname replacement,
then denied policy withdrawal without another native call. Trusted database
migration preserved epoch 6/floor 2; epoch 7/floor 3 served and withdrawal
at epoch 8 prevented old-policy restart. A separate Linux pidfd watchdog
terminated a long native loop and a native call holding the interpreter lock.
The gateway is serialized and bounded, not a general multi-tenant scheduler.

Browser verification remains local. Optional gateway clients explicitly send
inference inputs to the operator's endpoint; this is a separate data flow.
No model, receipt, authority or loader path can be selected through that
request. Transport and credential custody remain operator responsibilities.

The inspected Runpod H100 reported no CPU confidential-computing capability,
GPU confidential mode off and no protected GPU memory. No confidential
execution, attested key release or protected decryption profile was qualified.
The test allocations were deleted after evidence retention. Source, logs,
policies, public test authorities and audit snapshots are linked from
[the admission record](https://mfenx.com/docs/admission/#serving).
