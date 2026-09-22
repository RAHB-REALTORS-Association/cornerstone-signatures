import { audit } from './db.js';
import { HttpError } from './errors.js';

export const DEFAULT_MANAGE_SETTINGS = Object.freeze({
  organizationName: 'Your organization',
  organizationInfo: Object.freeze({
    websiteUrl: '',
    facebookUrl: '',
    instagramUrl: '',
    linkedinUrl: '',
    xUrl: '',
    threadsUrl: '',
    blueskyUrl: '',
    youtubeUrl: '',
  }),
  locationMappings: Object.freeze([]),
  directorySchedule: Object.freeze({ enabled: false, intervalHours: 24, lastRunAt: null, lastResult: null }),
  directoryDefaults: Object.freeze({ visible: true, applicable: true, canSelfOptOut: false, canChooseTagline: false, signatureIdentityMode: 'signed_in' }),
});

const organizationInfoFields = Object.keys(DEFAULT_MANAGE_SETTINGS.organizationInfo);

function validateOrganizationInfo(value, fallback) {
  if (value === undefined) return fallback;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_request', 'organizationInfo must be an object.');
  return Object.fromEntries(organizationInfoFields.map((field) => {
    const candidate = value[field] ?? fallback[field] ?? '';
    if (typeof candidate !== 'string' || candidate.trim().length > 2048) {
      throw new HttpError(400, 'invalid_request', `organizationInfo.${field} must be a string no longer than 2048 characters.`);
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      let parsed;
      try { parsed = new URL(trimmed); } catch { throw new HttpError(400, 'invalid_request', `organizationInfo.${field} must be an absolute http or https URL.`); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new HttpError(400, 'invalid_request', `organizationInfo.${field} must be an absolute http or https URL.`);
    }
    return [field, trimmed];
  }));
}

function validateLocationMappings(value, fallback) {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length > 100) {
    throw new HttpError(400, 'invalid_request', 'locationMappings must be an array containing no more than 100 mappings.');
  }
  const seen = new Set();
  return value.map((mapping, index) => {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      throw new HttpError(400, 'invalid_request', `locationMappings[${index}] must be an object.`);
    }
    const source = typeof mapping.source === 'string' ? mapping.source.trim() : '';
    const output = typeof mapping.output === 'string' ? mapping.output.trim() : '';
    if (!source || source.length > 200) throw new HttpError(400, 'invalid_request', `locationMappings[${index}].source must be between 1 and 200 characters.`);
    if (!output || output.length > 500) throw new HttpError(400, 'invalid_request', `locationMappings[${index}].output must be between 1 and 500 characters.`);
    const key = source.toLocaleLowerCase('en-CA');
    if (seen.has(key)) throw new HttpError(400, 'invalid_request', 'Each Entra office location can be mapped only once.');
    seen.add(key);
    return { source, output };
  });
}

function bool(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new HttpError(400, 'invalid_request', `${name} must be a boolean.`);
  return value;
}

