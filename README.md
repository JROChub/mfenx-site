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

## Validate locally

```bash
python3 scripts/validate_site.py --root public
node tests/test_gate_legacy_links.mjs
node tests/test_instrument_cache_isolation.mjs
find public -type f \( -name '*.js' -o -name '*.mjs' \) -print0 \
  | xargs -0 -n1 node --check
```

With the pinned Playwright browser runtime installed, run
`python3 tests/browser_site_design.py --root public` for the complete route
and responsive layout matrix, `tests/browser_home_evidence.py` for published
record inspection, and `tests/browser_research_interfaces.py` for the research
instruments. These accompany the verification and commercial security suites
in the production deployment gate.

Production changes should be reviewed as pull requests. Only a validated commit
on `main` is eligible for the protected `github-pages` environment.

## Rights

Copyright © 2026 MFENX. All rights reserved. See [LICENSE](LICENSE). Third-party
components remain governed by their own notices under `public/`.
