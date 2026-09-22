import express from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createAccessAuthenticator, createAdminAuthenticator, requireAnyRole, requireRole } from './auth.js';
import { HttpError } from './errors.js';
import { audit, cancelScheduledDeployment, deleteAudience, deleteStaffBulk, deleteTemplate, getDeploymentForStaff, getSignatureDeliveryCount, getStaffByEmail, listAudiences, listDeployments, listScheduledDeployments, listStaff, publishTemplate, recordSignatureDelivery, replaceRoles, saveAudience, scheduleTemplate, unpublishDeployment, updateDeploymentPriority, updateSelfPreferences, updateStaffFlags, updateStaffFlagsBulk, updateStaffProfilesBulk } from './db.js';
import { renderTemplate } from './template.js';
import { blockDirectoryStaff, getDirectorySettings, saveDirectorySettings, syncDirectoryUsers } from './entra.js';
import { compileMjml } from './mjml.js';
import { exportDatabase, importDatabase } from './database-transfer.js';
import { booleanField, integerId, requireObject, rolesField, safeTemplateHtml, stringField } from './validation.js';
import { deleteTagline, isTaglineKey, listTaglines, saveTagline, taglineForUser } from './taglines.js';
import { getManageSettings, saveManageSettings } from './manage-settings.js';
import { BUILT_IN_MERGE_TAGS, customMergeTagValues, deleteCustomMergeTag, listCustomMergeTags, saveCustomMergeTag } from './merge-tags.js';

function nullableOverride(body, field, max) {
  if (!Object.hasOwn(body, field)) return undefined;
  const value = body[field];
  if (value !== null && (typeof value !== 'string' || value.length > max)) {
    throw new HttpError(400, 'invalid_request', `${field} must be null or a string no longer than ${max} characters.`);
  }
  return value === null ? null : value.trim() || null;
}

function audienceMembers(body) {
  if (!Array.isArray(body.memberIds) || body.memberIds.length > 500) {
    throw new HttpError(400, 'invalid_request', 'memberIds must be an array containing no more than 500 staff IDs.');
  }
  const memberIds = body.memberIds.map((id) => integerId(id, 'memberId'));
  if (new Set(memberIds).size !== memberIds.length) throw new HttpError(400, 'invalid_request', 'memberIds must not contain duplicates.');
  return memberIds;
}

function deploymentPriority(value) {
  const priority = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(priority) || priority < 0 || priority > 1000) {
    throw new HttpError(400, 'invalid_request', 'priority must be an integer from 0 to 1000.');
  }
  return priority;
}

function futureDeploymentTime(value) {
  if (typeof value !== 'string' || value.length > 64) throw new HttpError(400, 'invalid_request', 'scheduledFor must be a valid date and time.');
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new HttpError(400, 'invalid_request', 'scheduledFor must be a valid date and time.');
  if (time <= Date.now()) throw new HttpError(400, 'schedule_not_future', 'Choose a deployment time in the future.');
  if (time > Date.now() + 5 * 365 * 24 * 60 * 60 * 1000) throw new HttpError(400, 'schedule_too_distant', 'Scheduled deployments must be within five years.');
  return new Date(time).toISOString();
}

function signatureIdentityMode(body) {
  const value = stringField(body, 'signatureIdentityMode', { max: 32 });
  if (value !== undefined && !['signed_in', 'mailbox'].includes(value)) {
    throw new HttpError(400, 'invalid_request', 'signatureIdentityMode must be signed_in or mailbox.');
  }
  return value;
}

