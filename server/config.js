import path from 'node:path';

const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || (!isProduction ? `http://localhost:${port}` : '')).replace(/\/+$/, '');
const defaultOfficeAddinRuntimeUrls = [
  `${publicBaseUrl}/outlook-addin/dist/runtime-entry.js`,
  `${publicBaseUrl}/outlook-addin/dist/classic-runtime-entry.js`,
];
const officeAddinRuntimeUrls = String(process.env.OFFICE_ADDIN_RUNTIME_URLS || defaultOfficeAddinRuntimeUrls.join(','))
  .split(',').map((url) => url.trim()).filter(Boolean);

export const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port,
  publicBaseUrl,
  officeAddinRuntimeUrls,
  databasePath: process.env.DATABASE_PATH || (isProduction ? '/app/data/siggen.db' : path.resolve('data/siggen.db')),
  cloudflareTeamDomain: process.env.CLOUDFLARE_TEAM_DOMAIN,
  cloudflareAccessAudience: process.env.CLOUDFLARE_ACCESS_AUD,
  adminAllowedOrigins: String(process.env.ADMIN_ALLOWED_ORIGINS || '')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
  microsoftTenantId: process.env.MICROSOFT_TENANT_ID,
  microsoftApiAudience: process.env.MICROSOFT_API_AUDIENCE || (process.env.MICROSOFT_CLIENT_ID ? `api://${process.env.MICROSOFT_CLIENT_ID}` : undefined),
  microsoftGraphClientSecret: process.env.MICROSOFT_GRAPH_CLIENT_SECRET,
  outlookAddinId: process.env.OUTLOOK_ADDIN_ID,
  outlookProviderName: process.env.OUTLOOK_PROVIDER_NAME || 'Cornerstone Signatures',
  supportEmail: process.env.SUPPORT_EMAIL || '',
  sourceCodeUrl: process.env.SOURCE_CODE_URL,
  devAuthEmail: !isProduction ? process.env.DEV_AUTH_EMAIL : undefined,
  initialItAdmins: String(process.env.INITIAL_IT_ADMINS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
});

export function assertProductionConfig(value = config) {
  if (value.env !== 'production') return;
  const required = [
    ['CLOUDFLARE_TEAM_DOMAIN', value.cloudflareTeamDomain],
    ['CLOUDFLARE_ACCESS_AUD', value.cloudflareAccessAudience],
    ['ADMIN_ALLOWED_ORIGINS', value.adminAllowedOrigins.length],
    ['PUBLIC_BASE_URL', value.publicBaseUrl],
    ['MICROSOFT_CLIENT_ID', value.microsoftClientId],
    ['MICROSOFT_TENANT_ID', value.microsoftTenantId],
    ['MICROSOFT_API_AUDIENCE', value.microsoftApiAudience],
    ['OUTLOOK_ADDIN_ID', value.outlookAddinId],
    ['SOURCE_CODE_URL', value.sourceCodeUrl],
  ];
  const missing = required.filter(([, setting]) => !setting).map(([name]) => name);
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
  for (const setting of [['PUBLIC_BASE_URL', value.publicBaseUrl], ['SOURCE_CODE_URL', value.sourceCodeUrl], ...value.officeAddinRuntimeUrls.map((url) => ['OFFICE_ADDIN_RUNTIME_URLS', url])]) {
    let parsed;
    try { parsed = new URL(setting[1]); } catch { throw new Error(`${setting[0]} must contain absolute URLs.`); }
    if (parsed.protocol !== 'https:') throw new Error(`${setting[0]} must use HTTPS in production.`);
  }
}
