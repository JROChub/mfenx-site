# MFENX Web

Production delivery for [mfenx.com](https://mfenx.com/).

The deployable website is contained exclusively in `public/`. Repository
automation validates that tree, rejects prohibited commercial artifacts, and
publishes only that directory to GitHub Pages. Repository metadata, tests, and
workflows are never included in the public site artifact.

## Repository layout

- `public/` — exact static payload served at the domain root
- `scripts/` — dependency-free validation used locally and in CI
- `.github/workflows/site.yml` — validation and production deployment
- `docs/OPERATIONS.md` — release, rollback, and domain controls

This repository is a website delivery boundary. It has no submodule, build
dependency, workflow dependency, or write path to Power House or to any private
MFENX product repository. Product source and commercial executables do not
belong here.

Atomic Roc Roc at `/lightsout/atomic/` is a browser-delivered game. Its one
compiled WebAssembly module is the explicit browser-runtime asset, accompanied
by a hash-bound build manifest. Native C sources, build inputs and native
executables remain in the private product repository; this site does not build
or retrieve them. The public game contains its own independent BigInt replay
checker, local replay-capsule workflow and bounded-worker acceptance tests.

## Validate locally

```bash
python3 scripts/validate_site.py --root public
node tests/test_atomic_engine.mjs
find public -type f \( -name '*.js' -o -name '*.mjs' \) -print0 \
  | xargs -0 -n1 node --check
```

With the pinned Playwright browser runtime installed, also run
`python3 tests/browser_atomic.py --root public` for game missions, local replay,
mobile layout and rejection/recovery journeys. These checks accompany the
existing full-site browser suite in the production deployment gate.

Production changes should be reviewed as pull requests. Only a validated commit
on `main` is eligible for the protected `github-pages` environment.

## Rights

Copyright © 2026 MFENX. All rights reserved. See [LICENSE](LICENSE). Third-party
components remain governed by their own notices under `public/`.
