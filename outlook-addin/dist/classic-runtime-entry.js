/*
 * Classic Outlook runs launch events in a JavaScript-only runtime. Keep this
 * file deliberately compatible with ECMAScript 2016 and older Outlook builds.
 * It is copied verbatim to dist by scripts/build-classic-runtime.js.
 */
(function () {
    'use strict';

    var SIGNATURE_URL = '/api/outlook/signature';

    function report(stage, detail) {
        var url = SIGNATURE_URL + '?diagnostic=' + encodeURIComponent(stage);
        if (detail) {
            url += '&detail=' + encodeURIComponent(String(detail).slice(0, 160));
        }

        try {
            fetch(url, { method: 'GET', cache: 'no-store' }).catch(function () {});
        } catch (error) {
            // Diagnostics must never interfere with signature insertion.
        }
    }

    function finish(event) {
        try {
            event.completed();
        } catch (error) {
            report('classic_runtime_failed', 'event_completed');
        }
    }

    function notify(key, message, event) {
        var notifications = Office.context.mailbox.item.notificationMessages;
        if (!notifications) {
            finish(event);
            return;
        }

        notifications.addAsync(key, {
            type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
            message: message,
            icon: 'none',
            persistent: false
        }, function () {
            finish(event);
        });
    }

    function errorDetail(error) {
        if (!error) return 'unknown';
        if (error.code) return String(error.code);
        if (error.name) return String(error.name);
        if (error.message) return String(error.message);
        return 'unknown';
    }

    function getSenderEmail(callback) {
        var from = Office.context.mailbox.item.from;
        if (!from || !from.getAsync) {
            callback(null, '');
            return;
        }

        from.getAsync(function (result) {
            if (result.status === Office.AsyncResultStatus.Failed) {
                callback(result.error);
                return;
            }

            var address = '';
            if (result.value && result.value.emailAddress) {
                address = String(result.value.emailAddress).trim().toLowerCase();
            }
            callback(null, address);
        });
    }

    function setSignature(html, event) {
        Office.context.mailbox.item.body.setSignatureAsync(
            html,
            { coercionType: Office.CoercionType.Html },
            function (result) {
                if (result.status === Office.AsyncResultStatus.Failed) {
                    report('classic_runtime_failed', 'setSignatureAsync:' + errorDetail(result.error));
                    notify('cornerstone-signature-error', 'Cornerstone Signatures could not add your signature.', event);
                    return;
                }

                report('classic_signature_set');
                finish(event);
            }
        );
    }

    function requestSignature(token, senderEmail, event, clearWhenUnavailable) {
        var url = SIGNATURE_URL;
        if (senderEmail) {
            url += '?sender=' + encodeURIComponent(senderEmail);
        }

        fetch(url, {
            method: 'GET',
            cache: 'no-store',
            headers: {
                Accept: 'application/json',
                Authorization: 'Bearer ' + token
            }
        }).then(function (response) {
            if (response.status === 204) {
                if (clearWhenUnavailable) {
                    setSignature('', event);
                    return null;
                }
                finish(event);
                return null;
            }

            if (!response.ok) {
                throw new Error('signature_http_' + response.status);
            }
            return response.json();
        }).then(function (body) {
            if (!body) return;
            if (typeof body.html !== 'string' || !body.html.trim()) {
                throw new Error('invalid_signature_response');
            }
            setSignature(body.html, event);
        }).catch(function (error) {
            report('classic_runtime_failed', errorDetail(error));
            notify(
                'cornerstone-signature-error',
                'Cornerstone Signatures could not retrieve your managed signature. Try again or contact IT.',
                event
            );
        });
    }

    function applySignatureForCurrentSender(event, clearWhenUnavailable) {
        var eventName = 'new_compose';
        if (clearWhenUnavailable) eventName = 'from_changed';
        report('classic_event_received', eventName);

        getSenderEmail(function (senderError, senderEmail) {
            if (senderError) {
                report('classic_runtime_failed', 'sender:' + errorDetail(senderError));
                finish(event);
                return;
            }

            report('classic_sender_read', senderEmail || 'empty');
            OfficeRuntime.auth.getAccessToken({
                allowSignInPrompt: false,
                allowConsentPrompt: false
            }).then(function (token) {
                report('classic_token_acquired');
                requestSignature(token, senderEmail, event, clearWhenUnavailable);
            }).catch(function (error) {
                report('classic_runtime_failed', 'auth:' + errorDetail(error));
                notify(
                    'cornerstone-signature-connect',
                    'Cornerstone Signatures could not connect your Microsoft 365 account. Open Signature settings or contact IT.',
                    event
                );
            });
        });
    }

    function applyCornerstoneSignature(event) {
        applySignatureForCurrentSender(event, false);
    }

    function refreshCornerstoneSignature(event) {
        applySignatureForCurrentSender(event, true);
    }

    report('classic_runtime_loaded');
    Office.actions.associate('applyCornerstoneSignature', applyCornerstoneSignature);
    Office.actions.associate('refreshCornerstoneSignature', refreshCornerstoneSignature);
}());
