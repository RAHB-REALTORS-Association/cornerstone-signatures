# Deployment guide

## 1. Prepare the service

Copy `.env.example` and fill every production setting. Use a stable HTTPS `PUBLIC_BASE_URL`, a stable UUID for `OUTLOOK_ADDIN_ID`, and a public `SOURCE_CODE_URL` containing the exact deployed source. Store `MICROSOFT_GRAPH_CLIENT_SECRET` only in your platform's encrypted or masked secret store.

Build and run the image with a persistent volume at `/app/data`:

```sh
docker build -t cornerstone-signatures:2.1.2 .
docker run --env-file .env -p 3000:3000 -v cornerstone-signatures-data:/app/data cornerstone-signatures:2.1.2
```

The health check is `GET /api/health`. Back up the database from **Manage → Data management** as well as backing up the volume.

## 2. Configure Cloudflare Access

Protect `/`, `/admin/*`, and `/api/admin/*`. Set `CLOUDFLARE_TEAM_DOMAIN`, `CLOUDFLARE_ACCESS_AUD`, and the exact browser origins in `ADMIN_ALLOWED_ORIGINS`.

Outlook cannot reuse a browser's Access session. Bypass Access only for:

```text
/outlook-addin/*
/api/outlook/signature
/.well-known/microsoft-officeaddins-allowed.json
```

The signature endpoint still verifies a Microsoft token for the configured tenant, audience, and delegated scope. Never bypass `/api/admin/*`.

## 3. Register Microsoft Entra

Create a single-tenant application registration and configure:

1. An Application ID URI and delegated `Signature.Read` scope.
2. The SPA redirect URI `brk-multihub://YOUR_PUBLIC_HOST` for nested app authentication.
3. Delegated Microsoft Graph `User.Read` with admin consent.
4. Application Microsoft Graph `User.Read.All` with admin consent for server-side directory synchronization and profile photos.
5. A client secret whose **value** is stored as `MICROSOFT_GRAPH_CLIENT_SECRET`.
6. The public-host identifier URI `api://YOUR_PUBLIC_HOST/CLIENT_ID` and access-token version 2 for classic Outlook.
7. The Microsoft Office client application as an authorized client for the required delegated scope.

Use the resulting tenant ID, client ID, and API audience in the environment.

## 4. Generate and deploy the Outlook manifest

With the deployment environment loaded, run:

```sh
npm run configure:addin
npm run build:addin
npm run validate:addin
```

Upload `outlook-addin/manifest.xml` through Microsoft 365 **Settings → Integrated apps** and assign it to the intended users or group. The running server also exposes the configured manifest at `/outlook-addin/manifest.xml`. Manifest changes require another Microsoft 365 upload; ordinary application, template, and server changes do not.

Microsoft propagation may take hours. Restart Outlook after the assignment appears. Remove users' old automatic Outlook signatures to avoid duplicates.

## 5. First sign-in

Set one or more emergency addresses in `INITIAL_IT_ADMINS`, sign in through Access, then configure organization information, Entra filters, location mappings, roles, taglines, and templates in the application. Keep the bootstrap list small.

## Releases and containers

Pull requests and pushes run tests and add-in builds. Tags matching `v*` publish multi-architecture container images to GitHub Container Registry. Creating a GitHub Release also attaches a source archive and a generated sample manifest; see `.github/workflows`.
