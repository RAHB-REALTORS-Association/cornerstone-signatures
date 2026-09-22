import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_TEMPLATE } from './seed.js';
import { HttpError } from './errors.js';

export const SCHEMA_VERSION = 200;

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0,1)), applicable INTEGER NOT NULL DEFAULT 1 CHECK (applicable IN (0,1)),
  entra_object_id TEXT, entra_title TEXT NOT NULL DEFAULT '', title_override TEXT,
  office_location TEXT NOT NULL DEFAULT '', entra_office_location TEXT NOT NULL DEFAULT '', office_location_override TEXT,
  entra_phone TEXT NOT NULL DEFAULT '', phone_override TEXT,
  directory_source TEXT NOT NULL DEFAULT 'manual', directory_synced_at TEXT, directory_account_enabled INTEGER,
  can_self_opt_out INTEGER NOT NULL DEFAULT 0 CHECK (can_self_opt_out IN (0,1)),
  self_opted_out INTEGER NOT NULL DEFAULT 0 CHECK (self_opted_out IN (0,1)),
  can_choose_tagline INTEGER NOT NULL DEFAULT 0 CHECK (can_choose_tagline IN (0,1)),
  tagline_key TEXT NOT NULL DEFAULT '',
  signature_identity_mode TEXT NOT NULL DEFAULT 'signed_in' CHECK (signature_identity_mode IN ('signed_in','mailbox')),
  photo_data_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_entra_object_id ON staff(entra_object_id) WHERE entra_object_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS role_grants (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('it_admin','communications_editor')),
  granted_by TEXT NOT NULL, granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (staff_id, role)
);
CREATE TABLE IF NOT EXISTS signature_templates (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, html TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_mjml TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS audiences (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, description TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT, historical_name TEXT
);
CREATE TABLE IF NOT EXISTS audience_members (
  audience_id INTEGER NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (audience_id, staff_id)
);
CREATE TABLE IF NOT EXISTS deployments (
  id INTEGER PRIMARY KEY, template_id INTEGER NOT NULL REFERENCES signature_templates(id), template_revision INTEGER NOT NULL,
  html_snapshot TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('published','superseded')),
  published_by TEXT NOT NULL, published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, superseded_at TEXT,
  audience_id INTEGER REFERENCES audiences(id), priority INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS one_default_published_deployment ON deployments(status) WHERE status='published' AND audience_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_published_deployment_per_audience ON deployments(audience_id) WHERE status='published' AND audience_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audience_members_staff ON audience_members(staff_id, audience_id);
CREATE TABLE IF NOT EXISTS scheduled_deployments (
  id INTEGER PRIMARY KEY, template_id INTEGER NOT NULL REFERENCES signature_templates(id), template_revision INTEGER NOT NULL,
  html_snapshot TEXT NOT NULL, audience_id INTEGER REFERENCES audiences(id), priority INTEGER NOT NULL DEFAULT 0,
  scheduled_for TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','published','cancelled','failed')),
  scheduled_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, executed_at TEXT,
  deployment_id INTEGER REFERENCES deployments(id), error_message TEXT
);
CREATE INDEX IF NOT EXISTS scheduled_deployments_due ON scheduled_deployments(status, scheduled_for);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, actor_email TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL,
  entity_id TEXT, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS taglines (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL COLLATE NOCASE UNIQUE, label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  legacy_match_text TEXT, created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

function json(value) { return JSON.stringify(value ?? {}); }

export function openDatabase(databasePath, { initialItAdmins = [] } = {}) {
  if (databasePath !== ':memory:') mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA busy_timeout = 5000;');
  if (databasePath !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  const hasMigrationTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get());
  if (hasMigrationTable) {
    const versions = db.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version));
    if (versions.length && !versions.includes(SCHEMA_VERSION)) {
      db.close();
      throw new Error('This database predates Cornerstone Signatures v2. Start with a new database, then import a schema-13 v1 export from Admin > Manage.');
    }
  }
  db.exec(schema);
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)').run(SCHEMA_VERSION);
  db.prepare(`INSERT INTO signature_templates(name,html,created_by,updated_by)
    SELECT 'Default signature', ?, 'system', 'system' WHERE NOT EXISTS (SELECT 1 FROM signature_templates)`).run(DEFAULT_TEMPLATE);
  for (const email of initialItAdmins) {
    db.prepare(`INSERT OR IGNORE INTO staff(email,first_name,last_name) VALUES (?, ?, '')`).run(email, email.split('@')[0]);
    db.prepare(`INSERT OR IGNORE INTO role_grants(staff_id,role,granted_by) SELECT id,'it_admin','bootstrap' FROM staff WHERE email=?`).run(email);
  }
  return db;
}

