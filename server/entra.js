import { HttpError } from './errors.js';
import { audit } from './db.js';

export const DEFAULT_DIRECTORY_FILTERS = Object.freeze({
  enabledOnly: true,
  membersOnly: true,
  allowedDomains: [],
  excludedEmailPatterns: [],
});

function normalizeList(value, name, maxItems = 50) {
  if (!Array.isArray(value) || value.length > maxItems) throw new HttpError(400, 'invalid_request', `${name} must be an array with no more than ${maxItems} entries.`);
  return [...new Set(value.map((item) => {
    if (typeof item !== 'string' || !item.trim() || item.length > 200) throw new HttpError(400, 'invalid_request', `${name} entries must be non-empty strings no longer than 200 characters.`);
    return item.trim().toLowerCase();
  }))];
}

export function validateDirectoryFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_request', 'Directory filters must be an object.');
  const enabledOnly = value.enabledOnly ?? DEFAULT_DIRECTORY_FILTERS.enabledOnly;
  const membersOnly = value.membersOnly ?? DEFAULT_DIRECTORY_FILTERS.membersOnly;
  if (typeof enabledOnly !== 'boolean' || typeof membersOnly !== 'boolean') throw new HttpError(400, 'invalid_request', 'enabledOnly and membersOnly must be booleans.');
  return {
    enabledOnly,
    membersOnly,
    allowedDomains: normalizeList(value.allowedDomains ?? DEFAULT_DIRECTORY_FILTERS.allowedDomains, 'allowedDomains', 20).map((domain) => domain.replace(/^@/, '')),
    excludedEmailPatterns: normalizeList(value.excludedEmailPatterns ?? [], 'excludedEmailPatterns'),
  };
}

export function getDirectorySettings(db) {
  const row = db.prepare("SELECT value_json,updated_at,updated_by FROM app_settings WHERE key='entra_directory_filters'").get();
  if (!row) return { filters: { ...DEFAULT_DIRECTORY_FILTERS }, updatedAt: null, updatedBy: null };
  try { return { filters: validateDirectoryFilters(JSON.parse(row.value_json)), updatedAt: row.updated_at, updatedBy: row.updated_by }; }
  catch { return { filters: { ...DEFAULT_DIRECTORY_FILTERS }, updatedAt: row.updated_at, updatedBy: row.updated_by }; }
}

