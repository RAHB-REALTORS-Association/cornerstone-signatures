import { HttpError } from './errors.js';

function hydrate(row) {
  return row ? { ...row, is_default: Boolean(row.is_default) } : row;
}

export function listTaglines(db) {
  return db.prepare('SELECT * FROM taglines ORDER BY sort_order,id').all().map(hydrate);
}

export function isTaglineKey(db, value) {
  return Boolean(db.prepare('SELECT 1 FROM taglines WHERE key=? COLLATE NOCASE').get(value));
}

export function taglineForUser(db, user) {
  const selected = user?.tagline_key
    ? db.prepare('SELECT * FROM taglines WHERE key=? COLLATE NOCASE').get(user.tagline_key)
    : null;
  const resolved = selected || db.prepare('SELECT * FROM taglines ORDER BY is_default DESC,sort_order,id LIMIT 1').get();
  if (!resolved) return null;
  const legacy = db.prepare('SELECT legacy_match_text FROM taglines WHERE legacy_match_text IS NOT NULL ORDER BY id LIMIT 1').get();
  return hydrate({ ...resolved, legacy_match_text: legacy?.legacy_match_text || null });
}

function slug(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'tagline';
}

function unusedKey(db, label) {
  const base = slug(label);
  let key = base;
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM taglines WHERE key=? COLLATE NOCASE').get(key)) key = `${base}-${suffix++}`;
  return key;
}

export function saveTagline(db, { id = null, label, isDefault = false }, actor) {
  const current = id == null ? null : db.prepare('SELECT * FROM taglines WHERE id=?').get(id);
  if (id != null && !current) return null;
  if (current?.is_default && !isDefault) {
    throw new HttpError(409, 'default_tagline_required', 'Choose another default tagline before removing default status from this one.');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (isDefault) db.prepare('UPDATE taglines SET is_default=0 WHERE is_default=1 AND id<>?').run(id ?? -1);
    let taglineId = id;
    if (id == null) {
      const order = Number(db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next FROM taglines').get().next);
      const makeDefault = isDefault || !db.prepare('SELECT 1 FROM taglines WHERE is_default=1').get();
      taglineId = Number(db.prepare(`INSERT INTO taglines
        (key,label,sort_order,is_default,legacy_match_text,created_by,updated_by) VALUES (?,?,?,?,NULL,?,?)`)
        .run(unusedKey(db, label), label, order, Number(makeDefault), actor, actor).lastInsertRowid);
      writeAudit(db, actor, 'tagline.created', taglineId, { label, isDefault: makeDefault });
    } else {
      db.prepare('UPDATE taglines SET label=?,is_default=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(label, Number(isDefault), actor, id);
      writeAudit(db, actor, 'tagline.updated', id, { label, isDefault });
    }
    db.exec('COMMIT');
    return hydrate(db.prepare('SELECT * FROM taglines WHERE id=?').get(taglineId));
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function deleteTagline(db, id, actor) {
  const current = db.prepare('SELECT * FROM taglines WHERE id=?').get(id);
  if (!current) return null;
  if (current.is_default) throw new HttpError(409, 'default_tagline_cannot_be_deleted', 'The default tagline cannot be deleted. Choose another default first.');
  const fallback = db.prepare('SELECT * FROM taglines WHERE is_default=1').get();
  if (!fallback) throw new HttpError(409, 'default_tagline_required', 'A default tagline is required.');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (current.legacy_match_text && !fallback.legacy_match_text) {
      db.prepare('UPDATE taglines SET legacy_match_text=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(current.legacy_match_text, actor, fallback.id);
    }
    const reassigned = Number(db.prepare('UPDATE staff SET tagline_key=?,updated_at=CURRENT_TIMESTAMP WHERE tagline_key=? COLLATE NOCASE').run(fallback.key, current.key).changes);
    db.prepare('DELETE FROM taglines WHERE id=?').run(id);
    writeAudit(db, actor, 'tagline.deleted', id, { key: current.key, label: current.label, reassigned });
    db.exec('COMMIT');
    return { ...hydrate(current), reassigned };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function writeAudit(db, actor, action, id, details) {
  db.prepare('INSERT INTO audit_log(actor_email,action,entity_type,entity_id,details_json) VALUES (?,?,?,?,?)')
    .run(actor, action, 'tagline', String(id), JSON.stringify(details));
}
