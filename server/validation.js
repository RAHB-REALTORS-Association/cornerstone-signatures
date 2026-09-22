import { HttpError } from './errors.js';

export function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_request', 'A JSON object is required.');
  }
  return value;
}

export function stringField(body, name, { required = false, max = 255 } = {}) {
  const value = body[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) {
    throw new HttpError(400, 'invalid_request', `${name} must be a${required ? ' non-empty' : ''} string no longer than ${max} characters.`);
  }
  return value.trim();
}

export function booleanField(body, name) {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new HttpError(400, 'invalid_request', `${name} must be a boolean.`);
  return value;
}

export function integerId(value, name = 'id') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'invalid_request', `${name} must be a positive integer.`);
  return id;
}

export function rolesField(body) {
  if (!Array.isArray(body.roles)) throw new HttpError(400, 'invalid_request', 'roles must be an array.');
  const allowed = new Set(['it_admin', 'communications_editor']);
  const roles = [...new Set(body.roles)];
  if (roles.some((role) => !allowed.has(role))) throw new HttpError(400, 'invalid_request', 'roles contains an unsupported role.');
  return roles;
}

export function safeTemplateHtml(html) {
  const forbidden = [
    { pattern: /<\s*(script|iframe|object|embed)\b/i, reason: 'executable or embedded elements are not allowed' },
    { pattern: /\s+on[a-z]+\s*=/i, reason: 'inline event handlers are not allowed' },
    { pattern: /(?:javascript|data)\s*:/i, reason: 'javascript: and data: URLs are not allowed' },
  ];
  for (const rule of forbidden) {
    if (rule.pattern.test(html)) throw new HttpError(400, 'unsafe_template', `Template rejected: ${rule.reason}.`);
  }
  for (const [, attribute, , quotedValue, bareValue] of html.matchAll(/\b(href|src)\s*=\s*(?:(["'])(.*?)\2|([^\s>]+))/gi)) {
    const value = quotedValue ?? bareValue;
    const url = value.trim();
    if (/^{{\s*[a-zA-Z][a-zA-Z0-9_]*\s*}}$/.test(url)) continue;
    if (!/^(https?:|mailto:|tel:)/i.test(url)) {
      throw new HttpError(400, 'unsafe_template', `Template rejected: unsupported ${attribute.toLowerCase()} URL scheme.`);
    }
  }
  return html;
}
