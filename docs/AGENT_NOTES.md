# Notes for future agent sessions

## Local development and validation

- Check `node --version` before running commands. This workstation's default Node was 23.11.0 when inspected on November 9, 2026; a cached Node 24.21.0 was available under `~/.npm/_npx/*/node_modules/node/bin/node`. Discover an available supported interpreter and put its directory first in `PATH` for both npm scripts and their child processes. Do not assume the default Node meets the project's requirement.
- Backend tests open local HTTP listeners. A restricted execution sandbox can block them with `listen EPERM` or leave a run waiting. Run the tests with localhost listeners permitted. The November 9 baseline was 43 passing tests on Node 24.21.0.
- The Outlook add-in bundles are committed and copied into the production image. Rebuild them after dependency updates to MSAL, even when `outlook-addin/src` is unchanged. A green CI build does not update committed bundles automatically.
- Dashboard rendering lives in `admin/app.js`, with styles in `admin/styles.css`. The shared `.stack` class uses CSS grid; stretched analytics cards can distribute spare height between their children. Keep `.analytics-card` aligned to the start and its content packed at the start. The long version list has its own scroll area.
- For visual checks, serve the actual admin HTML, JS, and CSS locally with synthetic responses for `/api/admin/session`, `/users`, `/templates`, `/deployments`, `/audit`, and `/dashboard`. Keep fixtures out of the repository and use no staff exports or production database. Verify 9,999, 10,000, 100,000, and 1,000,000 deliveries at desktop and mobile widths, including narrow side-by-side cards. Restore any temporary browser viewport override afterward.

## GitHub and releases

- The primary repository is `RAHB-REALTORS-Association/cornerstone-signatures`; `origin` points there and the default branch is `main`. The nearby `siggen` checkout is separate.
- The connected GitHub integration could read PRs and CI results but returned `403 Resource not accessible by integration` for merging. The authenticated `gh` CLI successfully merged PRs. Network and `.git` mutations may require an execution sandbox escalation.
- Before a point release, update `package.json`, the root and package entry versions in `package-lock.json`, `CHANGELOG.md`, and the Docker version examples in `README.md` and `docs/DEPLOYMENT.md`. Update user-facing docs when behavior changes.
- Merge the reviewed PR after checks pass, fast-forward local `main`, and tag the merged commit. Pushing `v*` tags triggers `.github/workflows/release.yml` and `.github/workflows/docker.yml`. The release workflow creates a GitHub Release with a source archive and sample manifest; the container workflow publishes amd64/arm64 images to GHCR with versioned and `latest` tags. Wait for both workflows to succeed before calling the release published. Do not manually create a competing release while the tag workflow is running.

## Coolify deployment

Observed through Chrome on November 9, 2026:

- The application is **Cornerstone Signatures**, under **Cornerstone Association → production**, on **VPS06**. It deploys the prebuilt `ghcr.io/rahb-realtors-association/cornerstone-signatures` image rather than building a Git checkout.
- Coolify exposes container port `3000` on the `coolify` Docker network. Its domain configuration points `siggen.oncornerstone.app` to port 3000; the public app is reached over HTTPS.
- A named volume mounts at `/app/data`, with S3 volume backups enabled. Preserve that volume during every upgrade. The default SQLite path is `/app/data/cornerstone-signatures.db`.
- Coolify's HTTP health check is `GET /api/health` on port 3000, expecting status 200. The public endpoint returned `{"ok":true}`. This response does not identify the running application version.
- The configuration displayed image tag `v2.1.6`, while the newest deployment-history entry was October 27. A configured image tag and a Running badge do not establish the exact running image version. Confirm the deployed image/version separately when doing an upgrade.
- Coolify 4.6.0 showed an unsaved-changes banner even in a fresh inspection tab before any edits. Do not save or reset settings merely to dismiss the banner. Preserve the user's existing tab; inspect in a separate tab when necessary. Direct navigation to an observed configuration link worked when sidebar navigation appeared to stay on the same page.
- Browser access to the Coolify origin initially required explicit user approval because the browser review gate did not recognize it as the requested instance. Approval was granted for the inspection in that session; follow the active browser authorization rules in future sessions.
- Publishing a GitHub release and updating the production deployment are separate operations. A new image tag alone does not prove that Coolify pulled or deployed it.