export function getStaffByEmail(db, email) {
  return hydrateStaff(db.prepare(`SELECT * FROM staff WHERE email=? COLLATE NOCASE`).get(String(email).toLowerCase()));
}

export function recordSignatureDelivery(db) {
  db.prepare(`INSERT INTO app_settings(key,value_json,updated_by)
    VALUES ('signature_delivery_count','1','outlook')
    ON CONFLICT(key) DO UPDATE SET
      value_json=CAST(CAST(app_settings.value_json AS INTEGER)+1 AS TEXT),
      updated_by='outlook',updated_at=CURRENT_TIMESTAMP`).run();
}

export function getSignatureDeliveryCount(db) {
  const setting = db.prepare(`SELECT value_json FROM app_settings WHERE key='signature_delivery_count'`).get();
  const count = Number(setting?.value_json ?? 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export function getRoles(db, email) {
  return db.prepare(`SELECT role FROM role_grants rg JOIN staff s ON s.id=rg.staff_id WHERE s.email=? COLLATE NOCASE ORDER BY role`).all(email).map((row) => row.role);
}

export function audit(db, actor, action, entityType, entityId, details) {
  db.prepare(`INSERT INTO audit_log(actor_email,action,entity_type,entity_id,details_json) VALUES (?,?,?,?,?)`)
    .run(actor, action, entityType, entityId == null ? null : String(entityId), json(details));
}

export function listStaff(db) {
  const staff = db.prepare('SELECT * FROM staff ORDER BY last_name, first_name').all();
  const roles = db.prepare('SELECT staff_id, role FROM role_grants ORDER BY role').all();
  const byId = new Map();
  for (const row of roles) byId.set(row.staff_id, [...(byId.get(row.staff_id) || []), row]);
  return staff.map((person) => ({ ...hydrateStaff(person), roles: (byId.get(person.id) || []).map((r) => r.role) }));
}

export function updateStaffFlags(db, id, changes, actor) {
  const current = db.prepare('SELECT * FROM staff WHERE id=?').get(id);
  if (!current) return null;
  const visible = changes.visible ?? Boolean(current.visible);
  const applicable = changes.applicable ?? Boolean(current.applicable);
  const titleOverride = changes.titleOverride === undefined ? current.title_override : changes.titleOverride;
  const officeLocationOverride = changes.officeLocationOverride === undefined ? current.office_location_override : changes.officeLocationOverride;
  const phoneOverride = changes.phoneOverride === undefined ? current.phone_override : changes.phoneOverride;
  const canSelfOptOut = changes.canSelfOptOut ?? Boolean(current.can_self_opt_out);
  const canChooseTagline = changes.canChooseTagline ?? Boolean(current.can_choose_tagline);
  const signatureIdentityMode = changes.signatureIdentityMode ?? current.signature_identity_mode;
  const selfOptedOut = canSelfOptOut ? Boolean(current.self_opted_out) : false;
  db.prepare(`UPDATE staff SET visible=?, applicable=?, title_override=?, office_location_override=?, phone_override=?,
      can_self_opt_out=?,self_opted_out=?,can_choose_tagline=?,signature_identity_mode=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(Number(visible), Number(applicable), titleOverride, officeLocationOverride, phoneOverride, Number(canSelfOptOut), Number(selfOptedOut), Number(canChooseTagline), signatureIdentityMode, id);
  audit(db, actor, 'staff.profile_updated', 'staff', id, { visible, applicable, titleOverride, officeLocationOverride, phoneOverride, canSelfOptOut, canChooseTagline, signatureIdentityMode });
  return hydrateStaff(db.prepare('SELECT * FROM staff WHERE id=?').get(id));
}

export function updateStaffProfilesBulk(db, profiles, actor) {
  const ids = profiles.map((profile) => profile.id);
  const placeholders = ids.map(() => '?').join(',');
  const existing = db.prepare(`SELECT id FROM staff WHERE id IN (${placeholders})`).all(...ids);
  if (existing.length !== ids.length) return null;

  const update = db.prepare(`UPDATE staff SET title_override=?,office_location_override=?,phone_override=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const profile of profiles) update.run(profile.titleOverride, profile.officeLocationOverride, profile.phoneOverride, profile.id);
    audit(db, actor, 'staff.profiles_bulk_updated', 'staff', null, { ids });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return listStaff(db).filter((person) => ids.includes(person.id));
}

export function updateStaffFlagsBulk(db, ids, changes, actor) {
  const uniqueIds = [...new Set(ids)];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const existing = db.prepare(`SELECT id FROM staff WHERE id IN (${placeholders})`).all(...uniqueIds);
  if (existing.length !== uniqueIds.length) return null;

  const assignments = [];
  const values = [];
  if (changes.visible !== undefined) { assignments.push('visible=?'); values.push(Number(changes.visible)); }
  if (changes.applicable !== undefined) { assignments.push('applicable=?'); values.push(Number(changes.applicable)); }
  if (changes.canSelfOptOut !== undefined) {
    assignments.push('can_self_opt_out=?');
    values.push(Number(changes.canSelfOptOut));
    if (!changes.canSelfOptOut) assignments.push('self_opted_out=0');
  }
  if (changes.canChooseTagline !== undefined) { assignments.push('can_choose_tagline=?'); values.push(Number(changes.canChooseTagline)); }
  if (changes.signatureIdentityMode !== undefined) { assignments.push('signature_identity_mode=?'); values.push(changes.signatureIdentityMode); }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE staff SET ${assignments.join(',')},updated_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`)
      .run(...values, ...uniqueIds);
    audit(db, actor, 'staff.bulk_updated', 'staff', null, { ids: uniqueIds, ...changes });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return listStaff(db).filter((person) => uniqueIds.includes(person.id));
}

export function updateSelfPreferences(db, email, changes) {
  const current = db.prepare('SELECT * FROM staff WHERE email=? COLLATE NOCASE').get(email);
  if (!current) return null;
  const selfOptedOut = changes.selfOptedOut === undefined ? Boolean(current.self_opted_out) : changes.selfOptedOut;
  const taglineKey = changes.taglineKey === undefined ? current.tagline_key : changes.taglineKey;
  if (changes.selfOptedOut !== undefined && !current.can_self_opt_out) {
    throw new HttpError(403, 'self_opt_out_not_allowed', 'IT has not enabled signature opt-out for this account.');
  }
  if (changes.taglineKey !== undefined && !current.can_choose_tagline) {
    throw new HttpError(403, 'tagline_choice_not_allowed', 'IT has not enabled tagline selection for this account.');
  }
  db.prepare('UPDATE staff SET self_opted_out=?,tagline_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(Number(selfOptedOut), taglineKey, current.id);
  audit(db, email, 'staff.preferences_updated', 'staff', current.id, {
    ...(changes.selfOptedOut === undefined ? {} : { selfOptedOut }),
    ...(changes.taglineKey === undefined ? {} : { taglineKey }),
  });
  return hydrateStaff(db.prepare('SELECT * FROM staff WHERE id=?').get(current.id));
}

export function deleteStaffBulk(db, ids, actor, protectedEmails = []) {
  const uniqueIds = [...new Set(ids)];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const staff = db.prepare(`SELECT id,email,first_name,last_name FROM staff WHERE id IN (${placeholders})`).all(...uniqueIds);
  if (staff.length !== uniqueIds.length) return null;
  if (staff.some((person) => person.email.toLowerCase() === actor.toLowerCase())) {
    throw new HttpError(409, 'cannot_delete_current_user', 'You cannot delete your own staff record while signed in.');
  }
  const protectedSet = new Set(protectedEmails.map((email) => String(email).toLowerCase()));
  if (staff.some((person) => protectedSet.has(person.email.toLowerCase()))) {
    throw new HttpError(409, 'protected_staff', 'Environment-seeded IT administrators cannot be deleted.');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`DELETE FROM staff WHERE id IN (${placeholders})`).run(...uniqueIds);
    audit(db, actor, 'staff.deleted', 'staff', null, { users: staff.map(({ id, email }) => ({ id, email })) });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return staff;
}

function hydrateStaff(person) {
  if (!person) return person;
  return {
    ...person,
    directory_title: person.entra_title || person.title,
    directory_office_location: person.entra_office_location || person.office_location,
    directory_phone: person.entra_phone || person.phone,
    title: person.title_override ?? (person.entra_title || person.title),
    office_location: person.office_location_override ?? (person.entra_office_location || person.office_location),
    phone: person.phone_override ?? (person.entra_phone || person.phone),
    visible: Boolean(person.visible),
    applicable: Boolean(person.applicable),
    can_self_opt_out: Boolean(person.can_self_opt_out),
    self_opted_out: Boolean(person.self_opted_out),
    can_choose_tagline: Boolean(person.can_choose_tagline),
    signature_identity_mode: person.signature_identity_mode || 'signed_in',
    signature_enabled: Boolean(person.applicable) && !Boolean(person.self_opted_out),
    directory_account_enabled: person.directory_account_enabled == null ? null : Boolean(person.directory_account_enabled),
  };
}

export function replaceRoles(db, id, roles, actor) {
  if (!db.prepare('SELECT 1 FROM staff WHERE id=?').get(id)) return null;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM role_grants WHERE staff_id=?').run(id);
    const insert = db.prepare('INSERT INTO role_grants(staff_id,role,granted_by) VALUES (?,?,?)');
    for (const role of roles) insert.run(id, role, actor);
    audit(db, actor, 'staff.roles_updated', 'staff', id, { roles });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return roles;
}

export function listAudiences(db) {
  const audiences = db.prepare(`SELECT a.*,COUNT(am.staff_id) AS member_count,
      EXISTS(SELECT 1 FROM deployments d WHERE d.audience_id=a.id AND d.status='published') AS actively_deployed,
      EXISTS(SELECT 1 FROM scheduled_deployments s WHERE s.audience_id=a.id AND s.status='scheduled') AS pending_schedule
    FROM audiences a LEFT JOIN audience_members am ON am.audience_id=a.id
    WHERE a.deleted_at IS NULL
    GROUP BY a.id ORDER BY a.name COLLATE NOCASE`).all();
  const members = db.prepare('SELECT audience_id,staff_id FROM audience_members ORDER BY audience_id,staff_id').all();
  const byAudience = new Map();
  for (const member of members) byAudience.set(member.audience_id, [...(byAudience.get(member.audience_id) || []), member.staff_id]);
  return audiences.map((audience) => ({ ...audience, member_count: Number(audience.member_count), actively_deployed: Boolean(audience.actively_deployed), pending_schedule: Boolean(audience.pending_schedule), member_ids: byAudience.get(audience.id) || [] }));
}

export function saveAudience(db, { id = null, name, description = '', memberIds = [] }, actor) {
  const uniqueMemberIds = [...new Set(memberIds)];
  if (uniqueMemberIds.length) {
    const placeholders = uniqueMemberIds.map(() => '?').join(',');
    const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM staff WHERE id IN (${placeholders})`).get(...uniqueMemberIds).count);
    if (count !== uniqueMemberIds.length) return null;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    let audienceId = id;
    if (id == null) {
      audienceId = Number(db.prepare('INSERT INTO audiences(name,description,created_by,updated_by) VALUES (?,?,?,?)').run(name, description, actor, actor).lastInsertRowid);
    } else {
      const result = db.prepare('UPDATE audiences SET name=?,description=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL').run(name, description, actor, id);
      if (!result.changes) { db.exec('ROLLBACK'); return null; }
      db.prepare('DELETE FROM audience_members WHERE audience_id=?').run(id);
    }
    const insert = db.prepare('INSERT INTO audience_members(audience_id,staff_id) VALUES (?,?)');
    for (const staffId of uniqueMemberIds) insert.run(audienceId, staffId);
    audit(db, actor, id == null ? 'audience.created' : 'audience.updated', 'audience', audienceId, { name, memberCount: uniqueMemberIds.length });
    db.exec('COMMIT');
    return listAudiences(db).find((audience) => audience.id === audienceId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function deleteAudience(db, audienceId, actor) {
  const audience = db.prepare('SELECT * FROM audiences WHERE id=? AND deleted_at IS NULL').get(audienceId);
  if (!audience) return null;
  if (db.prepare(`SELECT 1 FROM deployments WHERE audience_id=? AND status='published'`).get(audienceId)) {
    throw new HttpError(409, 'audience_is_active', 'Unpublish this audience’s active signature before deleting it.');
  }
  if (db.prepare(`SELECT 1 FROM scheduled_deployments WHERE audience_id=? AND status='scheduled'`).get(audienceId)) {
    throw new HttpError(409, 'audience_is_scheduled', 'Cancel this audience’s pending deployment before deleting it.');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM audience_members WHERE audience_id=?').run(audienceId);
    db.prepare(`UPDATE audiences
      SET historical_name=name,name=name||' [deleted #'||id||']',deleted_at=CURRENT_TIMESTAMP,updated_by=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).run(actor, audienceId);
    audit(db, actor, 'audience.deleted', 'audience', audienceId, { name: audience.name });
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listDeployments(db) {
  return db.prepare(`SELECT d.*,t.name AS template_name,COALESCE(a.historical_name,a.name) AS audience_name,
      CASE WHEN d.audience_id IS NULL THEN (SELECT COUNT(*) FROM staff WHERE applicable=1 AND self_opted_out=0) ELSE (SELECT COUNT(*) FROM audience_members am JOIN staff s ON s.id=am.staff_id WHERE am.audience_id=d.audience_id AND s.applicable=1 AND s.self_opted_out=0) END AS audience_size
    FROM deployments d
    JOIN signature_templates t ON t.id=d.template_id
    LEFT JOIN audiences a ON a.id=d.audience_id
    ORDER BY d.published_at DESC,d.id DESC`).all().map((deployment) => ({ ...deployment, audience_size: Number(deployment.audience_size) }));
}

export function getDeploymentForStaff(db, staffId) {
  return db.prepare(`SELECT d.*,t.name AS template_name,COALESCE(a.historical_name,a.name) AS audience_name
    FROM deployments d
    JOIN signature_templates t ON t.id=d.template_id
    LEFT JOIN audiences a ON a.id=d.audience_id
    WHERE d.status='published' AND (
      d.audience_id IS NULL OR EXISTS (
        SELECT 1 FROM audience_members am WHERE am.audience_id=d.audience_id AND am.staff_id=?
      )
    )
    ORDER BY d.priority DESC,d.published_at DESC,d.id DESC
    LIMIT 1`).get(staffId);
}

function assertDeploymentPriority(db, audienceId, priority) {
  const defaultDeployment = db.prepare(`SELECT priority FROM deployments WHERE status='published' AND audience_id IS NULL`).get();
  const lowestLimited = db.prepare(`SELECT MIN(priority) AS priority FROM deployments WHERE status='published' AND audience_id IS NOT NULL`).get();
  if (audienceId != null && defaultDeployment && priority <= defaultDeployment.priority) {
    throw new HttpError(409, 'priority_not_above_default', `Limited-audience priority must be higher than the active default priority (${defaultDeployment.priority}).`);
  }
  if (audienceId == null && lowestLimited.priority != null && priority >= lowestLimited.priority) {
    throw new HttpError(409, 'default_priority_too_high', `Default priority must be lower than every active limited-audience priority (currently as low as ${lowestLimited.priority}).`);
  }
}

function publishSnapshot(db, snapshot, actor, auditAction = 'template.published') {
  assertDeploymentPriority(db, snapshot.audience_id, snapshot.priority);
  if (snapshot.audience_id == null) {
    db.prepare(`UPDATE deployments SET status='superseded',superseded_at=CURRENT_TIMESTAMP WHERE status='published' AND audience_id IS NULL`).run();
  } else {
    db.prepare(`UPDATE deployments SET status='superseded',superseded_at=CURRENT_TIMESTAMP WHERE status='published' AND audience_id=?`).run(snapshot.audience_id);
  }
  const result = db.prepare(`INSERT INTO deployments(template_id,template_revision,html_snapshot,status,published_by,audience_id,priority) VALUES (?,?,?,'published',?,?,?)`)
    .run(snapshot.template_id, snapshot.template_revision, snapshot.html_snapshot, actor, snapshot.audience_id, snapshot.priority);
  audit(db, actor, auditAction, 'deployment', result.lastInsertRowid, {
    templateId: snapshot.template_id,
    revision: snapshot.template_revision,
    audienceId: snapshot.audience_id,
    priority: snapshot.priority,
    scheduledDeploymentId: snapshot.scheduled_deployment_id ?? undefined,
  });
  return db.prepare('SELECT * FROM deployments WHERE id=?').get(result.lastInsertRowid);
}

export function publishTemplate(db, templateId, actor, { audienceId = null, priority = 0 } = {}) {
  const template = db.prepare('SELECT * FROM signature_templates WHERE id=? AND deleted_at IS NULL').get(templateId);
  if (!template) return null;
  if (audienceId != null && !db.prepare('SELECT 1 FROM audiences WHERE id=? AND deleted_at IS NULL').get(audienceId)) return undefined;
  db.exec('BEGIN IMMEDIATE');
  try {
    const deployment = publishSnapshot(db, {
      template_id: template.id,
      template_revision: template.revision,
      html_snapshot: template.html,
      audience_id: audienceId,
      priority,
    }, actor);
    db.exec('COMMIT');
    return deployment;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listScheduledDeployments(db) {
  return db.prepare(`SELECT s.*,t.name AS template_name,COALESCE(a.historical_name,a.name) AS audience_name,
      CASE WHEN s.audience_id IS NULL THEN (SELECT COUNT(*) FROM staff WHERE applicable=1 AND self_opted_out=0) ELSE (SELECT COUNT(*) FROM audience_members am JOIN staff st ON st.id=am.staff_id WHERE am.audience_id=s.audience_id AND st.applicable=1 AND st.self_opted_out=0) END AS audience_size
    FROM scheduled_deployments s
    JOIN signature_templates t ON t.id=s.template_id
    LEFT JOIN audiences a ON a.id=s.audience_id
    ORDER BY CASE s.status WHEN 'scheduled' THEN 0 ELSE 1 END,s.scheduled_for ASC,s.id DESC`).all()
    .map((deployment) => ({ ...deployment, audience_size: Number(deployment.audience_size) }));
}

export function scheduleTemplate(db, templateId, actor, { audienceId = null, priority = 0, scheduledFor } = {}) {
  const template = db.prepare('SELECT * FROM signature_templates WHERE id=? AND deleted_at IS NULL').get(templateId);
  if (!template) return null;
  if (audienceId != null && !db.prepare('SELECT 1 FROM audiences WHERE id=? AND deleted_at IS NULL').get(audienceId)) return undefined;
  assertDeploymentPriority(db, audienceId, priority);
  const result = db.prepare(`INSERT INTO scheduled_deployments(template_id,template_revision,html_snapshot,audience_id,priority,scheduled_for,scheduled_by)
    VALUES (?,?,?,?,?,?,?)`).run(template.id, template.revision, template.html, audienceId, priority, scheduledFor, actor);
  audit(db, actor, 'deployment.scheduled', 'scheduled_deployment', result.lastInsertRowid, {
    templateId: template.id, revision: template.revision, audienceId, priority, scheduledFor,
  });
  return db.prepare('SELECT * FROM scheduled_deployments WHERE id=?').get(result.lastInsertRowid);
}

export function cancelScheduledDeployment(db, id, actor) {
  const scheduled = db.prepare('SELECT * FROM scheduled_deployments WHERE id=?').get(id);
  if (!scheduled) return null;
  if (scheduled.status !== 'scheduled') throw new HttpError(409, 'schedule_not_pending', 'Only a pending deployment can be cancelled.');
  db.prepare(`UPDATE scheduled_deployments SET status='cancelled',executed_at=CURRENT_TIMESTAMP WHERE id=?`).run(id);
  audit(db, actor, 'deployment.schedule_cancelled', 'scheduled_deployment', id, {
    templateId: scheduled.template_id, revision: scheduled.template_revision, audienceId: scheduled.audience_id, scheduledFor: scheduled.scheduled_for,
  });
  return db.prepare('SELECT * FROM scheduled_deployments WHERE id=?').get(id);
}

export function runDueScheduledDeployments(db, { now = Date.now(), logger = console } = {}) {
  const due = db.prepare(`SELECT * FROM scheduled_deployments WHERE status='scheduled' AND scheduled_for<=? ORDER BY scheduled_for,id`).all(new Date(now).toISOString());
  const results = [];
  for (const scheduled of due) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = db.prepare(`SELECT * FROM scheduled_deployments WHERE id=? AND status='scheduled'`).get(scheduled.id);
      if (!current) { db.exec('ROLLBACK'); continue; }
      const deployment = publishSnapshot(db, { ...current, scheduled_deployment_id: current.id }, current.scheduled_by, 'deployment.scheduled_published');
      db.prepare(`UPDATE scheduled_deployments SET status='published',executed_at=CURRENT_TIMESTAMP,deployment_id=?,error_message=NULL WHERE id=?`).run(deployment.id, current.id);
      db.exec('COMMIT');
      results.push({ id: current.id, status: 'published', deploymentId: deployment.id });
    } catch (error) {
      db.exec('ROLLBACK');
      const message = String(error?.message || error).slice(0, 500);
      db.prepare(`UPDATE scheduled_deployments SET status='failed',executed_at=CURRENT_TIMESTAMP,error_message=? WHERE id=? AND status='scheduled'`).run(message, scheduled.id);
      audit(db, 'system', 'deployment.schedule_failed', 'scheduled_deployment', scheduled.id, { message });
      logger.error?.(`Scheduled deployment ${scheduled.id} failed`, error);
      results.push({ id: scheduled.id, status: 'failed', error: message });
    }
  }
  return results;
}

export function updateDeploymentPriority(db, deploymentId, priority, actor) {
  const deployment = db.prepare(`SELECT * FROM deployments WHERE id=?`).get(deploymentId);
  if (!deployment) return null;
  if (deployment.status !== 'published') throw new HttpError(409, 'deployment_not_active', 'Only an active deployment’s priority can be changed.');
  assertDeploymentPriority(db, deployment.audience_id, priority);
  db.prepare('UPDATE deployments SET priority=? WHERE id=?').run(priority, deploymentId);
  audit(db, actor, 'deployment.priority_updated', 'deployment', deploymentId, { from: deployment.priority, to: priority, audienceId: deployment.audience_id });
  return db.prepare('SELECT * FROM deployments WHERE id=?').get(deploymentId);
}

export function unpublishDeployment(db, deploymentId, actor) {
  const deployment = db.prepare('SELECT * FROM deployments WHERE id=?').get(deploymentId);
  if (!deployment) return null;
  if (deployment.status !== 'published') throw new HttpError(409, 'deployment_not_active', 'This deployment is already inactive.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE deployments SET status='superseded',superseded_at=CURRENT_TIMESTAMP WHERE id=?`).run(deploymentId);
    audit(db, actor, 'deployment.unpublished', 'deployment', deploymentId, {
      templateId: deployment.template_id,
      revision: deployment.template_revision,
      audienceId: deployment.audience_id,
      priority: deployment.priority,
    });
    const unpublished = db.prepare('SELECT * FROM deployments WHERE id=?').get(deploymentId);
    db.exec('COMMIT');
    return unpublished;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function deleteTemplate(db, templateId, actor) {
  const template = db.prepare('SELECT * FROM signature_templates WHERE id=? AND deleted_at IS NULL').get(templateId);
  if (!template) return null;
  const first = db.prepare('SELECT MIN(id) AS id FROM signature_templates').get();
  if (template.id === first.id) throw new HttpError(409, 'protected_template', 'The original template cannot be deleted. It can still be edited.');
  if (db.prepare(`SELECT 1 FROM deployments WHERE template_id=? AND status='published'`).get(templateId)) {
    throw new HttpError(409, 'template_is_active', 'Replace this template’s active deployment before deleting it.');
  }
  if (db.prepare(`SELECT 1 FROM scheduled_deployments WHERE template_id=? AND status='scheduled'`).get(templateId)) {
    throw new HttpError(409, 'template_is_scheduled', 'Cancel this template’s pending deployment before deleting it.');
  }
  db.prepare('UPDATE signature_templates SET deleted_at=CURRENT_TIMESTAMP,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(actor, templateId);
  audit(db, actor, 'template.deleted', 'template', templateId, { name: template.name });
  return true;
}
