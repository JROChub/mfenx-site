# Lights Out release evidence

## Current commercial software

Lights Out Local Supercomputer V2 release `v0.1.3` is the current signed commercial software release. Its canonical identity, release verification, signed automated security assurance, and validated V2 engine evidence are bound by `current-release/COMMERCIAL-STATUS.canonical.json`.

## Browser-verified engine captures

`release/` contains selected, browser-verified files from the validated MFENX Local V2 engine capture.

`release-v1/` preserves the exact selected payload that was published for the accepted MFENX Local v1 capture. Its files are retained as an immutable comparator; future releases must use a new versioned directory rather than changing `release-v1/`.

Each directory includes the complete capture `SHA256SUMS` file. The browser verifies every published selected file against the corresponding full-capture manifest entry, then validates the signed current-release record before displaying the results.
