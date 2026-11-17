# Contributing

By contributing, you agree that your contribution is licensed under AGPL-3.0-only.

Use Node.js 24 or later. Create a focused branch, run `npm ci`, `npm run build:addin`, and `npm test`, and do not commit tenant IDs, client secrets, real staff data, generated databases, or `outlook-addin/manifest.xml`. Security issues should follow [SECURITY.md](SECURITY.md), not a public issue.

The production image and release workflow use Node.js 26. CI verifies Node.js 24 and 26. Dependabot groups weekly version updates by npm, GitHub Actions, and Docker; npm and Actions security updates use separate groups. Refresh `package-lock.json` alongside dependency changes and rebuild the committed Outlook bundles when browser dependencies change.

The `glob` and `minimatch` overrides patch transitive MJML dependencies. Keep them until upstream accepts patched versions; verify MJML rendering, CLI compilation, and EditorConfig matching when changing or removing them.

## Dependabot auto-merge

The implementation follows the verified-commit approach used by wav-maker and selenium-screenshots. Only open, non-draft PRs authored by `dependabot[bot]`, from this repository's configured `patch-and-minor` groups and targeting the default branch, are eligible. npm and GitHub Actions also have patch/minor security groups. Major updates, ordinary PRs, old unrestricted groups, and edits to the automerge workflow/script require manual review.

The gate checks dependency-only file changes: existing stable npm pins within the same major plus their integrity-checked npm-registry lockfile, existing Docker image references within the same major/channel, or same-major action references in existing CI/release/Pages/container workflows. Changes to scripts, permissions, source, dependency names, or other files block automatic merging.

Both `test (24)` and `test (26)` must pass at the exact PR head SHA; CI includes `npm audit`. CodeQL must finish successfully or report that no analysis applies, and all other reported checks/statuses must finish without failure. The gate waits up to five minutes for late checks, rechecks head/base and mergeability, and submits the tested SHA to GitHub. Existing branch protection and review requirements remain enforced. Rerun PR CI after resolving a failure to retry.

The privileged `workflow_run` job only executes trusted default-branch code, never PR code or dependencies. It uses the short-lived repository token and dispatches CI on `main` after a merge because token-authenticated merges do not trigger push workflows. No new secret or personal token is required. It does not auto-tag, create releases, publish images, or deploy production.

Docker now builds browser bundles from its own locked dependencies. The release workflow also rebuilds them before packaging source artifacts. Refresh committed bundles when preparing a tagged release; future dependency-only auto-merges may leave those repository snapshots unchanged until then.