export function saveDirectorySettings(db, filters, actor) {
  const normalized = validateDirectoryFilters(filters);
  db.prepare(`INSERT INTO app_settings(key,value_json,updated_by) VALUES ('entra_directory_filters',?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
    .run(JSON.stringify(normalized), actor);
  audit(db, actor, 'directory.filters_updated', 'settings', 'entra_directory_filters', normalized);
  return getDirectorySettings(db);
}

export function blockDirectoryStaff(db, staffId, actor, protectedEmails = []) {
  const staff = db.prepare('SELECT id,email,first_name,last_name FROM staff WHERE id=?').get(staffId);
  if (!staff) return null;
  const email = staff.email.toLowerCase();
  if (email === actor.toLowerCase()) {
    throw new HttpError(409, 'cannot_block_current_user', 'You cannot block your own staff record while signed in.');
  }
  const protectedSet = new Set(protectedEmails.map((value) => String(value).toLowerCase()));
  if (protectedSet.has(email)) {
    throw new HttpError(409, 'protected_staff', 'Environment-seeded IT administrators cannot be blocked.');
  }
  const current = getDirectorySettings(db).filters;
  const alreadyExcluded = current.excludedEmailPatterns.some((pattern) => pattern.toLowerCase() === email);
  const filters = validateDirectoryFilters({
    ...current,
    excludedEmailPatterns: alreadyExcluded ? current.excludedEmailPatterns : [...current.excludedEmailPatterns, email],
  });

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO app_settings(key,value_json,updated_by) VALUES ('entra_directory_filters',?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
      .run(JSON.stringify(filters), actor);
    db.prepare('DELETE FROM staff WHERE id=?').run(staff.id);
    audit(db, actor, 'staff.blocked', 'staff', staff.id, { email, exclusionAdded: !alreadyExcluded });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { staff, filters };
}

function wildcard(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export function filterDirectoryUsers(users, filters) {
  const rules = validateDirectoryFilters(filters);
  const exclusions = rules.excludedEmailPatterns.map(wildcard);
  const accepted = [];
  let filtered = 0;
  for (const user of users) {
    const email = String(user.mail || user.userPrincipalName || '').trim().toLowerCase();
    const domain = email.split('@')[1] || '';
    if (!email || (rules.enabledOnly && user.accountEnabled === false) || (rules.membersOnly && user.userType && user.userType !== 'Member')
      || (rules.allowedDomains.length && !rules.allowedDomains.includes(domain)) || exclusions.some((rule) => rule.test(email))) {
      filtered += 1;
      continue;
    }
    accepted.push({ ...user, email });
  }
  return { accepted, filtered };
}

export function syncDirectoryUsers(db, users, filters, actor, defaults = {}) {
  const { accepted, filtered } = filterDirectoryUsers(users, filters);
  let created = 0;
  let updated = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const byObjectId = db.prepare('SELECT * FROM staff WHERE entra_object_id=?');
    const byEmail = db.prepare('SELECT * FROM staff WHERE email=? COLLATE NOCASE');
    const insert = db.prepare(`INSERT INTO staff(email,first_name,last_name,title,phone,office_location,entra_object_id,entra_title,entra_phone,entra_office_location,directory_source,directory_synced_at,directory_account_enabled,photo_data_url,visible,applicable,can_self_opt_out,can_choose_tagline,signature_identity_mode)
      VALUES (?,?,?,?,?,?,?,?,?,?,'entra',CURRENT_TIMESTAMP,?,?,?,?,?,?,?)`);
    const update = db.prepare(`UPDATE staff SET email=?,first_name=?,last_name=?,entra_object_id=?,entra_title=?,entra_phone=?,entra_office_location=?,directory_source='entra',directory_synced_at=CURRENT_TIMESTAMP,directory_account_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`);
    const updatePhoto = db.prepare('UPDATE staff SET photo_data_url=? WHERE id=?');
    for (const user of accepted) {
      const firstName = String(user.givenName || '').trim();
      const lastName = String(user.surname || '').trim();
      const title = String(user.jobTitle || '').trim();
      const phone = String(user.businessPhones?.[0] || user.mobilePhone || '').trim();
      const officeLocation = String(user.officeLocation || '').trim();
      const existing = (user.id && byObjectId.get(user.id)) || byEmail.get(user.email);
      if (!existing) {
        const displayParts = String(user.displayName || '').trim().split(/\s+/);
        insert.run(user.email, firstName || displayParts[0] || user.email.split('@')[0], lastName || displayParts.slice(1).join(' '), title, phone, officeLocation, user.id || null, title, phone, officeLocation, Number(user.accountEnabled !== false), user.photoDataUrl ?? null, Number(defaults.visible ?? true), Number(defaults.applicable ?? true), Number(defaults.canSelfOptOut ?? false), Number(defaults.canChooseTagline ?? false), defaults.signatureIdentityMode ?? 'signed_in');
        created += 1;
      } else {
        update.run(user.email, firstName || existing.first_name, lastName || existing.last_name, user.id || existing.entra_object_id, title, phone, officeLocation, Number(user.accountEnabled !== false), existing.id);
        // A missing property means Graph failed transiently, so retain the last
        // good image. An explicit null means the user no longer has a photo.
        if (user.photoDataUrl !== undefined) updatePhoto.run(user.photoDataUrl, existing.id);
        updated += 1;
      }
    }
    audit(db, actor, 'directory.sync_completed', 'directory', 'entra', { fetched: users.length, matched: accepted.length, filtered, created, updated });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { fetched: users.length, matched: accepted.length, filtered, created, updated };
}

export function createGraphDirectoryProvider({ tenantId, clientId, clientSecret, fetchImpl = fetch }) {
  if (!tenantId || !clientId || !clientSecret) return null;
  return async function readUsers(filters = DEFAULT_DIRECTORY_FILTERS) {
    const tokenResponse = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    });
    if (!tokenResponse.ok) throw new HttpError(502, 'graph_auth_failed', 'Microsoft Graph application authentication failed.');
    const { access_token: accessToken } = await tokenResponse.json();
    const users = [];
    let url = 'https://graph.microsoft.com/v1.0/users?$select=id,accountEnabled,userType,givenName,surname,displayName,jobTitle,officeLocation,mail,userPrincipalName,businessPhones,mobilePhone&$top=999';
    while (url) {
      const response = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new HttpError(502, 'graph_directory_failed', `Microsoft Graph directory request failed with HTTP ${response.status}.`);
      const page = await response.json();
      users.push(...(Array.isArray(page.value) ? page.value : []));
      url = page['@odata.nextLink'] || null;
    }
    // User.Read.All already grants application access to profile photos. Cache
    // a small Graph thumbnail locally so browsers never need a Graph token and
    // directory pages do not fan out into one request per row.
    const { accepted } = filterDirectoryUsers(users, filters);
    const originalsById = new Map(users.filter((user) => user.id).map((user) => [user.id, user]));
    let next = 0;
    const workers = Array.from({ length: Math.min(8, accepted.length) }, async () => {
      while (next < accepted.length) {
        const user = accepted[next++];
        if (!user.id) continue;
        const original = originalsById.get(user.id) || user;
        try {
          const response = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user.id)}/photos/48x48/$value`, {
            headers: { authorization: `Bearer ${accessToken}` },
          });
          if (response.status === 404) {
            original.photoDataUrl = null;
            continue;
          }
          if (!response.ok) continue;
          const mime = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
          if (!['image/jpeg', 'image/png'].includes(mime)) continue;
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 0 && bytes.length <= 256 * 1024) original.photoDataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
        } catch {
          // A photo should never make the otherwise-successful directory sync
          // fail. Leaving the property undefined preserves the cached image.
        }
      }
    });
    await Promise.all(workers);
    return users;
  };
}
