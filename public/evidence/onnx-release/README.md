# Gate finite ONNX evaluation

This directory contains the exact source model, candidate, dataset, approved contract and local evaluation report underlying the demonstration receipt. The receipt's contract and report SHA-256 values bind these files. The report itself is an unsigned execution observation; its digest is covered by the issuer's receipt signature.

The evaluation ran on the recorded CPU through CKODMK 0.5.1 and ONNX Runtime 1.28.0. A temporary UTS namespace named `mfenx-gate-validation` kept the host's personal name out of the report; it did not emulate different compute hardware. This is one same-machine finite evaluation, not a general speedup, all-input equivalence or cross-platform result.

The public receipt uses a disposable demonstration signing key. Its public key is a demonstration trust anchor only. The private key was not retained.

## Check the record

Download `approved-contract.json` and `evaluation-report.json`. Compute their SHA-256 values and compare them with `statement.contract_sha256` and `statement.evaluation.report_sha256` in the receipt. The native report includes the source/candidate observations and the recorded finite-run timings. `run-manifest.json` gives the source revision and input identities.

Replay requires the exact supported runtime, files, execution profile and an independently approved contract. On another host, approve a new contract bound to that host rather than weakening the original check. A new run has new timing evidence and a different report digest.

## Dataset attribution

E. Alpaydin and C. Kaynak (1998), Optical Recognition of Handwritten Digits, UCI Machine Learning Repository. https://doi.org/10.24432/C50P49

Dataset license: Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/

The official test partition is represented as a numerical NPZ fixture used by CKODMK. The retained source and graph-optimized candidate models were produced by MFENX. No endorsement by the dataset authors or UCI is implied.
