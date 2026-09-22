# Cornerstone Signatures

Cornerstone Signatures is a self-hosted Microsoft 365 email-signature manager. It synchronizes people from Microsoft Entra, lets Communications design and publish email-safe templates, and applies the correct signature in Outlook—including shared mailboxes and classic Outlook.

## Highlights

- Visual MJML and legacy HTML template editors
- Immutable publishing, limited audiences, integer priority, scheduling, and rollback by unpublishing
- Entra synchronization with filters, profile photos, local field overrides, blocking, and scheduled refreshes
- Outlook event-based activation for web, Windows, macOS, iOS, Android, and classic Outlook
- Shared-mailbox eligibility with signed-in-person or mailbox identity modes
- Organization, location, custom merge-tag, tagline, and self-service configuration
- Role-based IT and Communications administration, audit export, and SQLite backup/restore
- One Node 24 container and one persistent SQLite volume

## Quick start

```sh
cp .env.example .env
npm ci
npm run build:addin
npm test
npm start
```

Node.js 24 or later is required. Development authentication can be enabled with `DEV_AUTH_EMAIL`; never set it in production.

Deployment requires Cloudflare Access (or compatible Access JWT headers), a Microsoft Entra application, HTTPS, and a persistent mount for `/app/data`. Follow [Deployment](docs/DEPLOYMENT.md), then [Administrator and user guide](docs/USER_GUIDE.md).

## Upgrading from Siggen v1

Version 2 starts from a clean schema and contains no historical migration chain or organization seed data. Export the database from the latest v1 release (schema 13), start v2 with a fresh database, sign in as an `INITIAL_IT_ADMINS` user, and import that export under **Manage → Data management**. Older exports must first be restored and upgraded by the final v1 release.

## License

Copyright contributors to Cornerstone Signatures. Licensed under the [GNU Affero General Public License v3.0 only](LICENSE). Operators must keep `SOURCE_CODE_URL` pointed at the complete corresponding source offered to network users, including their deployed modifications.
