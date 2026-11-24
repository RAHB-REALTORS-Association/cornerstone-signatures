# Notes for future agent sessions

## Local development and validation

- Check `node --version` before running commands. This workstation's default Node was 23.11.0 when inspected on November 9, 2026; a cached Node 24.21.0 was available under `~/.npm/_npx/*/node_modules/node/bin/node`. Discover an available supported interpreter and put its directory first in `PATH` for both npm scripts and their child processes. Do not assume the default Node meets the project's requirement.
- Backend tests open local HTTP listeners. A restricted execution sandbox can block them with `listen EPERM` or leave a run waiting. Run the tests with localhost listeners permitted. The November 9 baseline was 43 passing tests on Node 24.21.0.
- The Outlook add-in bundles are committed release snapshots. Rebuild them when preparing a release after MSAL updates, even when `outlook-addin/src` is unchanged. Starting in 2.1.9, Docker independently rebuilds bundles from its locked dependencies, and the release workflow rebuilds them before packaging. A green CI build does not update committed bundles automatically.
- Dashboard rendering lives in `admin/app.js`, with styles in `admin/styles.css`. The shared `.stack` class uses CSS grid; stretched analytics cards can distribute spare height between their children. Keep `.analytics-card` aligned to the start and its content packed at the start. The long version list has its own scroll area.
- For visual checks, serve the actual admin HTML, JS, and CSS locally with synthetic responses for `/api/admin/session`, `/users`, `/templates`, `/deployments`, `/audit`, and `/dashboard`. Keep fixtures out of the repository and use no staff exports or production database. Verify 9,999, 10,000, 100,000, and 1,000,000 deliveries at desktop and mobile widths, including narrow side-by-side cards. Restore any temporary browser viewport override afterward.

## GitHub and releases

- The primary repository is `RAHB-REALTORS-Association/cornerstone-signatures`; `origin` points there and the default branch is `main`. The nearby `siggen` checkout is separate.
- The connected GitHub integration could read PRs and CI results but returned `403 Resource not accessible by integration` for merging. The authenticated `gh` CLI successfully merged PRs. Network and `.git` mutations may require an execution sandbox escalation.
- Before a point release, update `package.json`, the root and package entry versions in `package-lock.json`, `CHANGELOG.md`, and the Docker version examples in `README.md` and `docs/DEPLOYMENT.md`. Update user-facing docs when behavior changes.
- Merge the reviewed PR after checks pass, fast-forward local `main`, and tag the merged commit. Pushing `v*` tags triggers `.github/workflows/release.yml` and `.github/workflows/docker.yml`. The release workflow creates a GitHub Release with a source archive and sample manifest; the container workflow publishes amd64/arm64 images to GHCR with versioned and `latest` tags. Wait for both workflows to succeed before calling the release published. Do not manually create a competing release while the tag workflow is running.
- Dependabot-only patch/minor auto-merging starts in 2.1.9. Its trusted default-branch workflow checks bot identity, dependency-only changes, exact-SHA Node 24/26 CI and CodeQL results, and GitHub mergeability. Human PRs, majors, and changes to automation code remain manual. Token-authenticated merges dispatch default-branch CI explicitly; releases and deployment remain separate operations. See CONTRIBUTING.md for the full policy.

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

## Container security findings (November 24, 2026)

- Coolify's `get_vulnerabilities` tool can read the application scan directly; `action=resource`, `resource=application`, and the application UUID return affected packages, installed/fixed versions, and findings without fixes. Keep summaries concise: several findings can refer to the same CVE in both `libcrypto3` and `libssl3`.
- The official `node:26-alpine` image inspected that day contained npm 11.20.0 with its own vulnerable undici 6.28.0 and brace-expansion 5.0.9. The application's lockfile already had undici 6.29.1/7.30.1 and brace-expansion 5.0.12. Application npm overrides cannot patch the base image's global npm tree. The runtime now omits npm/Yarn; keep package installation in build stages.
- Pulling the latest Node image alone still left zlib 1.3.2-r1 and OpenSSL libraries 3.5.9-r0. `apk upgrade --no-cache` installed zlib 1.4-r0 and OpenSSL libraries 3.5.9-r1 from the same Alpine branch. Release image publication now pulls fresh base images and disables layer reuse so this upgrade step reruns.
- A clean application audit does not establish a clean container scan. Verify the final runtime image and report any remaining upstream findings honestly; do not assume every finding is fixed by rebuilding.
- Local Trivy scans of the unmodified Node base found 30 findings (6 high, 19 medium, 5 low); the rebuilt application image had zero findings with that scanner/database. Coolify's scan reported additional upstream findings and different severity ratings. These results are not interchangeable: re-scan the actual deployed image in Coolify before claiming its alert is cleared.
- The Coolify connector can queue application deployments and poll them, but the available tool set did not expose image-tag edits or an on-demand scan. Use the Chrome configuration form for the tag, verify it through `get_application`, then call `deploy` and poll `get_deployment`. Only the image tag and timestamps changed when the form was saved. Deployment automatically queued an image scan; a disabled **Scan now** button and progress indicator mean a scan is already pending/running.
- An unauthenticated request to the public health URL can receive a Cloudflare Access redirect. The signed-in Chrome session returned `{"ok":true}` after the v2.1.10 deployment. Do not treat a 302 or the configured tag alone as successful runtime verification.
- v2.1.10's rolling deployment completed successfully on November 24, 2026. The fresh Coolify scan at 14:30 UTC reported **No action needed**, with zero actionable problems. **All findings** still contained 17 package findings (10 high, 7 medium), all marked `no_fix`. The summary counts actionable problems rather than every raw finding; do not describe this as a scan with zero total vulnerabilities.

## GitHub Pages artifact visibility

- On November 24, 2026, `upload-pages-artifact@v5` finalized the `github-pages` artifact successfully, but `deploy-pages@v5` reported zero artifacts less than a second later. A full workflow retry reproduced it, and the artifact was visible through the GitHub API afterward.
- Keep upload and deployment in separate jobs, with `deploy.needs: build`, as recommended in the official action documentation. This addresses the same-job visibility race tracked at https://github.com/actions/deploy-pages/issues/451; retrying the unchanged single-job layout is insufficient.
