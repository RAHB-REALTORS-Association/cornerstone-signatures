import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../../server/app.js';
import { openDatabase, runDueScheduledDeployments } from '../../server/db.js';
import { renderTemplate } from '../../server/template.js';
import { safeTemplateHtml } from '../../server/validation.js';
import { compileMjml } from '../../server/mjml.js';
import { createGraphDirectoryProvider } from '../../server/entra.js';
import { saveManageSettings } from '../../server/manage-settings.js';
import { runScheduledDirectorySync } from '../../server/directory-scheduler.js';

describe('Cornerstone Signatures backend', () => {
  let db;
  let server;
  let baseUrl;
  let directoryUsers;

  before(async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'siggen-test-'));
    db = openDatabase(':memory:');
    const add = db.prepare(`INSERT INTO staff(email,first_name,last_name,title,phone) VALUES (?,?,?,?,?)`);
    const admin = add.run('admin@example.com', 'Ada', 'Admin', 'IT', '1').lastInsertRowid;
    const editor = add.run('editor@example.com', 'Cora', 'Editor', 'Comms', '2').lastInsertRowid;
    add.run('person@example.com', 'Pat', '<Person>', 'Agent & Advisor', '555').lastInsertRowid;
    db.prepare(`INSERT INTO role_grants(staff_id,role,granted_by) VALUES (?,'it_admin','test')`).run(admin);
    db.prepare(`INSERT INTO role_grants(staff_id,role,granted_by) VALUES (?,'communications_editor','test')`).run(admin);
    db.prepare(`INSERT INTO role_grants(staff_id,role,granted_by) VALUES (?,'communications_editor','test')`).run(editor);
    const addTagline = db.prepare(`INSERT INTO taglines(key,label,sort_order,is_default,created_by,updated_by) VALUES (?,?,?,?,?,?)`);
    for (const [index, key] of ['proudly-different','in-your-corner','better-together','forward-thinking','people-first'].entries()) {
      addTagline.run(key, `Approved phrase ${index + 1}`, index, Number(index === 0), 'test', 'test');
    }

    directoryUsers = [
      { id: 'entra-jane', accountEnabled: true, userType: 'Member', givenName: 'Jane', surname: 'Doe', displayName: 'Jane Doe', jobTitle: 'Director', officeLocation: 'Regional Office', mail: 'jane.doe@example.com', businessPhones: ['+1 555 010 0123 x 123'], photoDataUrl: 'data:image/jpeg;base64,amFuZQ==' },
      { id: 'entra-service', accountEnabled: true, userType: 'Member', displayName: 'Service Account', mail: 'service-bot@example.com' },
      { id: 'entra-guest', accountEnabled: true, userType: 'Guest', displayName: 'Guest', mail: 'guest@example.com' },
    ];
    const app = createApp({
      db,
      auth: { env: 'test', devAuthEmail: 'admin@example.com', allowedOrigins: ['https://signatures.test'] },
      microsoftUserResolver: async () => ({ email: 'person@example.com', microsoftId: 'test-id' }),
      directoryProvider: async () => directoryUsers,
      protectedStaffEmails: ['admin@example.com', 'editor@example.com'],
      publicRoot: directory,
      officeAddinRuntimeUrls: ['https://configured.test/outlook/runtime.js'],
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server?.close();
    db?.close();
  });

  async function request(route, options = {}) {
    const response = await fetch(`${baseUrl}${route}`, options);
    const body = await response.json();
    return { response, body };
  }

  it('reports health without authentication', async () => {
    const { response, body } = await request('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true });
  });

  it('generates Office add-in discovery metadata from server configuration', async () => {
    const { response, body } = await request('/.well-known/microsoft-officeaddins-allowed.json');
    assert.equal(response.status, 200);
    assert.deepEqual(body, { allowed: ['https://configured.test/outlook/runtime.js'] });
    assert.match(response.headers.get('cache-control'), /max-age=300/);
  });

  it('returns the managed profile for the administrator header', async () => {
    const { response, body } = await request('/api/admin/session');
    assert.equal(response.status, 200);
    assert.equal(body.email, 'admin@example.com');
    assert.equal(body.user.displayName, 'Ada Admin');
    assert.equal(body.user.first_name, 'Ada');
    assert.equal(body.user.last_name, 'Admin');
  });

  it('provides the visible picker directory to any Access identity', async () => {
    const { response, body } = await request('/api/picker');
    assert.equal(response.status, 200);
    assert.equal(body.identity.email, 'admin@example.com');
    assert.equal(body.canAccessAdmin, true);
    assert.equal(body.taglineOptions.length, 5);
    assert.equal(body.taglineOptions[0].key, 'proudly-different');
    assert.ok(body.users.some((user) => user.email === 'person@example.com'));
    assert.ok(body.users.every((user) => !Object.hasOwn(user, 'roles')));
    assert.match(response.headers.get('cache-control'), /no-store/);
  });

  it('manages database-backed taglines while preserving a required default', async () => {
    let result = await request('/api/admin/taglines');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.taglines.length, 5);
    const originalDefault = result.body.taglines.find((item) => item.is_default);
    assert.ok(originalDefault);

    result = await request('/api/admin/taglines', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ label: 'A newly approved phrase', isDefault: false }),
    });
    assert.equal(result.response.status, 201);
    const created = result.body.tagline;
    db.prepare(`UPDATE staff SET tagline_key=? WHERE email='person@example.com'`).run(created.key);

    result = await request(`/api/admin/taglines/${created.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ label: 'An edited approved phrase', isDefault: false }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.tagline.label, 'An edited approved phrase');
    assert.ok((await request('/api/picker')).body.taglineOptions.some((item) => item.label === 'An edited approved phrase'));

    result = await request(`/api/admin/taglines/${created.id}`, {
      method: 'DELETE', headers: { origin: 'https://signatures.test' },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.reassigned, 1);
    assert.equal(db.prepare(`SELECT tagline_key FROM staff WHERE email='person@example.com'`).get().tagline_key, originalDefault.key);

    result = await request(`/api/admin/taglines/${originalDefault.id}`, {
      method: 'DELETE', headers: { origin: 'https://signatures.test' },
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'default_tagline_cannot_be_deleted');
  });

  it('manages safe custom merge tags without allowing built-ins to be replaced', async () => {
    let result = await request('/api/admin/merge-tags', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ key: 'campaignUrl', description: 'Current campaign', value: 'https://example.test/?a=1&b=2' }),
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.tag.key, 'campaignUrl');

    result = await request('/api/admin/merge-tags');
    assert.ok(result.body.builtIns.some((tag) => tag.key === 'displayName'));
    assert.equal(result.body.customTags[0].value, 'https://example.test/?a=1&b=2');
    assert.equal(renderTemplate('<a href="{{campaignUrl}}">Campaign</a>', { first_name: '', last_name: '', title: '', phone: '', office_location: '', email: '' }, null, {}, { campaignUrl: 'https://example.test/?a=1&b=2' }), '<a href="https://example.test/?a=1&amp;b=2">Campaign</a>');

    result = await request('/api/admin/merge-tags/campaignUrl', {
      method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ key: 'campaignLink', description: 'Renamed campaign', value: 'https://example.test/new' }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.tag.key, 'campaignLink');

    result = await request('/api/admin/merge-tags', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ key: 'websiteUrl', value: 'https://wrong.test' }),
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'reserved_merge_tag');

    result = await request('/api/admin/merge-tags', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ key: 'unsafeLink', value: 'javascript:alert(1)' }),
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, 'unsafe_merge_tag');

    result = await request('/api/admin/merge-tags/campaignLink', { method: 'DELETE', headers: { origin: 'https://signatures.test' } });
    assert.equal(result.response.status, 200);
    assert.equal((await request('/api/admin/merge-tags')).body.customTags.length, 0);
  });

  it('enforces roles and an allowed Origin for mutations', async () => {
    const staffId = db.prepare(`SELECT id FROM staff WHERE email='person@example.com'`).get().id;
    let result = await request(`/api/admin/users/${staffId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicable: false }),
    });
    assert.equal(result.response.status, 403);
    assert.equal(result.body.error.code, 'invalid_origin');

    result = await request(`/api/admin/users/${staffId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' }, body: JSON.stringify({ applicable: false }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.user.applicable, false);
    assert.equal(db.prepare(`SELECT action FROM audit_log ORDER BY id DESC`).get().action, 'staff.profile_updated');
  });

  it('allows Communications editors to manage audiences without granting staff administration', async () => {
    const editorApp = createApp({
      db,
      auth: { env: 'test', devAuthEmail: 'editor@example.com', allowedOrigins: ['https://signatures.test'] },
      microsoftUserResolver: async () => ({ email: 'editor@example.com', microsoftId: 'editor-test-id' }),
      publicRoot: tmpdir(),
    });
    const editorServer = editorApp.listen(0, '127.0.0.1');
    await new Promise((resolve) => editorServer.once('listening', resolve));
    const editorBaseUrl = `http://127.0.0.1:${editorServer.address().port}`;
    const editorRequest = async (route, options = {}) => {
      const response = await fetch(`${editorBaseUrl}${route}`, options);
      return { response, body: await response.json() };
    };

    try {
      const personId = db.prepare(`SELECT id FROM staff WHERE email='person@example.com'`).get().id;
      let result = await editorRequest('/api/admin/audiences', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
        body: JSON.stringify({ name: 'Communications managed', description: 'Created by Comms', memberIds: [personId] }),
      });
      assert.equal(result.response.status, 201);
      const audienceId = result.body.audience.id;

      result = await editorRequest(`/api/admin/audiences/${audienceId}`, {
        method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
        body: JSON.stringify({ name: 'Communications managed', description: 'Updated by Comms', memberIds: [] }),
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.body.audience.member_count, 0);

      result = await editorRequest(`/api/admin/users/${personId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
        body: JSON.stringify({ applicable: false }),
      });
      assert.equal(result.response.status, 403);
      assert.equal(result.body.error.code, 'insufficient_role');

      result = await editorRequest(`/api/admin/audiences/${audienceId}`, {
        method: 'DELETE', headers: { origin: 'https://signatures.test' },
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.body.deleted, true);
    } finally {
      await new Promise((resolve, reject) => editorServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('syncs a filtered Entra directory while preserving title overrides', async () => {
    let result = await request('/api/admin/directory-sync', {
      method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ filters: { enabledOnly: true, membersOnly: true, allowedDomains: ['example.com'], excludedEmailPatterns: ['service-*'] } }),
    });
    assert.equal(result.response.status, 200);
    result = await request('/api/admin/directory-sync/run', { method: 'POST', headers: { origin: 'https://signatures.test' } });
    assert.deepEqual(result.body.result, { fetched: 3, matched: 1, filtered: 2, created: 1, updated: 0 });
    let jane = result.body.users.find((user) => user.email === 'jane.doe@example.com');
    assert.equal(jane.title, 'Director');
    assert.equal(jane.office_location, 'Regional Office');
    assert.equal(jane.phone, '+1 555 010 0123 x 123');
    assert.equal(jane.directory_source, 'entra');
    assert.equal(jane.photo_data_url, 'data:image/jpeg;base64,amFuZQ==');

    result = await request(`/api/admin/users/${jane.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ titleOverride: 'Acting Director' }),
    });
    assert.equal(result.body.user.title, 'Acting Director');
    directoryUsers[0].jobTitle = 'Vice President';
    result = await request('/api/admin/directory-sync/run', { method: 'POST', headers: { origin: 'https://signatures.test' } });
    jane = result.body.users.find((user) => user.email === 'jane.doe@example.com');
    assert.equal(jane.entra_title, 'Vice President');
    assert.equal(jane.title, 'Acting Director');
    assert.equal(result.body.result.updated, 1);
  });

  it('downloads Graph thumbnails only for directory users accepted by the configured filters', async () => {
    const requests = [];
    const fetchImpl = async (url) => {
      requests.push(String(url));
      if (String(url).includes('/oauth2/v2.0/token')) {
        return new Response(JSON.stringify({ access_token: 'token' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (String(url).includes('/v1.0/users?')) {
        return new Response(JSON.stringify({ value: [
          { id: 'accepted', accountEnabled: true, userType: 'Member', mail: 'accepted@example.com' },
          { id: 'excluded', accountEnabled: true, userType: 'Member', mail: 'service-bot@example.com' },
          { id: 'no-photo', accountEnabled: true, userType: 'Member', mail: 'plain@example.com' },
        ] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (String(url).includes('/accepted/photos/48x48/')) {
        return new Response(Buffer.from('jpeg-bytes'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      if (String(url).includes('/no-photo/photos/48x48/')) return new Response(null, { status: 404 });
      throw new Error(`Unexpected request: ${url}`);
    };
    const provider = createGraphDirectoryProvider({ tenantId: 'tenant', clientId: 'client', clientSecret: 'secret', fetchImpl });
    const users = await provider({ enabledOnly: true, membersOnly: true, allowedDomains: ['example.com'], excludedEmailPatterns: ['service-*'] });
    assert.equal(users.find((user) => user.id === 'accepted').photoDataUrl, `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`);
    assert.equal(users.find((user) => user.id === 'no-photo').photoDataUrl, null);
    assert.ok(!requests.some((url) => url.includes('/excluded/photos/')));
  });

  it('persists organization branding, scheduling, and new-account defaults', async () => {
    let result = await request('/api/admin/manage-settings');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.organizationName, 'Your organization');
    assert.equal(result.body.locationMappings.length, 0);
    assert.equal(result.body.directoryConfigured, true);

    result = await request('/api/admin/manage-settings', {
      method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({
        organizationName: 'Example Association',
        organizationInfo: {
          websiteUrl: 'https://example.test', facebookUrl: '', instagramUrl: '', linkedinUrl: '',
          xUrl: '', threadsUrl: '', blueskyUrl: '', youtubeUrl: '',
        },
        locationMappings: [{ source: 'Headquarters', output: 'Headquarters | Satellite Office | Branch Office | Regional Office' }],
        directorySchedule: { enabled: true, intervalHours: 6 },
        directoryDefaults: { visible: false, applicable: true, canSelfOptOut: true, canChooseTagline: true, signatureIdentityMode: 'mailbox' },
      }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.organizationName, 'Example Association');
    assert.equal(result.body.organizationInfo.websiteUrl, 'https://example.test');
    assert.deepEqual(result.body.locationMappings, [{ source: 'Headquarters', output: 'Headquarters | Satellite Office | Branch Office | Regional Office' }]);
    assert.equal(result.body.directorySchedule.enabled, true);
    assert.equal(result.body.directorySchedule.intervalHours, 6);
    assert.equal(result.body.directoryDefaults.visible, false);
    assert.equal(result.body.directoryDefaults.signatureIdentityMode, 'mailbox');
    assert.equal(renderTemplate('{{organizationName}}', { first_name: '', last_name: '', title: '', phone: '', office_location: '', email: '' }, null, result.body), 'Example Association');
    assert.equal(renderTemplate('<a href="{{websiteUrl}}">Website</a>', { first_name: '', last_name: '', title: '', phone: '', office_location: '', email: '' }, null, result.body), '<a href="https://example.test">Website</a>');
    assert.equal(renderTemplate('{{locations}}', { first_name: '', last_name: '', title: '', phone: '', office_location: 'HEADQUARTERS', email: '' }, null, result.body), 'Headquarters | Satellite Office | Branch Office | Regional Office');

    await request('/api/admin/manage-settings', {
      method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({
        organizationName: 'Example Organization',
        locationMappings: [],
        directorySchedule: { enabled: false, intervalHours: 24 },
        directoryDefaults: { visible: true, applicable: true, canSelfOptOut: false, canChooseTagline: false, signatureIdentityMode: 'signed_in' },
      }),
    });
  });

  it('runs due scheduled Entra synchronization and applies defaults only to new accounts', async () => {
    const scheduledDb = openDatabase(':memory:');
    try {
      saveManageSettings(scheduledDb, {
        organizationName: 'Scheduled Org',
        directorySchedule: { enabled: true, intervalHours: 1 },
        directoryDefaults: { visible: false, applicable: true, canSelfOptOut: true, canChooseTagline: true, signatureIdentityMode: 'mailbox' },
      }, 'admin@example.test');
      const provider = async () => [{ id: 'scheduled-user', accountEnabled: true, userType: 'Member', givenName: 'New', surname: 'Person', mail: 'new.person@example.com' }];
      const first = await runScheduledDirectorySync({ db: scheduledDb, directoryProvider: provider });
      assert.equal(first.ran, true);
      assert.equal(first.result.created, 1);
      const user = scheduledDb.prepare("SELECT * FROM staff WHERE email='new.person@example.com'").get();
      assert.equal(user.visible, 0);
      assert.equal(user.applicable, 1);
      assert.equal(user.can_self_opt_out, 1);
      assert.equal(user.can_choose_tagline, 1);
      assert.equal(user.signature_identity_mode, 'mailbox');
      const second = await runScheduledDirectorySync({ db: scheduledDb, directoryProvider: provider });
      assert.deepEqual(second, { ran: false, reason: 'not_due' });
    } finally {
      scheduledDb.close();
    }
  });

  it('bulk edits signature details while preserving their Entra source values', async () => {
    const jane = db.prepare(`SELECT id FROM staff WHERE email='jane.doe@example.com'`).get();
    const person = db.prepare(`SELECT id FROM staff WHERE email='person@example.com'`).get();
    let result = await request('/api/admin/users/profiles', {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ profiles: [
        { id: jane.id, titleOverride: 'Regional Director', officeLocationOverride: 'Branch Office', phoneOverride: '905-555-0100 x 456' },
        { id: person.id, titleOverride: null, officeLocationOverride: 'Satellite Office', phoneOverride: null },
      ] }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.users.length, 2);
    const updatedJane = result.body.users.find((user) => user.id === jane.id);
    assert.equal(updatedJane.title, 'Regional Director');
    assert.equal(updatedJane.directory_title, 'Vice President');
    assert.equal(updatedJane.office_location, 'Branch Office');
    assert.equal(updatedJane.directory_office_location, 'Regional Office');
    assert.equal(updatedJane.phone, '905-555-0100 x 456');
    assert.equal(updatedJane.directory_phone, '+1 555 010 0123 x 123');

    result = await request('/api/admin/users/profiles', {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ profiles: [
        { id: jane.id, titleOverride: null, officeLocationOverride: null, phoneOverride: null },
        { id: 999999, titleOverride: null, officeLocationOverride: null, phoneOverride: null },
      ] }),
    });
    assert.equal(result.response.status, 404);
    assert.equal(db.prepare('SELECT title_override FROM staff WHERE id=?').get(jane.id).title_override, 'Regional Director');
  });

  it('updates visibility and applicability for multiple staff atomically', async () => {
    const selected = db.prepare(`SELECT id FROM staff WHERE email IN ('editor@example.com','person@example.com') ORDER BY id`).all().map((row) => row.id);
    let result = await request('/api/admin/users', {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ ids: selected, visible: false, applicable: false }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.users.length, 2);
    assert.ok(result.body.users.every((user) => !user.visible && !user.applicable));
    const event = db.prepare(`SELECT action,details_json FROM audit_log ORDER BY id DESC`).get();
    assert.equal(event.action, 'staff.bulk_updated');
    assert.deepEqual(JSON.parse(event.details_json), { ids: selected, visible: false, applicable: false });

    result = await request('/api/admin/users', {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ ids: [selected[0], 999999], visible: true }),
    });
    assert.equal(result.response.status, 404);
    assert.equal(db.prepare('SELECT visible FROM staff WHERE id=?').get(selected[0]).visible, 0);
    db.prepare(`UPDATE staff SET visible=1,applicable=1 WHERE id IN (${selected.map(() => '?').join(',')})`).run(...selected);
  });

  it('bulk-manages independent self-service permissions', async () => {
    const selected = db.prepare(`SELECT id FROM staff WHERE email IN ('editor@example.com','person@example.com') ORDER BY id`).all().map((row) => row.id);
    let result = await request('/api/admin/users', {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ ids: selected, canSelfOptOut: true, canChooseTagline: true }),
    });
    assert.equal(result.response.status, 200);
    assert.ok(result.body.users.every((user) => user.can_self_opt_out && user.can_choose_tagline));

    db.prepare(`UPDATE staff SET self_opted_out=1 WHERE id=?`).run(selected[0]);
    result = await request('/api/admin/users', {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ ids: [selected[0]], canSelfOptOut: false }),
    });
    assert.equal(result.body.users[0].can_self_opt_out, false);
    assert.equal(result.body.users[0].self_opted_out, false);
    assert.equal(result.body.users[0].can_choose_tagline, true);

    result = await request('/api/admin/users', {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ ids: selected, signatureIdentityMode: 'mailbox' }),
    });
    assert.ok(result.body.users.every((user) => user.signature_identity_mode === 'mailbox'));
    db.prepare(`UPDATE staff SET signature_identity_mode='signed_in' WHERE id IN (${selected.map(() => '?').join(',')})`).run(...selected);
  });

  it('allows only explicitly permitted self-service preferences', async () => {
    let result = await request('/api/picker/preferences', {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ selfOptedOut: true }),
    });
    assert.equal(result.response.status, 403);
    assert.equal(result.body.error.code, 'self_opt_out_not_allowed');

    db.prepare(`UPDATE staff SET can_self_opt_out=1,can_choose_tagline=1 WHERE email='admin@example.com'`).run();
    result = await request('/api/picker/preferences', {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ selfOptedOut: true, taglineKey: 'in-your-corner' }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.currentUser.self_opted_out, true);
    assert.equal(result.body.currentUser.signature_enabled, false);
    assert.equal(result.body.currentUser.tagline_key, 'in-your-corner');
    assert.equal(db.prepare(`SELECT action FROM audit_log ORDER BY id DESC`).get().action, 'staff.preferences_updated');

    result = await request('/api/picker/preferences', {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ taglineKey: 'make-it-up' }),
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, 'invalid_tagline');
    db.prepare(`UPDATE staff SET self_opted_out=0 WHERE email='admin@example.com'`).run();
  });

  it('deletes stale staff with related access while protecting environment-seeded administrators', async () => {
    const staleId = db.prepare(`INSERT INTO staff(email,first_name,last_name) VALUES ('stale@example.com','Stale','Account')`).run().lastInsertRowid;
    db.prepare(`INSERT INTO role_grants(staff_id,role,granted_by) VALUES (?,'communications_editor','test')`).run(staleId);
    const audienceId = db.prepare(`INSERT INTO audiences(name,description,created_by,updated_by) VALUES ('Delete test','','test','test')`).run().lastInsertRowid;
    db.prepare('INSERT INTO audience_members(audience_id,staff_id) VALUES (?,?)').run(audienceId, staleId);

    let result = await request('/api/admin/users', {
      method: 'DELETE', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' }, body: JSON.stringify({ ids: [staleId] }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.deleted, 1);
    assert.equal(db.prepare('SELECT 1 FROM staff WHERE id=?').get(staleId), undefined);
    assert.equal(db.prepare('SELECT 1 FROM audience_members WHERE staff_id=?').get(staleId), undefined);
    assert.equal(db.prepare(`SELECT action FROM audit_log ORDER BY id DESC`).get().action, 'staff.deleted');

    const editorId = db.prepare(`SELECT id FROM staff WHERE email='editor@example.com'`).get().id;
    result = await request('/api/admin/users', {
      method: 'DELETE', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' }, body: JSON.stringify({ ids: [editorId] }),
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'protected_staff');
    assert.ok(db.prepare('SELECT 1 FROM staff WHERE id=?').get(editorId));

    result = await request('/api/admin/users');
    assert.equal(result.body.users.find((user) => user.email === 'editor@example.com').deletable, false);
    assert.equal(result.body.users.find((user) => user.email === 'person@example.com').deletable, true);
  });

  it('blocks a staff email from future Entra sync and removes its managed record', async () => {
    const blockedId = db.prepare(`INSERT INTO staff(email,first_name,last_name) VALUES ('blocked@example.com','Blocked','Account')`).run().lastInsertRowid;
    db.prepare(`INSERT INTO role_grants(staff_id,role,granted_by) VALUES (?,'communications_editor','test')`).run(blockedId);
    const audienceId = db.prepare(`INSERT INTO audiences(name,description,created_by,updated_by) VALUES ('Block test','','test','test')`).run().lastInsertRowid;
    db.prepare('INSERT INTO audience_members(audience_id,staff_id) VALUES (?,?)').run(audienceId, blockedId);

    let result = await request(`/api/admin/users/${blockedId}/block`, {
      method: 'POST', headers: { origin: 'https://signatures.test' },
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.blocked, { id: blockedId, email: 'blocked@example.com' });
    assert.ok(result.body.filters.excludedEmailPatterns.includes('blocked@example.com'));
    assert.ok(result.body.filters.excludedEmailPatterns.includes('service-*'));
    assert.equal(db.prepare('SELECT 1 FROM staff WHERE id=?').get(blockedId), undefined);
    assert.equal(db.prepare('SELECT 1 FROM audience_members WHERE staff_id=?').get(blockedId), undefined);
    assert.equal(db.prepare(`SELECT action FROM audit_log ORDER BY id DESC`).get().action, 'staff.blocked');

    result = await request('/api/admin/directory-sync');
    assert.ok(result.body.filters.excludedEmailPatterns.includes('blocked@example.com'));

    const editorId = db.prepare(`SELECT id FROM staff WHERE email='editor@example.com'`).get().id;
    result = await request(`/api/admin/users/${editorId}/block`, { method: 'POST', headers: { origin: 'https://signatures.test' } });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'protected_staff');

    const adminId = db.prepare(`SELECT id FROM staff WHERE email='admin@example.com'`).get().id;
    result = await request(`/api/admin/users/${adminId}/block`, { method: 'POST', headers: { origin: 'https://signatures.test' } });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'cannot_block_current_user');
  });

  it('rejects active content and unsafe URL schemes in templates', () => {
    for (const html of [
      '<script>alert(1)</script>',
      '<img src="https://example.test/x" onerror="alert(1)">',
      '<a href="javascript:alert(1)">x</a>',
      '<img src="data:image/png;base64,x">',
      '<a href="ftp://example.test">x</a>',
    ]) assert.throws(() => safeTemplateHtml(html), /Template rejected/);
    assert.equal(safeTemplateHtml('<a href="mailto:test@example.test">Email</a>'), '<a href="mailto:test@example.test">Email</a>');
    assert.equal(safeTemplateHtml('<a href="{{websiteUrl}}">Website</a>'), '<a href="{{websiteUrl}}">Website</a>');
  });

  it('exports and transactionally restores a validated database backup', async () => {
    const adminId = db.prepare(`SELECT id FROM staff WHERE email='admin@example.com'`).get().id;
    db.prepare(`DELETE FROM role_grants WHERE staff_id=? AND role='it_admin'`).run(adminId);
    let denied = await fetch(`${baseUrl}/api/admin/database/export`);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'insufficient_role');
    db.prepare(`INSERT INTO role_grants(staff_id,role,granted_by) VALUES (?,'it_admin','test')`).run(adminId);

    db.prepare(`INSERT INTO app_settings(key,value_json,updated_by) VALUES ('backup_test','"before"','test')
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by`).run();
    const exportResponse = await fetch(`${baseUrl}/api/admin/database/export`);
    assert.equal(exportResponse.status, 200);
    assert.equal(exportResponse.headers.get('content-type'), 'application/vnd.sqlite3');
    assert.match(exportResponse.headers.get('content-disposition'), /^attachment; filename="siggen-backup-/);
    const backup = Buffer.from(await exportResponse.arrayBuffer());
    assert.equal(backup.subarray(0, 16).toString('binary'), 'SQLite format 3\0');

    db.prepare(`UPDATE app_settings SET value_json='"after"' WHERE key='backup_test'`).run();
    let response = await fetch(`${baseUrl}/api/admin/database/import`, {
      method: 'POST', headers: { 'content-type': 'application/vnd.sqlite3', origin: 'https://signatures.test' }, body: backup,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).restored, true);
    assert.equal(db.prepare(`SELECT value_json FROM app_settings WHERE key='backup_test'`).get().value_json, '"before"');
    assert.equal(db.prepare(`SELECT action FROM audit_log ORDER BY id DESC`).get().action, 'database.imported');

    const legacyDirectory = mkdtempSync(path.join(tmpdir(), 'siggen-v13-backup-'));
    const legacyPath = path.join(legacyDirectory, 'backup.sqlite');
    writeFileSync(legacyPath, backup);
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec('DELETE FROM schema_migrations; INSERT INTO schema_migrations(version) VALUES (13)');
    legacy.close();
    response = await fetch(`${baseUrl}/api/admin/database/import`, {
      method: 'POST', headers: { 'content-type': 'application/vnd.sqlite3', origin: 'https://signatures.test' }, body: readFileSync(legacyPath),
    });
    rmSync(legacyDirectory, { recursive: true, force: true });
    assert.equal(response.status, 200);
    assert.equal(db.prepare(`SELECT MAX(version) AS version FROM schema_migrations`).get().version, 200);
    assert.equal(db.prepare(`SELECT tagline_key FROM staff WHERE email='admin@example.com'`).get().tagline_key, 'in-your-corner');
    assert.equal(db.prepare(`SELECT signature_identity_mode FROM staff WHERE email='admin@example.com'`).get().signature_identity_mode, 'signed_in');

    response = await fetch(`${baseUrl}/api/admin/database/import`, {
      method: 'POST', headers: { 'content-type': 'application/vnd.sqlite3', origin: 'https://signatures.test' }, body: Buffer.from('not a database'),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_database_backup');
    assert.equal(db.prepare(`SELECT value_json FROM app_settings WHERE key='backup_test'`).get().value_json, '"before"');
  });

  it('stores MJML source and compiles safe email-compatible HTML', async () => {
    const mjml = '<mjml><mj-body width="600px"><mj-section padding="0"><mj-column><mj-text>{{displayName}}</mj-text></mj-column></mj-section></mj-body></mjml>';
    const html = await compileMjml(mjml);
    assert.match(html, /<table/);
    assert.match(html, /{{displayName}}/);
    assert.doesNotMatch(html, /<body/i);
    await assert.rejects(() => compileMjml('<mjml><mj-body><mj-include path="/etc/passwd" /></mj-body></mjml>'), /includes are not supported/);

    const result = await request('/api/admin/templates', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ name: 'Visual template', mjml }),
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.template.source_mjml, mjml);
    assert.match(result.body.template.html, /{{displayName}}/);
    const duplicate = await request(`/api/admin/templates/${result.body.template.id}/duplicate`, {
      method: 'POST', headers: { origin: 'https://signatures.test' },
    });
    assert.equal(duplicate.response.status, 201);
    assert.equal(duplicate.body.template.name, 'Visual template copy');
    assert.equal(duplicate.body.template.revision, 1);
    assert.equal(duplicate.body.template.source_mjml, mjml);
    assert.equal(duplicate.body.template.html, result.body.template.html);
    assert.equal(db.prepare(`SELECT action FROM audit_log ORDER BY id DESC`).get().action, 'template.duplicated');
    db.prepare('DELETE FROM signature_templates WHERE id=?').run(duplicate.body.template.id);
    db.prepare('DELETE FROM signature_templates WHERE id=?').run(result.body.template.id);
  });

  it('creates direct HTML templates as editable legacy drafts', async () => {
    const result = await request('/api/admin/templates', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ name: 'HTML template', html: '<table><tr><td>{{displayName}}</td></tr></table>' }),
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.template.source_mjml, null);
    assert.match(result.body.template.html, /{{displayName}}/);
    db.prepare('DELETE FROM signature_templates WHERE id=?').run(result.body.template.id);
  });

  it('escapes directory values during rendering', () => {
    const html = renderTemplate('<b>{{displayName}}</b> — {{title}} — {{locations}} — {{officeLocation}}', {
      first_name: 'Pat', last_name: '<Person>', title: 'Agent & Advisor', phone: '', office_location: 'Regional Area', email: 'person@example.com',
    });
    assert.equal(html, '<b>Pat &lt;Person&gt;</b> — Agent &amp; Advisor — Regional Area — Regional Area');

    const tagline = renderTemplate('<span>{{tagline}}</span> A legacy approved phrase', {
      first_name: 'Pat', last_name: 'Person', title: '', phone: '', office_location: '', email: 'person@example.com', tagline_key: 'in-your-corner',
    }, { label: 'An updated approved phrase', legacy_match_text: 'A legacy approved phrase' });
    assert.equal(tagline, '<span>An updated approved phrase</span> An updated approved phrase');
  });

  it('previews a staff signature using the draft when nothing is published', async () => {
    const staffId = db.prepare(`SELECT id FROM staff WHERE email='person@example.com'`).get().id;
    db.prepare(`UPDATE deployments SET status='superseded',superseded_at=CURRENT_TIMESTAMP WHERE status='published'`).run();
    const result = await request(`/api/admin/users/${staffId}/signature-preview`);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.source, 'draft');
    assert.equal(result.body.templateName, 'Default signature');
    assert.match(result.body.html, /Pat &lt;Person&gt;/);
    assert.match(result.response.headers.get('cache-control'), /no-store/);
  });

  it('does not expose draft templates through the staff picker', async () => {
    const result = await request('/api/picker/signature?email=person%40example.com');
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'no_published_signature');
  });

  it('returns only a published signature for an applicable Microsoft identity', async () => {
    const template = db.prepare('SELECT id FROM signature_templates ORDER BY id LIMIT 1').get();
    db.prepare(`UPDATE deployments SET status='superseded',superseded_at=CURRENT_TIMESTAMP WHERE status='published'`).run();
    db.prepare(`INSERT INTO deployments(template_id,template_revision,html_snapshot,status,published_by) VALUES (?,1,'Hello {{displayName}}','published','test')`).run(template.id);
    db.prepare(`UPDATE staff SET applicable=1 WHERE email='person@example.com'`).run();
    const signedBefore = (await request('/api/admin/dashboard')).body.signaturesSigned;
    let result = await request('/api/outlook/signature', { headers: { authorization: 'Bearer injected-test-token' } });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.html, 'Hello Pat &lt;Person&gt;');
    assert.equal(result.body.templateName, 'Default signature');
    assert.equal(result.body.version, 1);
    assert.deepEqual(result.body.user, { displayName: 'Pat <Person>', email: 'person@example.com' });
    assert.match(result.response.headers.get('cache-control'), /no-store/);
    const dashboardResult = await request('/api/admin/dashboard');
    assert.equal(dashboardResult.response.status, 200);
    assert.equal(dashboardResult.body.signaturesSigned, signedBefore + 1);
    assert.match(dashboardResult.response.headers.get('cache-control'), /no-store/);

    db.prepare(`UPDATE staff SET can_self_opt_out=1,can_choose_tagline=1 WHERE email='person@example.com'`).run();
    result = await request('/api/outlook/signature?preferences=1', { headers: { authorization: 'Bearer injected-test-token' } });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, { available: true, canSelfOptOut: true, canChooseTagline: true, url: '/' });

    result = await request('/api/picker/signature?email=person%40example.com');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.html, 'Hello Pat &lt;Person&gt;');
    assert.equal(result.body.templateName, 'Default signature');
    assert.equal(result.body.version, 1);
    assert.match(result.response.headers.get('cache-control'), /no-store/);

    const staffId = db.prepare(`SELECT id FROM staff WHERE email='person@example.com'`).get().id;
    result = await request(`/api/admin/users/${staffId}/signature-preview`);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.source, 'published');
    assert.equal(result.body.html, 'Hello Pat &lt;Person&gt;');

    db.prepare(`UPDATE staff SET applicable=0 WHERE email='person@example.com'`).run();
    const response = await fetch(`${baseUrl}/api/outlook/signature`, { headers: { authorization: 'Bearer injected-test-token' } });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');

    db.prepare(`UPDATE staff SET applicable=1,self_opted_out=1 WHERE email='person@example.com'`).run();
    const optedOut = await fetch(`${baseUrl}/api/outlook/signature`, { headers: { authorization: 'Bearer injected-test-token' } });
    assert.equal(optedOut.status, 204);
    db.prepare(`UPDATE staff SET self_opted_out=0 WHERE email='person@example.com'`).run();
  });

  it('renders the signature for an applicable shared-mailbox sender hidden from the picker', async () => {
    db.prepare(`INSERT OR IGNORE INTO staff(email,first_name,last_name,title,phone,visible,applicable)
      VALUES ('support@example.com','Example','Support','Support team','+1 555 010 0199',0,1)`).run();
    db.prepare(`UPDATE staff SET visible=0,applicable=1 WHERE email='support@example.com'`).run();

    let result = await request('/api/outlook/signature?sender=support%40example.com', {
      headers: { authorization: 'Bearer injected-test-token' },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.html, 'Hello Pat &lt;Person&gt;');
    assert.deepEqual(result.body.user, { displayName: 'Pat <Person>', email: 'person@example.com' });
    assert.deepEqual(result.body.sender, { displayName: 'Example Support', email: 'support@example.com' });
    assert.equal(result.body.signatureIdentityMode, 'signed_in');

    const supportId = db.prepare(`SELECT id FROM staff WHERE email='support@example.com'`).get().id;
    result = await request(`/api/admin/users/${supportId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ signatureIdentityMode: 'mailbox' }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.user.signature_identity_mode, 'mailbox');

    result = await request('/api/outlook/signature?sender=support%40example.com', {
      headers: { authorization: 'Bearer injected-test-token' },
    });
    assert.equal(result.body.html, 'Hello Example Support');
    assert.deepEqual(result.body.user, { displayName: 'Example Support', email: 'support@example.com' });
    assert.equal(result.body.signatureIdentityMode, 'mailbox');

    result = await request('/api/picker/signature?email=support%40example.com');
    assert.equal(result.response.status, 404);
    assert.equal(result.body.error.code, 'not_found');

    const response = await fetch(`${baseUrl}/api/outlook/signature?sender=missing%40example.com`, {
      headers: { authorization: 'Bearer injected-test-token' },
    });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
  });

  it('targets reusable audiences and resolves the highest configurable priority', async () => {
    const personId = db.prepare(`SELECT id FROM staff WHERE email='person@example.com'`).get().id;
    const editorId = db.prepare(`SELECT id FROM staff WHERE email='editor@example.com'`).get().id;
    db.prepare(`UPDATE staff SET applicable=1,visible=1 WHERE id IN (?,?)`).run(personId, editorId);

    let result = await request('/api/admin/audiences', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ name: 'Leadership', description: 'Limited signature override', memberIds: [personId] }),
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.audience.member_count, 1);
    assert.deepEqual(result.body.audience.member_ids, [personId]);
    const audienceId = result.body.audience.id;

    const templateId = Number(db.prepare(`INSERT INTO signature_templates(name,html,created_by,updated_by) VALUES ('Leadership signature','Leadership {{displayName}}','test','test')`).run().lastInsertRowid);
    result = await request(`/api/admin/templates/${templateId}/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ audienceId, priority: 100 }),
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.deployment.priority, 100);
    assert.equal(result.body.deployment.audience_id, audienceId);
    const deploymentId = result.body.deployment.id;

    result = await request(`/api/admin/deployments/${deploymentId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ priority: 150 }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.deployment.priority, 150);

    result = await request('/api/outlook/signature', { headers: { authorization: 'Bearer injected-test-token' } });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.html, 'Leadership Pat &lt;Person&gt;');
    assert.equal(result.body.audienceName, 'Leadership');
    assert.equal(result.body.priority, 150);

    result = await request('/api/picker/signature?email=editor%40example.com');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.priority, 0);
    assert.equal(result.body.audienceName, 'All applicable staff');

    result = await request(`/api/admin/templates/${templateId}/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ audienceId, priority: 0 }),
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'priority_not_above_default');

    const defaultTemplateId = db.prepare('SELECT MIN(id) AS id FROM signature_templates').get().id;
    result = await request(`/api/admin/templates/${defaultTemplateId}/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ audienceId: null, priority: 150 }),
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'default_priority_too_high');

    result = await request('/api/admin/audiences');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.audiences.find((item) => item.id === audienceId).member_count, 1);
    assert.equal(result.body.audiences.find((item) => item.id === audienceId).actively_deployed, true);

    result = await request(`/api/admin/audiences/${audienceId}`, {
      method: 'DELETE', headers: { origin: 'https://signatures.test' },
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'audience_is_active');

    const defaultDeploymentId = db.prepare(`SELECT id FROM deployments WHERE status='published' AND audience_id IS NULL`).get().id;
    result = await request(`/api/admin/deployments/${defaultDeploymentId}/unpublish`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({}),
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, 'confirmation_required');

    result = await request(`/api/admin/deployments/${deploymentId}/unpublish`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({}),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.deployment.status, 'superseded');
    assert.ok(result.body.deployment.superseded_at);

    result = await request('/api/outlook/signature', { headers: { authorization: 'Bearer injected-test-token' } });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.html, 'Hello Pat &lt;Person&gt;');
    assert.equal(result.body.audienceName, 'All applicable staff');

    result = await request(`/api/admin/deployments/${deploymentId}/unpublish`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({}),
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'deployment_not_active');

    result = await request(`/api/admin/audiences/${audienceId}`, {
      method: 'DELETE', headers: { origin: 'https://signatures.test' },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.deleted, true);
    assert.equal(db.prepare('SELECT deleted_at FROM audiences WHERE id=?').get(audienceId).deleted_at != null, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audience_members WHERE audience_id=?').get(audienceId).count, 0);
    result = await request('/api/admin/audiences');
    assert.equal(result.body.audiences.some((item) => item.id === audienceId), false);
    const historicalDeployment = (await request('/api/admin/deployments')).body.deployments.find((item) => item.id === deploymentId);
    assert.equal(historicalDeployment.audience_name, 'Leadership');

    result = await request('/api/admin/audiences', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ name: 'Leadership', description: 'Recreated after deletion', memberIds: [personId] }),
    });
    assert.equal(result.response.status, 201);
    assert.notEqual(result.body.audience.id, audienceId);
  });

  it('schedules, lists, cancels, and automatically publishes deployments', async () => {
    const personId = db.prepare(`SELECT id FROM staff WHERE email='person@example.com'`).get().id;
    let result = await request('/api/admin/audiences', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ name: 'Scheduled audience', description: 'Timed deployment test', memberIds: [personId] }),
    });
    assert.equal(result.response.status, 201);
    const audienceId = result.body.audience.id;
    const templateId = Number(db.prepare(`INSERT INTO signature_templates(name,html,created_by,updated_by) VALUES ('Scheduled signature','Scheduled {{displayName}}','test','test')`).run().lastInsertRowid);
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    result = await request(`/api/admin/templates/${templateId}/schedule`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ audienceId, priority: 200, scheduledFor: future }),
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.scheduled.status, 'scheduled');
    assert.equal(result.body.scheduled.template_revision, 1);
    assert.equal(result.body.scheduled.html_snapshot, 'Scheduled {{displayName}}');
    const cancelledId = result.body.scheduled.id;

    result = await request('/api/admin/deployments');
    assert.equal(result.response.status, 200);
    assert.ok(result.body.scheduled.some((item) => item.id === cancelledId && item.template_name === 'Scheduled signature'));

    result = await request(`/api/admin/scheduled-deployments/${cancelledId}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' }, body: '{}',
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.scheduled.status, 'cancelled');

    result = await request(`/api/admin/templates/${templateId}/schedule`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://signatures.test' },
      body: JSON.stringify({ audienceId, priority: 200, scheduledFor: future }),
    });
    const scheduledId = result.body.scheduled.id;
    db.prepare(`UPDATE scheduled_deployments SET scheduled_for=? WHERE id=?`).run(new Date(Date.now() - 1000).toISOString(), scheduledId);
    const executed = runDueScheduledDeployments(db, { now: Date.now() });
    assert.deepEqual(executed.map(({ status }) => status), ['published']);
    const scheduled = db.prepare('SELECT * FROM scheduled_deployments WHERE id=?').get(scheduledId);
    assert.equal(scheduled.status, 'published');
    assert.ok(scheduled.deployment_id);
    const deployment = db.prepare('SELECT * FROM deployments WHERE id=?').get(scheduled.deployment_id);
    assert.equal(deployment.status, 'published');
    assert.equal(deployment.html_snapshot, 'Scheduled {{displayName}}');
  });

  it('soft-deletes ordinary drafts but protects the original template', async () => {
    const originalId = db.prepare('SELECT MIN(id) AS id FROM signature_templates').get().id;
    let response = await fetch(`${baseUrl}/api/admin/templates/${originalId}`, { method: 'DELETE', headers: { origin: 'https://signatures.test' } });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'protected_template');

    const templateId = Number(db.prepare(`INSERT INTO signature_templates(name,html,created_by,updated_by) VALUES ('Temporary draft','Draft','test','test')`).run().lastInsertRowid);
    response = await fetch(`${baseUrl}/api/admin/templates/${templateId}`, { method: 'DELETE', headers: { origin: 'https://signatures.test' } });
    assert.equal(response.status, 204);
    assert.ok(db.prepare('SELECT deleted_at FROM signature_templates WHERE id=?').get(templateId).deleted_at);
    const templates = await request('/api/admin/templates');
    assert.ok(!templates.body.templates.some((template) => template.id === templateId));
    assert.equal(db.prepare(`SELECT action FROM audit_log ORDER BY id DESC`).get().action, 'template.deleted');
  });
});
