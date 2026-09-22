import { getManagedPreferences, getManagedSignature, ManagedSignatureError } from './managed-signature.js';

function setStatus(message, type = '') {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
}

function getSenderEmail() {
    return new Promise((resolve, reject) => {
        const from = Office.context.mailbox.item.from;
        if (!from?.getAsync) {
            resolve('');
            return;
        }
        from.getAsync((result) => {
            if (result.status === Office.AsyncResultStatus.Failed) {
                reject(result.error);
                return;
            }
            resolve(String(result.value?.emailAddress || '').trim().toLowerCase());
        });
    });
}

function applyToCurrentMessage(html) {
    return new Promise((resolve, reject) => {
        Office.context.mailbox.item.body.setSignatureAsync(
            html,
            { coercionType: Office.CoercionType.Html },
            (result) => result.status === Office.AsyncResultStatus.Failed ? reject(result.error) : resolve()
        );
    });
}

async function connect() {
    const button = document.getElementById('connect');
    button.disabled = true;
    setStatus('Connecting to Microsoft 365…');

    try {
        const senderEmail = await getSenderEmail();
        const managedSignature = await getManagedSignature({ interactive: true, senderEmail });
        const managedPreferences = await getManagedPreferences({ interactive: true });
        const preview = document.getElementById('preview');
        const preferences = document.getElementById('preferences');
        preferences.hidden = !managedPreferences.available;

        if (!managedSignature) {
            preview.replaceChildren();
            preview.hidden = true;
            setStatus(
                'Connected. The selected From address does not currently have an active managed signature.',
                'unavailable'
            );
            button.textContent = 'Check again';
            return;
        }

        const organizationName = managedSignature.branding?.organizationName;
        if (organizationName) {
            document.title = `${organizationName} Signatures`;
            document.getElementById('appDescription').textContent = `Preview or reapply the signature currently assigned by ${organizationName}.`;
        }

        preview.innerHTML = managedSignature.html;
        preview.hidden = false;
        await applyToCurrentMessage(managedSignature.html);

        const userName = typeof managedSignature.user === 'string'
            ? managedSignature.user
            : managedSignature.user?.displayName || managedSignature.user?.email || '';
        const details = [managedSignature.templateName, managedSignature.version && `version ${managedSignature.version}`]
            .filter(Boolean)
            .join(', ');
        const identity = userName ? ` as ${userName}` : '';
        const deployment = details ? ` Active deployment: ${details}.` : ' Your managed signature is active.';

        setStatus(`Signature refreshed in this message. Connected${identity}.${deployment}`, 'success');
        button.textContent = 'Refresh signature';
    } catch (error) {
        console.error('Microsoft 365 connection failed.', error);
        const message = error instanceof ManagedSignatureError
            ? 'Connected to Microsoft 365, but Cornerstone Signatures could not load your managed signature. Contact IT if this continues.'
            : 'Could not refresh the signature in this message. Check your account and try again.';
        setStatus(message, 'error');
    } finally {
        button.disabled = false;
    }
}

Office.onReady(() => {
    document.getElementById('connect').addEventListener('click', connect);
    setStatus('Connect once so Outlook can retrieve your assigned signature.');
});
