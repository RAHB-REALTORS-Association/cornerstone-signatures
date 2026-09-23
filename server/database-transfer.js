import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { HttpError } from './errors.js';
import { safeTemplateHtml } from './validation.js';
import { SCHEMA_VERSION } from './db.js';

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary');
const LEGACY_IMPORT_VERSION = 13;
const PREVIOUS_V2_VERSION = 200;
const TABLE_COLUMNS = Object.freeze({
  schema_migrations: ['version', 'applied_at'],
  staff: ['id', 'email', 'first_name', 'last_name', 'title', 'phone', 'visible', 'applicable', 'created_at', 'updated_at', 'entra_object_id', 'entra_title', 'title_override', 'office_location', 'entra_office_location', 'office_location_override', 'entra_phone', 'phone_override', 'directory_source', 'directory_synced_at', 'directory_account_enabled', 'can_self_opt_out', 'self_opted_out', 'can_choose_tagline', 'tagline_key', 'designation_keys_json', 'signature_identity_mode', 'photo_data_url'],
  role_grants: ['staff_id', 'role', 'granted_by', 'granted_at'],
  signature_templates: ['id', 'name', 'html', 'revision', 'created_by', 'updated_by', 'created_at', 'updated_at', 'source_mjml', 'deleted_at'],
  audiences: ['id', 'name', 'description', 'created_by', 'updated_by', 'created_at', 'updated_at', 'deleted_at', 'historical_name'],
  audience_members: ['audience_id', 'staff_id', 'added_at'],
  deployments: ['id', 'template_id', 'template_revision', 'html_snapshot', 'status', 'published_by', 'published_at', 'superseded_at', 'audience_id', 'priority'],
  scheduled_deployments: ['id', 'template_id', 'template_revision', 'html_snapshot', 'audience_id', 'priority', 'scheduled_for', 'status', 'scheduled_by', 'created_at', 'executed_at', 'deployment_id', 'error_message'],
  audit_log: ['id', 'actor_email', 'action', 'entity_type', 'entity_id', 'details_json', 'created_at'],
  app_settings: ['key', 'value_json', 'updated_by', 'updated_at'],
  taglines: ['id', 'key', 'label', 'sort_order', 'is_default', 'legacy_match_text', 'created_by', 'updated_by', 'created_at', 'updated_at'],
  signature_analytics: ['day', 'client_family', 'client_version', 'platform', 'usage_type', 'delivery_count', 'last_seen_at'],
});

function temporaryDatabase(prefix) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  return { directory, file: path.join(directory, 'siggen.sqlite') };
}

