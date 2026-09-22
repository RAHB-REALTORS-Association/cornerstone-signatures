# Cornerstone Signatures contributor notes

- Node.js 24 is required because the service uses `node:sqlite`.
- Never commit `.env`, SQLite databases, staff exports, secrets, or generated `outlook-addin/manifest.xml`.
- Run `npm run build:addin` after changing `outlook-addin/src/*`.
- Run `npm run configure:addin` with deployment environment variables before validating or uploading a manifest.
- Run `npm test` before committing.
- Preserve `/app/data` across container upgrades.
- A fresh v2 database is expected. Import compatibility intentionally accepts only v2 exports and final v1 schema-13 exports.
- This project is AGPL-3.0-only. Deployed modifications must have complete corresponding source available to network users.
