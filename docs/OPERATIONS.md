# Website operations

## Release path

1. Open a pull request containing the complete website change.
2. Require the `Validate production payload` check and code-owner review.
3. Merge a signed commit to protected `main`.
4. The deployment job uploads only `public/` as the Pages artifact.
5. Confirm the `github-pages` deployment and run the external route/browser
   checks against `https://mfenx.com/`.

No workflow in this repository may dispatch, push to, or check out Power House
or a private product repository.

## Rollback

Revert the production commit through a reviewed pull request. The revert creates
a new auditable deployment; do not force-push the protected production branch as
a rollback mechanism.

## Domain controls

- Canonical host: `mfenx.com`
- `www.mfenx.com` redirects to the canonical apex domain.
- HTTPS enforcement remains enabled in Pages settings.
- The domain must remain verified in the owning GitHub account with its DNS TXT
  challenge record present.
- Avoid wildcard DNS records for the domain.

## Required repository controls

- Require pull requests and code-owner review for `main`.
- Require the validation check, signed commits, linear history, and resolved
  review conversations.
- Block branch deletion and force pushes.
- Limit the `github-pages` environment to protected `main`.
- Keep the default workflow token read-only; grant `pages: write` and
  `id-token: write` only to the deployment job.
- Require third-party Actions to be pinned to full commit SHAs.
- Enable secret-scanning push protection and private vulnerability reporting.
