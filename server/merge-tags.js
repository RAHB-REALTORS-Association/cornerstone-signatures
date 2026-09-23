import { audit } from './db.js';
import { HttpError } from './errors.js';

export const BUILT_IN_MERGE_TAGS = Object.freeze([
  ['displayName', 'Staff display name', 'Staff'], ['firstName', 'Staff first name', 'Staff'], ['lastName', 'Staff last name', 'Staff'],
  ['title', 'Job title', 'Staff'], ['phone', 'Business phone', 'Staff'], ['email', 'Email address', 'Staff'],
  ['officeLocation', 'Entra office location', 'Staff'], ['locations', 'Mapped location string', 'Staff'], ['tagline', 'Selected approved tagline', 'Staff'],
  ['designations', 'Selected professional designations', 'Staff'],
  ['organizationName', 'Organization name', 'Organization'], ['websiteUrl', 'Website URL', 'Organization'],
  ['facebookUrl', 'Facebook URL', 'Organization'], ['instagramUrl', 'Instagram URL', 'Organization'],
  ['linkedinUrl', 'LinkedIn URL', 'Organization'], ['xUrl', 'X URL', 'Organization'], ['threadsUrl', 'Threads URL', 'Organization'],
  ['blueskyUrl', 'Bluesky URL', 'Organization'], ['youtubeUrl', 'YouTube URL', 'Organization'],
].map(([key, description, category]) => Object.freeze({ key, description, category, builtIn: true })));

const reservedKeys = new Set(BUILT_IN_MERGE_TAGS.map((tag) => tag.key.toLowerCase()));

function read(db) {
  const row = db.prepare("SELECT value_json FROM app_settings WHERE key='custom_merge_tags'").get();
  if (!row) return [];
  try {
    const value = JSON.parse(row.value_json);
    return Array.isArray(value) ? value.filter((tag) => tag && typeof tag.key === 'string' && typeof tag.value === 'string') : [];
  } catch { return []; }
}

function validateKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) {
    throw new HttpError(400, 'invalid_request', 'Tag key must start with a letter and contain only letters, numbers, or underscores (64 characters maximum).');
  }
  if (reservedKeys.has(key.toLowerCase())) throw new HttpError(409, 'reserved_merge_tag', 'Built-in merge tags cannot be overwritten.');
  return key;
}

function validateValue(value, field, max) {
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, 'invalid_request', `${field} must be a string no longer than ${max} characters.`);
  return value.trim();
}

function write(db, tags, actor) {
  db.prepare(`INSERT INTO app_settings(key,value_json,updated_by) VALUES ('custom_merge_tags',?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
    .run(JSON.stringify(tags), actor);
}

export function listCustomMergeTags(db) {
  return read(db).sort((left, right) => left.key.localeCompare(right.key));
}

export function customMergeTagValues(db) {
  return Object.fromEntries(listCustomMergeTags(db).map((tag) => [tag.key, tag.value]));
}

export function saveCustomMergeTag(db, { originalKey = null, key, value, description = '' }, actor) {
  const nextKey = validateKey(key);
  const nextValue = validateValue(value, 'Tag value', 10000);
  if (/^(?:javascript|data|vbscript)\s*:/i.test(nextValue)) {
    throw new HttpError(400, 'unsafe_merge_tag', 'Custom tag values cannot use executable or embedded URL schemes.');
  }
  const nextDescription = validateValue(description, 'Tag description', 240);
  const tags = read(db);
  const originalIndex = originalKey == null ? -1 : tags.findIndex((tag) => tag.key.toLowerCase() === String(originalKey).toLowerCase());
  if (originalKey != null && originalIndex < 0) return null;
  const duplicate = tags.findIndex((tag, index) => index !== originalIndex && tag.key.toLowerCase() === nextKey.toLowerCase());
  if (duplicate >= 0) throw new HttpError(409, 'merge_tag_exists', 'A custom merge tag with that key already exists.');
  const tag = { key: nextKey, value: nextValue, description: nextDescription };
  if (originalIndex < 0) tags.push(tag); else tags[originalIndex] = tag;
  write(db, tags, actor);
  audit(db, actor, originalIndex < 0 ? 'merge_tag.created' : 'merge_tag.updated', 'merge_tag', nextKey, { originalKey, description: nextDescription });
  return tag;
}

export function deleteCustomMergeTag(db, key, actor) {
  const tags = read(db);
  const index = tags.findIndex((tag) => tag.key.toLowerCase() === String(key).toLowerCase());
  if (index < 0) return null;
  const [deleted] = tags.splice(index, 1);
  write(db, tags, actor);
  audit(db, actor, 'merge_tag.deleted', 'merge_tag', deleted.key, { description: deleted.description || '' });
  return deleted;
}
