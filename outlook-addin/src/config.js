const runtimeConfig = globalThis.CORNERSTONE_SIGNATURES_CONFIG || {};

export const CLIENT_ID = String(runtimeConfig.clientId || '');
export const TENANT_ID = String(runtimeConfig.tenantId || '');
export const SIGNATURE_API_SCOPE = `api://${CLIENT_ID}/Signature.Read`;

export function assertConfigured() {
    if (!CLIENT_ID || !TENANT_ID) {
        throw new Error('Microsoft Entra application IDs have not been configured.');
    }
}
