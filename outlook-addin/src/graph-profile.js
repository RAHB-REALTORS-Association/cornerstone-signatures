import {
    createNestablePublicClientApplication,
    InteractionRequiredAuthError
} from '@azure/msal-browser';
import { CLIENT_ID, TENANT_ID, SIGNATURE_API_SCOPE, assertConfigured } from './config.js';

const GRAPH_PROFILE_URL = 'https://graph.microsoft.com/v1.0/me?$select=givenName,surname,displayName,jobTitle,mail,userPrincipalName,businessPhones,mobilePhone';
const GRAPH_TOKEN_SCOPES = ['User.Read', 'openid', 'profile'];

let msalInstance;

async function getMsalInstance() {
    assertConfigured();

    if (!msalInstance) {
        msalInstance = await createNestablePublicClientApplication({
            auth: {
                clientId: CLIENT_ID,
                authority: `https://login.microsoftonline.com/${TENANT_ID}`
            },
            cache: { cacheLocation: 'localStorage' }
        });
    }

    return msalInstance;
}

export async function getAccessToken({ interactive = false, scopes = GRAPH_TOKEN_SCOPES } = {}) {
    const instance = await getMsalInstance();
    const tokenRequest = { scopes };

    try {
        const result = await instance.acquireTokenSilent(tokenRequest);
        return result.accessToken;
    } catch (error) {
        if (interactive && isInteractionRequired(error)) {
            const result = await instance.acquireTokenPopup(tokenRequest);
            return result.accessToken;
        }

        throw error;
    }
}

export function getSignatureApiAccessToken({ interactive = false } = {}) {
    return getAccessToken({ interactive, scopes: [SIGNATURE_API_SCOPE] });
}

export function isInteractionRequired(error) {
    return error instanceof InteractionRequiredAuthError
        || error?.name === 'InteractionRequiredAuthError'
        || error?.errorCode === 'interaction_required'
        || error?.errorCode === 'login_required'
        || error?.errorCode === 'consent_required';
}

function splitDisplayName(displayName) {
    const parts = String(displayName ?? '').trim().split(/\s+/).filter(Boolean);
    return {
        firstName: parts[0] ?? '',
        lastName: parts.slice(1).join(' ')
    };
}

function mapGraphProfile(profile) {
    const fallbackName = splitDisplayName(profile.displayName);

    return {
        FirstName: profile.givenName || fallbackName.firstName,
        LastName: profile.surname || fallbackName.lastName,
        Title: profile.jobTitle || '',
        Phone: profile.businessPhones?.[0] || profile.mobilePhone || '',
        EmailAddress: profile.mail || profile.userPrincipalName || ''
    };
}

export async function getCurrentProfile({ interactive = false } = {}) {
    const accessToken = await getAccessToken({ interactive, scopes: GRAPH_TOKEN_SCOPES });
    const response = await fetch(GRAPH_PROFILE_URL, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        throw new Error(`Microsoft Graph profile request failed with HTTP ${response.status}.`);
    }

    return mapGraphProfile(await response.json());
}