export function validateManageSettings(value, current = DEFAULT_MANAGE_SETTINGS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_request', 'Manage settings must be an object.');
  const organizationName = value.organizationName ?? current.organizationName;
  if (typeof organizationName !== 'string' || !organizationName.trim() || organizationName.trim().length > 160) {
    throw new HttpError(400, 'invalid_request', 'Organization name must be between 1 and 160 characters.');
  }
  const schedule = value.directorySchedule ?? current.directorySchedule;
  const intervalHours = Number(schedule.intervalHours ?? current.directorySchedule.intervalHours);
  if (!Number.isInteger(intervalHours) || ![1, 6, 12, 24, 48, 168].includes(intervalHours)) {
    throw new HttpError(400, 'invalid_request', 'Directory sync interval must be 1, 6, 12, 24, 48, or 168 hours.');
  }
  const defaults = value.directoryDefaults ?? current.directoryDefaults;
  const signatureIdentityMode = defaults.signatureIdentityMode ?? current.directoryDefaults.signatureIdentityMode;
  if (!['signed_in', 'mailbox'].includes(signatureIdentityMode)) throw new HttpError(400, 'invalid_request', 'Default signature identity must be signed_in or mailbox.');
  return {
    organizationName: organizationName.trim(),
    organizationInfo: validateOrganizationInfo(value.organizationInfo, current.organizationInfo),
    locationMappings: validateLocationMappings(value.locationMappings, current.locationMappings),
    directorySchedule: {
      enabled: bool(schedule.enabled, current.directorySchedule.enabled, 'directorySchedule.enabled'),
      intervalHours,
      lastRunAt: current.directorySchedule.lastRunAt ?? null,
      lastResult: current.directorySchedule.lastResult ?? null,
    },
    directoryDefaults: {
      visible: bool(defaults.visible, current.directoryDefaults.visible, 'directoryDefaults.visible'),
      applicable: bool(defaults.applicable, current.directoryDefaults.applicable, 'directoryDefaults.applicable'),
      canSelfOptOut: bool(defaults.canSelfOptOut, current.directoryDefaults.canSelfOptOut, 'directoryDefaults.canSelfOptOut'),
      canChooseTagline: bool(defaults.canChooseTagline, current.directoryDefaults.canChooseTagline, 'directoryDefaults.canChooseTagline'),
      signatureIdentityMode,
    },
  };
}

export function getManageSettings(db) {
  const row = db.prepare("SELECT value_json,updated_at,updated_by FROM app_settings WHERE key='manage_settings'").get();
  let settings = DEFAULT_MANAGE_SETTINGS;
  if (row) {
    try {
      const stored = JSON.parse(row.value_json);
      const storedRunAt = typeof stored?.directorySchedule?.lastRunAt === 'string' && Number.isFinite(Date.parse(stored.directorySchedule.lastRunAt))
        ? stored.directorySchedule.lastRunAt : null;
      const storedResult = stored?.directorySchedule?.lastResult && typeof stored.directorySchedule.lastResult === 'object'
        ? stored.directorySchedule.lastResult : null;
      settings = validateManageSettings(stored, {
        ...DEFAULT_MANAGE_SETTINGS,
        directorySchedule: { ...DEFAULT_MANAGE_SETTINGS.directorySchedule, lastRunAt: storedRunAt, lastResult: storedResult },
      });
    } catch { settings = DEFAULT_MANAGE_SETTINGS; }
  }
  return { ...settings, updatedAt: row?.updated_at ?? null, updatedBy: row?.updated_by ?? null };
}

function write(db, settings, actor) {
  const stored = { organizationName: settings.organizationName, organizationInfo: settings.organizationInfo, locationMappings: settings.locationMappings, directorySchedule: settings.directorySchedule, directoryDefaults: settings.directoryDefaults };
  db.prepare(`INSERT INTO app_settings(key,value_json,updated_by) VALUES ('manage_settings',?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
    .run(JSON.stringify(stored), actor);
  return getManageSettings(db);
}

export function saveManageSettings(db, value, actor) {
  const current = getManageSettings(db);
  const settings = validateManageSettings(value, current);
  const saved = write(db, settings, actor);
  audit(db, actor, 'settings.updated', 'settings', 'manage_settings', {
    organizationName: saved.organizationName,
    organizationInfo: saved.organizationInfo,
    locationMappings: saved.locationMappings,
    directorySchedule: { enabled: saved.directorySchedule.enabled, intervalHours: saved.directorySchedule.intervalHours },
    directoryDefaults: saved.directoryDefaults,
  });
  return saved;
}

export function recordScheduledSync(db, result, actor = 'system') {
  const current = getManageSettings(db);
  current.directorySchedule = { ...current.directorySchedule, lastRunAt: new Date().toISOString(), lastResult: result };
  return write(db, current, actor);
}