export function createApp({ db, auth = {}, microsoftUserResolver, directoryProvider = null, protectedStaffEmails = [], publicRoot = path.resolve('.'), officeAddinRuntimeUrls = [], outlookConfig = {}, logger = console }) {
  const app = express();
  const protectedStaff = new Set(protectedStaffEmails.map((email) => String(email).toLowerCase()));
  const decorateStaff = (user) => ({ ...user, deletable: !protectedStaff.has(user.email.toLowerCase()) });
  const adminStaff = () => listStaff(db).map(decorateStaff);
  const publicBranding = () => { const settings = getManageSettings(db); return { organizationName: settings.organizationName, ...settings.organizationInfo }; };
  const renderSignature = (html, user) => renderTemplate(html, user, taglineForUser(db, user), getManageSettings(db), customMergeTagValues(db));
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  const outlookLog = (event, details = {}) => logger.info(`[outlook] ${JSON.stringify({ event, ...details })}`);
  app.use((req, res, next) => {
    const runtimeAssets = new Set([
      '/outlook-addin/runtime.html',
      '/outlook-addin/dist/runtime-entry.js',
      '/outlook-addin/dist/classic-runtime-entry.js',
    ]);
    if (!runtimeAssets.has(req.path)) return next();
    res.on('finish', () => outlookLog('runtime_asset', {
      path: req.path,
      status: res.statusCode,
      userAgent: String(req.get('user-agent') || '').slice(0, 240),
    }));
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/.well-known/microsoft-officeaddins-allowed.json', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ allowed: officeAddinRuntimeUrls });
  });
  app.get('/outlook-addin/config.js', (_req, res) => {
    res.type('application/javascript').set('Cache-Control', 'private, no-store');
    res.send(`globalThis.CORNERSTONE_SIGNATURES_CONFIG=${JSON.stringify({ clientId: outlookConfig.clientId || '', tenantId: outlookConfig.tenantId || '' })};`);
  });
  app.get('/outlook-addin/manifest.xml', (_req, res) => {
    const baseUrl = String(outlookConfig.publicBaseUrl || '').replace(/\/$/, '');
    const host = baseUrl ? new URL(baseUrl).host : '';
    const xmlEscape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
    const replacements = {
      PUBLIC_BASE_URL: baseUrl, PUBLIC_HOST: host, OUTLOOK_ADDIN_ID: outlookConfig.addinId,
      OUTLOOK_PROVIDER_NAME: outlookConfig.providerName, MICROSOFT_CLIENT_ID: outlookConfig.clientId,
    };
    let manifest = readFileSync(path.join(publicRoot, 'outlook-addin/manifest.template.xml'), 'utf8');
    for (const [name, value] of Object.entries(replacements)) manifest = manifest.replaceAll(`__${name}__`, xmlEscape(value));
    res.type('application/xml').set('Cache-Control', 'private, no-store').send(manifest);
  });
  app.get('/source', (_req, res, next) => outlookConfig.sourceCodeUrl ? res.redirect(302, outlookConfig.sourceCodeUrl) : next());
  app.get('/api/picker', createAccessAuthenticator(auth), (req, res) => {
    const staff = listStaff(db);
    const authenticatedUser = staff.find((user) => user.email.toLowerCase() === req.identity.email) || null;
    const users = staff.filter((user) => user.visible).map(({ roles: _roles, photo_data_url: _photo, ...user }) => user);
    const currentUser = users.find((user) => user.email.toLowerCase() === req.identity.email) || null;
    const canAccessAdmin = Boolean(authenticatedUser?.roles?.some((role) => ['it_admin', 'communications_editor'].includes(role)));
    res.set('Cache-Control', 'private, no-store');
    res.json({ identity: req.identity, currentUser, canAccessAdmin, taglineOptions: listTaglines(db), branding: publicBranding(), users });
  });
  app.patch('/api/picker/preferences', createAccessAuthenticator(auth), (req, res) => {
    const origin = req.get('origin');
    if (!origin || !auth.allowedOrigins?.includes(origin)) throw new HttpError(403, 'invalid_origin', 'This request origin is not allowed.');
    const body = requireObject(req.body);
    const changes = { selfOptedOut: booleanField(body, 'selfOptedOut') };
    changes.taglineKey = stringField(body, 'taglineKey', { max: 64 });
    if (changes.selfOptedOut === undefined && changes.taglineKey === undefined) {
      throw new HttpError(400, 'invalid_request', 'At least one preference is required.');
    }
    if (changes.taglineKey !== undefined && !isTaglineKey(db, changes.taglineKey)) {
      throw new HttpError(400, 'invalid_tagline', 'Choose one of the available organization taglines.');
    }
    const user = updateSelfPreferences(db, req.identity.email, changes);
    if (!user) throw new HttpError(404, 'not_found', 'Your managed staff record was not found.');
    res.set('Cache-Control', 'private, no-store');
    res.json({ currentUser: user });
  });
  app.get('/api/picker/signature', createAccessAuthenticator(auth), (req, res) => {
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
    if (!email || email.length > 320) throw new HttpError(400, 'invalid_request', 'A valid staff email is required.');
    const user = getStaffByEmail(db, email);
    if (!user || !user.visible) throw new HttpError(404, 'not_found', 'Visible staff member not found.');
    const deployment = getDeploymentForStaff(db, user.id);
    if (!deployment) throw new HttpError(409, 'no_published_signature', 'No signature has been published yet.');
    res.set('Cache-Control', 'private, no-store');
    res.json({
      html: renderSignature(deployment.html_snapshot, user),
      templateName: deployment.template_name,
      version: deployment.template_revision,
      deploymentId: deployment.id,
      audienceName: deployment.audience_name || 'All applicable staff',
      priority: deployment.priority,
    });
  });
  app.get('/api/outlook/signature', async (req, res, next) => {
    const diagnostic = typeof req.query.diagnostic === 'string' ? req.query.diagnostic.trim() : '';
    const diagnosticStages = new Set([
      'runtime_loaded',
      'event_received',
      'sender_read',
      'signature_set',
      'runtime_failed',
      'classic_runtime_loaded',
      'classic_event_received',
      'classic_sender_read',
      'classic_token_acquired',
      'classic_signature_set',
      'classic_runtime_failed',
    ]);
    if (diagnostic) {
      if (!diagnosticStages.has(diagnostic)) return next(new HttpError(400, 'invalid_request', 'Unknown Outlook diagnostic stage.'));
      outlookLog('runtime_diagnostic', {
        stage: diagnostic,
        detail: typeof req.query.detail === 'string' ? req.query.detail.slice(0, 160) : null,
        userAgent: String(req.get('user-agent') || '').slice(0, 240),
      });
      res.set('Cache-Control', 'private, no-store');
      return res.status(204).end();
    }
    if (req.query.preferences === '1') {
      try {
        const identity = await microsoftUserResolver(req);
        const user = getStaffByEmail(db, identity.email);
        res.set('Cache-Control', 'private, no-store');
        return res.json({
          available: Boolean(user && (user.can_self_opt_out || user.can_choose_tagline)),
          canSelfOptOut: Boolean(user?.can_self_opt_out),
          canChooseTagline: Boolean(user?.can_choose_tagline),
          url: '/',
        });
      } catch (error) {
        return next(error);
      }
    }
    const sender = typeof req.query.sender === 'string' ? req.query.sender.trim().toLowerCase() : '';
    outlookLog('signature_requested', {
      sender: sender || null,
      userAgent: String(req.get('user-agent') || '').slice(0, 240),
    });
    try {
      const identity = await microsoftUserResolver(req);
      if (sender.length > 320 || (sender && !sender.includes('@'))) {
        throw new HttpError(400, 'invalid_request', 'sender must be a valid email address.');
      }
      const senderUser = getStaffByEmail(db, sender || identity.email);
      res.set('Cache-Control', 'private, no-store');
      // Picker visibility is independent from Outlook delivery. Shared and
      // service mailboxes are commonly hidden from the public staff picker but
      // still need a managed signature when selected in the compose From field.
      if (!senderUser || !senderUser.signature_enabled) {
        outlookLog('signature_unavailable', { identity: identity.email, sender: sender || identity.email, reason: !senderUser ? 'staff_not_found' : 'disabled' });
        return res.status(204).end();
      }
      const deployment = getDeploymentForStaff(db, senderUser.id);
      if (!deployment) {
        outlookLog('signature_unavailable', { identity: identity.email, sender: senderUser.email, reason: 'no_deployment' });
        return res.status(204).end();
      }
      const useMailboxIdentity = senderUser.signature_identity_mode === 'mailbox';
      const signedInUser = getStaffByEmail(db, identity.email);
      const renderedUser = useMailboxIdentity ? senderUser : signedInUser;
      if (!renderedUser) {
        outlookLog('signature_unavailable', { identity: identity.email, sender: senderUser.email, reason: 'identity_staff_not_found' });
        return res.status(204).end();
      }
      outlookLog('signature_served', {
        identity: identity.email,
        sender: senderUser.email,
        renderedIdentity: renderedUser.email,
        identityMode: useMailboxIdentity ? 'mailbox' : 'signed_in',
        deploymentId: deployment.id,
        revision: deployment.template_revision,
      });
      try {
        recordSignatureDelivery(db);
      } catch (error) {
        outlookLog('signature_metric_failed', { detail: String(error?.message || error).slice(0, 160) });
      }
      res.json({
        html: renderSignature(deployment.html_snapshot, renderedUser),
        branding: publicBranding(),
        templateName: deployment.template_name,
        version: deployment.template_revision,
        user: { displayName: `${renderedUser.first_name} ${renderedUser.last_name}`.trim(), email: renderedUser.email },
        sender: { displayName: `${senderUser.first_name} ${senderUser.last_name}`.trim(), email: senderUser.email },
        signatureIdentityMode: useMailboxIdentity ? 'mailbox' : 'signed_in',
        deploymentId: deployment.id,
        revision: deployment.template_revision,
        audienceName: deployment.audience_name || 'All applicable staff',
        priority: deployment.priority,
      });
    } catch (error) {
      outlookLog('signature_failed', {
        sender: sender || null,
        status: error instanceof HttpError ? error.status : 500,
        code: error instanceof HttpError ? error.code : 'internal_error',
      });
      next(error);
    }
  });
  const admin = express.Router();
  admin.use(createAdminAuthenticator({ db, ...auth }));
  admin.use((req, _res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (!origin || !auth.allowedOrigins?.includes(origin)) return next(new HttpError(403, 'invalid_origin', 'This request origin is not allowed.'));
    next();
  });
  admin.get('/session', (req, res) => {
    const staff = getStaffByEmail(db, req.admin.email);
    res.json({
      ...req.admin,
      branding: publicBranding(),
      user: staff ? {
        email: staff.email,
        first_name: staff.first_name,
        last_name: staff.last_name,
        displayName: `${staff.first_name} ${staff.last_name}`.trim(),
        title: staff.title,
        photo_data_url: staff.photo_data_url,
      } : { email: req.admin.email },
    });
  });
  admin.get('/dashboard', (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json({ signaturesSigned: getSignatureDeliveryCount(db) });
  });
  admin.get('/users', (_req, res) => res.json({ users: adminStaff() }));
  admin.get('/users/:id/signature-preview', (req, res) => {
    const id = integerId(req.params.id);
    const user = listStaff(db).find((person) => person.id === id);
    if (!user) throw new HttpError(404, 'not_found', 'Staff member not found.');
    const deployment = getDeploymentForStaff(db, user.id);
    const draft = deployment ? null : db.prepare('SELECT * FROM signature_templates WHERE deleted_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT 1').get();
    const html = deployment?.html_snapshot ?? draft?.html;
    if (!html) throw new HttpError(404, 'not_found', 'No signature template is available to preview.');
    res.set('Cache-Control', 'private, no-store');
    res.json({
      html: renderSignature(html, user),
      templateName: deployment?.template_name ?? draft.name,
      revision: deployment?.template_revision ?? draft.revision,
      source: deployment ? 'published' : 'draft',
      audienceName: deployment?.audience_name || (deployment ? 'All applicable staff' : null),
      priority: deployment?.priority ?? null,
      user: { displayName: `${user.first_name} ${user.last_name}`.trim(), email: user.email },
    });
  });
  admin.get('/directory-sync', requireRole('it_admin'), (_req, res) => {
    res.json({ ...getDirectorySettings(db), configured: Boolean(directoryProvider) });
  });
  admin.put('/directory-sync', requireRole('it_admin'), (req, res) => {
    res.json({ ...saveDirectorySettings(db, requireObject(req.body).filters, req.admin.email), configured: Boolean(directoryProvider) });
  });
  admin.post('/directory-sync/run', requireRole('it_admin'), async (req, res, next) => {
    try {
      if (!directoryProvider) throw new HttpError(503, 'directory_sync_not_configured', 'Entra directory sync credentials are not configured.');
      const filters = getDirectorySettings(db).filters;
      const users = await directoryProvider(filters);
      const result = syncDirectoryUsers(db, users, filters, req.admin.email, getManageSettings(db).directoryDefaults);
      res.json({ result, users: adminStaff() });
    } catch (error) { next(error); }
  });
  admin.get('/manage-settings', requireRole('it_admin'), (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json({ ...getManageSettings(db), directoryConfigured: Boolean(directoryProvider) });
  });
  admin.put('/manage-settings', requireRole('it_admin'), (req, res) => {
    const body = requireObject(req.body);
    if (body.directorySchedule?.enabled && !directoryProvider) {
      throw new HttpError(503, 'directory_sync_not_configured', 'Configure Microsoft Graph credentials before enabling scheduled synchronization.');
    }
    res.json({ ...saveManageSettings(db, body, req.admin.email), directoryConfigured: Boolean(directoryProvider) });
  });
  admin.patch('/users', requireRole('it_admin'), (req, res) => {
    const body = requireObject(req.body);
    if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 500) {
      throw new HttpError(400, 'invalid_request', 'ids must be an array containing between 1 and 500 staff IDs.');
    }
    const ids = [...new Set(body.ids.map((id) => integerId(id)))];
    if (ids.length !== body.ids.length) throw new HttpError(400, 'invalid_request', 'ids must not contain duplicates.');
    const changes = {
      visible: booleanField(body, 'visible'),
      applicable: booleanField(body, 'applicable'),
      canSelfOptOut: booleanField(body, 'canSelfOptOut'),
      canChooseTagline: booleanField(body, 'canChooseTagline'),
      signatureIdentityMode: signatureIdentityMode(body),
    };
    if (Object.values(changes).every((value) => value === undefined)) {
      throw new HttpError(400, 'invalid_request', 'At least one supported field is required.');
    }
    const users = updateStaffFlagsBulk(db, ids, changes, req.admin.email);
    if (!users) throw new HttpError(404, 'not_found', 'One or more staff members were not found.');
    res.json({ users: users.map(decorateStaff) });
  });
  admin.delete('/users', requireRole('it_admin'), (req, res) => {
    const body = requireObject(req.body);
    if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 500) {
      throw new HttpError(400, 'invalid_request', 'ids must be an array containing between 1 and 500 staff IDs.');
    }
    const ids = [...new Set(body.ids.map((id) => integerId(id)))];
    if (ids.length !== body.ids.length) throw new HttpError(400, 'invalid_request', 'ids must not contain duplicates.');
    const deleted = deleteStaffBulk(db, ids, req.admin.email, protectedStaffEmails);
    if (!deleted) throw new HttpError(404, 'not_found', 'One or more staff members were not found.');
    res.json({ deleted: deleted.length });
  });
  admin.post('/users/:id/block', requireRole('it_admin'), (req, res) => {
    const blocked = blockDirectoryStaff(db, integerId(req.params.id), req.admin.email, protectedStaffEmails);
    if (!blocked) throw new HttpError(404, 'not_found', 'Staff member not found.');
    res.json({ blocked: { id: blocked.staff.id, email: blocked.staff.email }, filters: blocked.filters });
  });
  admin.patch('/users/profiles', requireRole('it_admin'), (req, res) => {
    const body = requireObject(req.body);
    if (!Array.isArray(body.profiles) || body.profiles.length < 1 || body.profiles.length > 500) {
      throw new HttpError(400, 'invalid_request', 'profiles must be an array containing between 1 and 500 staff profiles.');
    }
    const profiles = body.profiles.map((value) => {
      const profile = requireObject(value);
      return {
        id: integerId(profile.id),
        titleOverride: nullableOverride(profile, 'titleOverride', 200),
        officeLocationOverride: nullableOverride(profile, 'officeLocationOverride', 200),
        phoneOverride: nullableOverride(profile, 'phoneOverride', 100),
      };
    });
    if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new HttpError(400, 'invalid_request', 'profiles must not contain duplicate staff IDs.');
    if (profiles.some((profile) => profile.titleOverride === undefined || profile.officeLocationOverride === undefined || profile.phoneOverride === undefined)) {
      throw new HttpError(400, 'invalid_request', 'Each profile must include titleOverride, officeLocationOverride, and phoneOverride.');
    }
    const users = updateStaffProfilesBulk(db, profiles, req.admin.email);
    if (!users) throw new HttpError(404, 'not_found', 'One or more staff members were not found.');
    res.json({ users: users.map(decorateStaff) });
  });
  admin.patch('/users/:id', requireRole('it_admin'), (req, res) => {
    const id = integerId(req.params.id);
    const body = requireObject(req.body);
    const changes = {
      visible: booleanField(body, 'visible'),
      applicable: booleanField(body, 'applicable'),
      canSelfOptOut: booleanField(body, 'canSelfOptOut'),
      canChooseTagline: booleanField(body, 'canChooseTagline'),
      signatureIdentityMode: signatureIdentityMode(body),
    };
    changes.titleOverride = nullableOverride(body, 'titleOverride', 200);
    changes.officeLocationOverride = nullableOverride(body, 'officeLocationOverride', 200);
    changes.phoneOverride = nullableOverride(body, 'phoneOverride', 100);
    if (Object.values(changes).every((value) => value === undefined)) throw new HttpError(400, 'invalid_request', 'At least one supported field is required.');
    const user = updateStaffFlags(db, id, changes, req.admin.email);
    if (!user) throw new HttpError(404, 'not_found', 'Staff member not found.');
    res.json({ user: decorateStaff({ ...user, visible: Boolean(user.visible), applicable: Boolean(user.applicable) }) });
  });
  admin.put('/users/:id/roles', requireRole('it_admin'), (req, res) => {
    const id = integerId(req.params.id);
    const roles = rolesField(requireObject(req.body));
    const updated = replaceRoles(db, id, roles, req.admin.email);
    if (!updated) throw new HttpError(404, 'not_found', 'Staff member not found.');
    res.json({ roles: updated });
  });
  admin.get('/audiences', (_req, res) => res.json({ audiences: listAudiences(db) }));
  admin.post('/audiences', requireAnyRole('it_admin', 'communications_editor'), (req, res) => {
    const body = requireObject(req.body);
    const name = stringField(body, 'name', { required: true, max: 100 });
    const description = stringField(body, 'description', { max: 500 }) ?? '';
    const memberIds = audienceMembers(body);
    if (db.prepare('SELECT 1 FROM audiences WHERE name=? COLLATE NOCASE').get(name)) throw new HttpError(409, 'audience_name_exists', 'An audience with that name already exists.');
    const audience = saveAudience(db, { name, description, memberIds }, req.admin.email);
    if (!audience) throw new HttpError(404, 'not_found', 'One or more staff members were not found.');
    res.status(201).json({ audience });
  });
  admin.put('/audiences/:id', requireAnyRole('it_admin', 'communications_editor'), (req, res) => {
    const id = integerId(req.params.id);
    const body = requireObject(req.body);
    const name = stringField(body, 'name', { required: true, max: 100 });
    const description = stringField(body, 'description', { max: 500 }) ?? '';
    const memberIds = audienceMembers(body);
    if (db.prepare('SELECT 1 FROM audiences WHERE name=? COLLATE NOCASE AND id<>?').get(name, id)) throw new HttpError(409, 'audience_name_exists', 'An audience with that name already exists.');
    const audience = saveAudience(db, { id, name, description, memberIds }, req.admin.email);
    if (!audience) throw new HttpError(404, 'not_found', 'Audience or one of its staff members was not found.');
    res.json({ audience });
  });
  admin.delete('/audiences/:id', requireAnyRole('it_admin', 'communications_editor'), (req, res) => {
    const deleted = deleteAudience(db, integerId(req.params.id), req.admin.email);
    if (!deleted) throw new HttpError(404, 'not_found', 'Audience not found.');
    res.json({ deleted: true });
  });
  admin.get('/taglines', (_req, res) => res.json({ taglines: listTaglines(db) }));
  admin.post('/taglines', requireRole('communications_editor'), (req, res) => {
    const body = requireObject(req.body);
    const label = stringField(body, 'label', { required: true, max: 240 });
    const isDefault = booleanField(body, 'isDefault') ?? false;
    const tagline = saveTagline(db, { label, isDefault }, req.admin.email);
    res.status(201).json({ tagline });
  });
  admin.put('/taglines/:id', requireRole('communications_editor'), (req, res) => {
    const body = requireObject(req.body);
    const id = integerId(req.params.id);
    const label = stringField(body, 'label', { required: true, max: 240 });
    const isDefault = booleanField(body, 'isDefault');
    if (isDefault === undefined) throw new HttpError(400, 'invalid_request', 'isDefault is required.');
    const tagline = saveTagline(db, { id, label, isDefault }, req.admin.email);
    if (!tagline) throw new HttpError(404, 'not_found', 'Tagline not found.');
    res.json({ tagline });
  });
  admin.delete('/taglines/:id', requireRole('communications_editor'), (req, res) => {
    const deleted = deleteTagline(db, integerId(req.params.id), req.admin.email);
    if (!deleted) throw new HttpError(404, 'not_found', 'Tagline not found.');
    res.json({ deleted: true, reassigned: deleted.reassigned });
  });
  admin.get('/merge-tags', (_req, res) => res.json({ builtIns: BUILT_IN_MERGE_TAGS, customTags: listCustomMergeTags(db) }));
  admin.post('/merge-tags', requireRole('communications_editor'), (req, res) => {
    const body = requireObject(req.body);
    const tag = saveCustomMergeTag(db, {
      key: stringField(body, 'key', { required: true, max: 64 }),
      value: stringField(body, 'value', { max: 10000 }) ?? '',
      description: stringField(body, 'description', { max: 240 }) ?? '',
    }, req.admin.email);
    res.status(201).json({ tag });
  });
  admin.put('/merge-tags/:key', requireRole('communications_editor'), (req, res) => {
    const body = requireObject(req.body);
    const tag = saveCustomMergeTag(db, {
      originalKey: req.params.key,
      key: stringField(body, 'key', { required: true, max: 64 }),
      value: stringField(body, 'value', { max: 10000 }) ?? '',
      description: stringField(body, 'description', { max: 240 }) ?? '',
    }, req.admin.email);
    if (!tag) throw new HttpError(404, 'not_found', 'Custom merge tag not found.');
    res.json({ tag });
  });
  admin.delete('/merge-tags/:key', requireRole('communications_editor'), (req, res) => {
    const tag = deleteCustomMergeTag(db, req.params.key, req.admin.email);
    if (!tag) throw new HttpError(404, 'not_found', 'Custom merge tag not found.');
    res.json({ deleted: true });
  });
  admin.get('/templates', (_req, res) => res.json({ templates: db.prepare(`SELECT t.*,
    CASE WHEN t.id=(SELECT MIN(id) FROM signature_templates) THEN 0 ELSE 1 END AS deletable,
    EXISTS(SELECT 1 FROM deployments d WHERE d.template_id=t.id AND d.status='published') AS actively_deployed,
    EXISTS(SELECT 1 FROM scheduled_deployments s WHERE s.template_id=t.id AND s.status='scheduled') AS pending_schedule
    FROM signature_templates t WHERE t.deleted_at IS NULL ORDER BY t.updated_at DESC,t.id DESC`).all().map((template) => ({ ...template, deletable: Boolean(template.deletable), actively_deployed: Boolean(template.actively_deployed), pending_schedule: Boolean(template.pending_schedule) })) }));
  admin.post('/templates', requireRole('communications_editor'), async (req, res) => {
    const body = requireObject(req.body);
    const name = stringField(body, 'name', { required: true, max: 100 });
    const sourceMjml = stringField(body, 'mjml', { max: 200000 });
    const suppliedHtml = stringField(body, 'html', { max: 200000 });
    if (sourceMjml === undefined && suppliedHtml === undefined) throw new HttpError(400, 'invalid_request', 'Either mjml or html is required.');
    const html = sourceMjml === undefined ? safeTemplateHtml(suppliedHtml) : await compileMjml(sourceMjml);
    const result = db.prepare('INSERT INTO signature_templates(name,html,source_mjml,created_by,updated_by) VALUES (?,?,?,?,?)').run(name, html, sourceMjml ?? null, req.admin.email, req.admin.email);
    audit(db, req.admin.email, 'template.created', 'template', result.lastInsertRowid, { name, format: sourceMjml === undefined ? 'html' : 'mjml' });
    res.status(201).json({ template: db.prepare('SELECT * FROM signature_templates WHERE id=?').get(result.lastInsertRowid) });
  });
  admin.put('/templates/:id', requireRole('communications_editor'), async (req, res) => {
    const id = integerId(req.params.id);
    const body = requireObject(req.body);
    const current = db.prepare('SELECT * FROM signature_templates WHERE id=? AND deleted_at IS NULL').get(id);
    if (!current) throw new HttpError(404, 'not_found', 'Template not found.');
    const name = stringField(body, 'name', { max: 100 }) ?? current.name;
    const sourceMjml = stringField(body, 'mjml', { max: 200000 });
    const suppliedHtml = stringField(body, 'html', { max: 200000 });
    const html = sourceMjml !== undefined ? await compileMjml(sourceMjml) : suppliedHtml === undefined ? current.html : safeTemplateHtml(suppliedHtml);
    const nextSourceMjml = sourceMjml !== undefined ? sourceMjml : suppliedHtml !== undefined ? null : current.source_mjml;
    db.prepare('UPDATE signature_templates SET name=?,html=?,source_mjml=?,revision=revision+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, html, nextSourceMjml, req.admin.email, id);
    audit(db, req.admin.email, 'template.updated', 'template', id, { revision: current.revision + 1, format: nextSourceMjml ? 'mjml' : 'html' });
    res.json({ template: db.prepare('SELECT * FROM signature_templates WHERE id=?').get(id) });
  });
  admin.post('/templates/:id/duplicate', requireRole('communications_editor'), (req, res) => {
    const id = integerId(req.params.id);
    const current = db.prepare('SELECT * FROM signature_templates WHERE id=? AND deleted_at IS NULL').get(id);
    if (!current) throw new HttpError(404, 'not_found', 'Template not found.');
    let sequence = 1;
    let name;
    do {
      const suffix = sequence === 1 ? ' copy' : ` copy ${sequence}`;
      name = `${current.name.slice(0, 100 - suffix.length)}${suffix}`;
      sequence += 1;
    } while (db.prepare('SELECT 1 FROM signature_templates WHERE name=? COLLATE NOCASE AND deleted_at IS NULL').get(name));
    const result = db.prepare('INSERT INTO signature_templates(name,html,source_mjml,created_by,updated_by) VALUES (?,?,?,?,?)')
      .run(name, current.html, current.source_mjml, req.admin.email, req.admin.email);
    audit(db, req.admin.email, 'template.duplicated', 'template', result.lastInsertRowid, { sourceTemplateId: current.id, sourceRevision: current.revision, name });
    res.status(201).json({ template: db.prepare('SELECT * FROM signature_templates WHERE id=?').get(result.lastInsertRowid) });
  });
  admin.delete('/templates/:id', requireRole('communications_editor'), (req, res) => {
    const deleted = deleteTemplate(db, integerId(req.params.id), req.admin.email);
    if (!deleted) throw new HttpError(404, 'not_found', 'Template not found.');
    res.status(204).end();
  });
  admin.post('/templates/:id/publish', requireRole('communications_editor'), (req, res) => {
    const body = req.body === undefined ? {} : requireObject(req.body);
    const audienceId = body.audienceId == null ? null : integerId(body.audienceId, 'audienceId');
    const priority = deploymentPriority(body.priority);
    const deployment = publishTemplate(db, integerId(req.params.id), req.admin.email, { audienceId, priority });
    if (deployment === null) throw new HttpError(404, 'not_found', 'Template not found.');
    if (deployment === undefined) throw new HttpError(404, 'not_found', 'Audience not found.');
    res.status(201).json({ deployment });
  });
  admin.post('/templates/:id/schedule', requireRole('communications_editor'), (req, res) => {
    const body = requireObject(req.body);
    const audienceId = body.audienceId == null ? null : integerId(body.audienceId, 'audienceId');
    const scheduled = scheduleTemplate(db, integerId(req.params.id), req.admin.email, {
      audienceId,
      priority: deploymentPriority(body.priority),
      scheduledFor: futureDeploymentTime(body.scheduledFor),
    });
    if (scheduled === null) throw new HttpError(404, 'not_found', 'Template not found.');
    if (scheduled === undefined) throw new HttpError(404, 'not_found', 'Audience not found.');
    res.status(201).json({ scheduled });
  });
  admin.get('/deployments', (_req, res) => res.json({ deployments: listDeployments(db), scheduled: listScheduledDeployments(db) }));
  admin.patch('/deployments/:id', requireRole('communications_editor'), (req, res) => {
    const body = requireObject(req.body);
    if (!Object.hasOwn(body, 'priority')) throw new HttpError(400, 'invalid_request', 'priority is required.');
    const deployment = updateDeploymentPriority(db, integerId(req.params.id), deploymentPriority(body.priority), req.admin.email);
    if (!deployment) throw new HttpError(404, 'not_found', 'Deployment not found.');
    res.json({ deployment });
  });
  admin.post('/deployments/:id/unpublish', requireRole('communications_editor'), (req, res) => {
    const id = integerId(req.params.id);
    const current = db.prepare('SELECT * FROM deployments WHERE id=?').get(id);
    if (!current) throw new HttpError(404, 'not_found', 'Deployment not found.');
    const body = req.body === undefined ? {} : requireObject(req.body);
    if (current.audience_id == null && stringField(body, 'confirmation', { max: 32 }) !== 'UNPUBLISH') {
      throw new HttpError(400, 'confirmation_required', 'Type UNPUBLISH to deactivate the all-staff signature.');
    }
    const deployment = unpublishDeployment(db, id, req.admin.email);
    res.json({ deployment });
  });
  admin.post('/scheduled-deployments/:id/cancel', requireRole('communications_editor'), (req, res) => {
    const scheduled = cancelScheduledDeployment(db, integerId(req.params.id), req.admin.email);
    if (!scheduled) throw new HttpError(404, 'not_found', 'Scheduled deployment not found.');
    res.json({ scheduled });
  });
  admin.get('/audit', requireRole('it_admin'), (req, res) => {
    const limit = Math.max(1, Math.min(Math.floor(Number(req.query.limit) || 100), 500));
    res.json({ events: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) });
  });
  admin.get('/database/export', requireRole('it_admin'), async (req, res, next) => {
    try {
      const snapshot = await exportDatabase(db);
      audit(db, req.admin.email, 'database.exported', 'database', 'main', { bytes: snapshot.length });
      const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Disposition': `attachment; filename="siggen-backup-${stamp}.sqlite"`,
        'Content-Length': String(snapshot.length),
      });
      res.send(snapshot);
    } catch (error) { next(error); }
  });
  admin.post('/database/import', requireRole('it_admin'), express.raw({ type: ['application/vnd.sqlite3', 'application/x-sqlite3', 'application/octet-stream'], limit: '100mb' }), (req, res) => {
    const counts = importDatabase(db, req.body, req.admin.email);
    res.json({ restored: true, counts });
  });
  app.use('/api/admin', admin);

  app.use('/static', express.static(path.join(publicRoot, 'static')));
  app.use('/vendor/grapesjs', express.static(path.resolve('node_modules/grapesjs/dist'), { immutable: true, maxAge: '1y' }));
  app.use('/vendor/grapesjs-mjml', express.static(path.resolve('node_modules/grapesjs-mjml/dist'), { immutable: true, maxAge: '1y' }));
  app.use('/outlook-addin', express.static(path.join(publicRoot, 'outlook-addin'), {
    setHeaders: (res) => res.set('Cache-Control', 'private, no-store'),
  }));
  app.use('/admin', express.static(path.join(publicRoot, 'admin'), {
    index: 'index.html',
    setHeaders: (res) => res.set('Cache-Control', 'private, no-store'),
  }));
  app.get('/', (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(path.join(publicRoot, 'index.html'));
  });

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Route not found.')));
  app.use((error, _req, res, _next) => {
    const status = error instanceof HttpError ? error.status
      : error.type === 'entity.too.large' ? 413
        : error.type === 'entity.parse.failed' ? 400
          : 500;
    if (status === 500) console.error(error);
    const code = error instanceof HttpError ? error.code : status === 413 ? 'payload_too_large' : status === 400 ? 'invalid_json' : 'internal_error';
    const message = error instanceof HttpError ? error.message : status === 500 ? 'An unexpected error occurred.' : status === 413 ? 'The request body is too large.' : 'The JSON request body is invalid.';
    res.status(status).json({ error: { code, message, ...(error.details && { details: error.details }) } });
  });
  return app;
}