function inspectBackup(file, actor) {
  let candidate;
  try {
    candidate = new DatabaseSync(file);
    const integrity = candidate.prepare('PRAGMA quick_check').all();
    if (!integrity.length || integrity.some((row) => Object.values(row)[0] !== 'ok')) {
      throw new HttpError(400, 'invalid_database_backup', 'The uploaded SQLite database did not pass its integrity check.');
    }

    const versions = candidate.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version));
    const isV2 = versions.includes(SCHEMA_VERSION) && versions.every((version) => version <= SCHEMA_VERSION);
    const isPreviousV2 = versions.includes(PREVIOUS_V2_VERSION) && versions.every((version) => version <= SCHEMA_VERSION);
    const isLatestV1 = versions.includes(LEGACY_IMPORT_VERSION) && versions.every((version) => version <= LEGACY_IMPORT_VERSION);
    if (!isV2 && !isPreviousV2 && !isLatestV1) {
      throw new HttpError(400, 'incompatible_database_backup', 'Only Cornerstone Signatures v2 backups and latest Siggen schema-13 exports can be imported.');
    }

    if (!isV2) {
      const staffColumns = new Set(candidate.prepare('PRAGMA table_info(staff)').all().map((row) => row.name));
      if (!staffColumns.has('designation_keys_json')) candidate.exec("ALTER TABLE staff ADD COLUMN designation_keys_json TEXT NOT NULL DEFAULT '[]'");
      candidate.exec(`CREATE TABLE IF NOT EXISTS signature_analytics (
        day TEXT NOT NULL,client_family TEXT NOT NULL,client_version TEXT NOT NULL DEFAULT '',platform TEXT NOT NULL,
        usage_type TEXT NOT NULL CHECK (usage_type IN ('primary','alternate_from')),delivery_count INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY (day,client_family,client_version,platform,usage_type))`);
      if (isLatestV1) candidate.exec('DELETE FROM schema_migrations;');
      candidate.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)').run(SCHEMA_VERSION);
    }

    const tables = new Set(candidate.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    for (const table of Object.keys(TABLE_COLUMNS)) {
      if (!tables.has(table)) throw new HttpError(400, 'incompatible_database_backup', `The backup is missing the ${table} table.`);
    }

    candidate.exec('PRAGMA query_only = ON;');
    for (const [table, expectedColumns] of Object.entries(TABLE_COLUMNS)) {
      const columns = new Set(candidate.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name));
      if (expectedColumns.some((column) => !columns.has(column))) {
        throw new HttpError(400, 'incompatible_database_backup', `The ${table} table is not compatible with Cornerstone Signatures v2.`);
      }
    }

    const actorRole = candidate.prepare(`SELECT 1 FROM role_grants rg JOIN staff s ON s.id=rg.staff_id WHERE s.email=? COLLATE NOCASE AND rg.role='it_admin'`).get(actor);
    if (!actorRole) throw new HttpError(400, 'admin_lockout', 'This backup would remove your IT administrator access, so it cannot be restored.');
    for (const row of candidate.prepare('SELECT html FROM signature_templates').all()) safeTemplateHtml(row.html);
    for (const row of candidate.prepare('SELECT html_snapshot FROM deployments').all()) safeTemplateHtml(row.html_snapshot);
    for (const row of candidate.prepare('SELECT html_snapshot FROM scheduled_deployments').all()) safeTemplateHtml(row.html_snapshot);

    return Object.fromEntries(Object.keys(TABLE_COLUMNS).map((table) => [table, Number(candidate.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count)]));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid_database_backup', 'The uploaded file is not a valid Cornerstone Signatures SQLite backup.');
  } finally {
    candidate?.close();
  }
}

export async function exportDatabase(db) {
  const temporary = temporaryDatabase('siggen-export-');
  try {
    await backup(db, temporary.file);
    return readFileSync(temporary.file);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
}

export function importDatabase(db, input, actor) {
  if (!Buffer.isBuffer(input)) {
    throw new HttpError(400, 'invalid_database_backup', 'Select a valid SQLite backup exported from Cornerstone Signatures.');
  }
  // Normalize request-derived data to concrete primitive types before it
  // reaches filesystem and SQLite APIs. This prevents parameter tampering
  // from substituting arrays or objects with lookalike methods/properties.
  const bytes = Buffer.from(input);
  if (bytes.length < SQLITE_HEADER.length || !bytes.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
    throw new HttpError(400, 'invalid_database_backup', 'Select a valid SQLite backup exported from Cornerstone Signatures.');
  }
  if (typeof actor !== 'string' || !actor.trim() || actor.length > 320) {
    throw new HttpError(400, 'invalid_admin_identity', 'A valid administrator identity is required to import a database backup.');
  }
  const actorEmail = actor.trim().toLowerCase();

  const temporary = temporaryDatabase('siggen-import-');
  let attached = false;
  try {
    writeFileSync(temporary.file, bytes, { flag: 'wx' });
    const counts = inspectBackup(temporary.file, actorEmail);
    db.prepare('ATTACH DATABASE ? AS restore').run(temporary.file);
    attached = true;
    db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
    try {
      for (const table of ['role_grants', 'audience_members', 'scheduled_deployments', 'deployments', 'audit_log', 'app_settings', 'taglines', 'signature_analytics', 'signature_templates', 'audiences', 'staff', 'schema_migrations']) {
        db.exec(`DELETE FROM main."${table}"`);
      }
      for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
        const columnList = columns.map((column) => `"${column}"`).join(',');
        db.exec(`INSERT INTO main."${table}" (${columnList}) SELECT ${columnList} FROM restore."${table}"`);
      }
      db.prepare(`INSERT INTO audit_log(actor_email,action,entity_type,entity_id,details_json) VALUES (?,'database.imported','database','main',?)`)
        .run(actorEmail, JSON.stringify({ bytes: bytes.length, counts }));
      const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyErrors.length) throw new HttpError(400, 'invalid_database_backup', 'The backup contains invalid data relationships and was not restored.');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
    return counts;
  } finally {
    try {
      if (attached) db.exec('DETACH DATABASE restore');
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  }
}
