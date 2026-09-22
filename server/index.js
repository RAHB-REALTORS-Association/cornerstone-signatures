import { createApp } from './app.js';
import { createMicrosoftUserResolver } from './auth.js';
import { assertProductionConfig, config } from './config.js';
import { openDatabase } from './db.js';
import { createGraphDirectoryProvider } from './entra.js';
import { startDirectorySyncScheduler } from './directory-scheduler.js';
import { startDeploymentScheduler } from './deployment-scheduler.js';

assertProductionConfig();
const db = openDatabase(config.databasePath, { initialItAdmins: config.initialItAdmins });
const directoryProvider = createGraphDirectoryProvider({
  tenantId: config.microsoftTenantId,
  clientId: config.microsoftClientId,
  clientSecret: config.microsoftGraphClientSecret,
});
const app = createApp({
  db,
  auth: {
    teamDomain: config.cloudflareTeamDomain,
    audience: config.cloudflareAccessAudience,
    devAuthEmail: config.devAuthEmail,
    env: config.env,
    allowedOrigins: config.adminAllowedOrigins,
  },
  microsoftUserResolver: createMicrosoftUserResolver({ tenantId: config.microsoftTenantId, audience: config.microsoftApiAudience }),
  directoryProvider,
  protectedStaffEmails: config.initialItAdmins,
  officeAddinRuntimeUrls: config.officeAddinRuntimeUrls,
  outlookConfig: {
    clientId: config.microsoftClientId, tenantId: config.microsoftTenantId, publicBaseUrl: config.publicBaseUrl,
    addinId: config.outlookAddinId, providerName: config.outlookProviderName, sourceCodeUrl: config.sourceCodeUrl,
  },
});
const stopDirectoryScheduler = startDirectorySyncScheduler({ db, directoryProvider });
const stopDeploymentScheduler = startDeploymentScheduler({ db });

const server = app.listen(config.port, () => console.log(`Cornerstone Signatures listening on :${config.port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopDirectoryScheduler(); stopDeploymentScheduler(); server.close(() => { db.close(); process.exit(0); }); });
}
