const tokenPattern = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;

export function orderedLocations(officeLocation, mappings = []) {
  const normalized = String(officeLocation ?? '').trim().toLocaleLowerCase('en-CA');
  const configured = normalized
    ? mappings.find((mapping) => String(mapping?.source ?? '').trim().toLocaleLowerCase('en-CA') === normalized)
    : mappings.find((mapping) => mapping?.isDefault === true);
  if (configured?.output) return configured.output;
  return String(officeLocation ?? '').trim();
}

function selectedDesignations(user, branding) {
  const selected = new Set(Array.isArray(user?.designation_keys) ? user.designation_keys : []);
  const options = Array.isArray(branding?.designationOptions) ? branding.designationOptions : [];
  return options.filter((item) => selected.has(item.key)).map((item) => item.label).join(', ');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderTemplate(html, user, tagline = null, branding = {}, customTags = {}) {
  const values = {
    firstName: user.first_name,
    lastName: user.last_name,
    displayName: `${user.first_name} ${user.last_name}`.trim(),
    title: user.title,
    phone: user.phone,
    officeLocation: user.office_location,
    locations: orderedLocations(user.office_location, branding.locationMappings),
    email: user.email,
    tagline: tagline?.label || '',
    designations: selectedDesignations(user, branding),
    organizationName: branding.organizationName || 'Your organization',
    ...branding.organizationInfo,
    ...customTags,
  };
  const rendered = html.replace(tokenPattern, (token, key) => (Object.hasOwn(values, key) ? escapeHtml(values[key]) : token));
  // Published legacy templates predate {{tagline}}. Keep their original default
  // phrase customizable without forcing Communications to republish immediately.
  return tagline?.legacy_match_text
    ? rendered.replaceAll(tagline.legacy_match_text, escapeHtml(values.tagline))
    : rendered;
}
