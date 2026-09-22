import { isInteractionRequired } from './graph-profile.js';
import { getManagedSignature, ManagedSignatureError } from './managed-signature.js';

Office.onReady();

function report(stage, detail = '') {
    try {
        const query = new URLSearchParams({ diagnostic: stage });
        if (detail) query.set('detail', String(detail).slice(0, 160));
        fetch(`/api/outlook/signature?${query}`, { method: 'GET', cache: 'no-store', keepalive: true }).catch(() => {});
    } catch {
        // Diagnostics must never interfere with signature insertion.
    }
}

report('runtime_loaded');

function finish(event) {
    try {
        event.completed();
    } catch (error) {
        console.error('Could not complete the Outlook launch event.', error);
    }
}

function notify(key, message, callback) {
    const notifications = Office.context.mailbox.item.notificationMessages;
    if (!notifications) {
        callback();
        return;
    }

    notifications.addAsync(key, {
        type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
        message,
        icon: 'none',
        persistent: false
    }, callback);
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

function setSignature(html, event) {
    Office.context.mailbox.item.body.setSignatureAsync(
        html,
        { coercionType: Office.CoercionType.Html },
        (result) => {
            if (result.status === Office.AsyncResultStatus.Failed) {
                report('runtime_failed', `setSignatureAsync:${result.error?.code || result.error?.message || 'unknown'}`);
                console.error('Could not set the managed signature.', result.error);
                notify('cornerstone-signature-error', 'Cornerstone Signatures could not add your signature.', () => finish(event));
                return;
            }

            report('signature_set');
            finish(event);
        }
    );
}

async function applySignatureForCurrentSender(event, { clearWhenUnavailable = false } = {}) {
    report('event_received', clearWhenUnavailable ? 'from_changed' : 'new_compose');
    try {
        const senderEmail = await getSenderEmail();
        report('sender_read', senderEmail || 'empty');
        const managedSignature = await getManagedSignature({ senderEmail });

        // A From change must remove the signature belonging to the previously
        // selected account. On initial compose, leave an unmanaged signature alone.
        if (!managedSignature) {
            if (clearWhenUnavailable) setSignature('', event);
            else finish(event);
            return;
        }

        setSignature(managedSignature.html, event);
    } catch (error) {
        report('runtime_failed', `${error?.name || 'Error'}:${error?.errorCode || error?.code || error?.message || 'unknown'}`);
        console.error('Managed signature insertion failed.', error);

        if (isInteractionRequired(error)) {
            notify(
                'cornerstone-signature-connect',
                'Open Signature settings once to connect your Microsoft 365 account.',
                () => finish(event)
            );
            return;
        }

        const message = error instanceof ManagedSignatureError && error.status === 403
            ? 'Your managed signature is currently unavailable. Contact IT if this continues.'
            : 'Cornerstone Signatures could not retrieve your managed signature. Try again or contact IT.';
        notify(
            'cornerstone-signature-error',
            message,
            () => finish(event)
        );
    }
}

function applyCornerstoneSignature(event) {
    return applySignatureForCurrentSender(event);
}

function refreshCornerstoneSignature(event) {
    return applySignatureForCurrentSender(event, { clearWhenUnavailable: true });
}

Office.actions.associate('applyCornerstoneSignature', applyCornerstoneSignature);
Office.actions.associate('refreshCornerstoneSignature', refreshCornerstoneSignature);
