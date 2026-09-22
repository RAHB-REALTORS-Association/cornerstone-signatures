import { getSignatureApiAccessToken } from './graph-profile.js';

const MANAGED_SIGNATURE_URL = '/api/outlook/signature';

export class ManagedSignatureError extends Error {
    constructor(message, { status = 0, code = '' } = {}) {
        super(message);
        this.name = 'ManagedSignatureError';
        this.status = status;
        this.code = code;
    }
}

async function readResponseBody(response) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;

    try {
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * Gets the signature selected for the signed-in user by the Cornerstone Signatures backend.
 * A null result is intentional: the user is not applicable or has no active
 * deployment, so Outlook should leave the message body alone.
 */
export async function getManagedSignature({ interactive = false, senderEmail = '' } = {}) {
    const accessToken = await getSignatureApiAccessToken({ interactive });
    const query = senderEmail ? `?sender=${encodeURIComponent(senderEmail)}` : '';
    const response = await fetch(`${MANAGED_SIGNATURE_URL}${query}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`
        }
    });

    if (response.status === 204) return null;

    const body = await readResponseBody(response);
    if (!response.ok) {
        const code = body?.code || body?.error?.code || '';
        const message = body?.message || body?.error?.message
            || `Managed signature request failed with HTTP ${response.status}.`;
        throw new ManagedSignatureError(message, { status: response.status, code });
    }

    const html = body?.html;
    if (typeof html !== 'string' || !html.trim()) {
        throw new ManagedSignatureError('The managed signature response did not include HTML.', {
            status: response.status,
            code: 'invalid_response'
        });
    }

    return {
        html,
        templateName: body.templateName || '',
        version: body.version ?? '',
        user: body.user || null,
        sender: body.sender || null,
        signatureIdentityMode: body.signatureIdentityMode || 'signed_in'
    };
}

export async function getManagedPreferences({ interactive = false } = {}) {
    const accessToken = await getSignatureApiAccessToken({ interactive });
    const response = await fetch(`${MANAGED_SIGNATURE_URL}?preferences=1`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`
        }
    });
    if (!response.ok) throw new ManagedSignatureError('Could not read managed signature preferences.', { status: response.status });
    return response.json();
}
