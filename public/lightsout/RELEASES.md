# Lights Out technical releases

## Forthcoming private product release v0.1.7

The next Lights Out product release extends the native scientific engine with dependency-free C11 plans for batched, power-of-two complex FP64 transforms. Immutable plans retain canonical bit-reversal and twiddle tables; forward and inverse execution supports padded batches, exact in-place operation, and allocation-free submission through the persistent worker pool.

Fast execution dispatches scalar, SSE2, AVX, or AVX2 + FMA butterfly kernels according to the resolved host backend. The reproducible policy retains one fixed non-contracting arithmetic order and canonical floating-point environment across supported backends and lane counts.

The CBLAS path now classifies the live elements of strided matrices with an allocation-free exact interval merge. Disjoint HPL-shaped submatrices sharing one padded panel remain on the native zero-copy DGEMM path, while genuine overlap retains snapshot-safe packing.

Cluster Placement Contract v1 binds an MPI launch to inventory-identified nodes, rank capacity, threads per rank, launcher family, canonical shared-filesystem root, deterministic hostfile bytes, and rank participation records.

## Scientific evidence v0.1.6

The v0.1.6 scientific release brings source-locked HPL, HPCG, tuned STREAM 5.10, OSU Micro-Benchmarks, and upstream NPB system qualification into one machine-readable summary. Provider telemetry, where applicable, remains connected to the exact build, topology, raw output, and extracted result.

The active suite and its complete preceding record history are preserved in the signed evidence bundle. The browser-checked summary presents the accepted measurements, upstream verification, and exact release identity.

The public static summary, benchmark attribution, release-key controls, and signed checksum manifest are available under `evidence/v0.1.6/`. The Lights Out page verifies the complete seven-file publication set before displaying its measured results.

## QQfenx performance v0.1.4

The signed v0.1.4 QQfenx performance record preserves exact wrapping-u32 results, same-compiler dense-C comparisons, packed Q8/Q16 measurements, zero-ideal and cancellation-cascade measurements, four-lane scaling, and source identity for commit `01e2c6e`.

Its canonical certificate, detached signature, release key, and signer policy remain under `qqfenx-performance-v0.1.4/`.

## Execution foundation v0.1.3

The signed v0.1.3 execution foundation remains available with selected v2 engine evidence and the preserved v1 comparator. Browser checks validate the selected evidence files against their pinned full-capture SHA-256 manifests before displaying execution, replay, recovery, and same-workload comparison results.
