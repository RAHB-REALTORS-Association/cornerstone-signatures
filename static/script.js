(() => {
  const byId = (id) => document.getElementById(id);
  const select = byId('userSelect');
  const preview = byId('signaturePreview');
  const selfService = byId('selfService');
  const optOutRow = byId('selfOptOutRow');
  const optOut = byId('selfOptOut');
  const taglineRow = byId('selfTaglineRow');
  const tagline = byId('selfTagline');
  const designationsRow = byId('selfDesignationsRow');
  const designations = byId('selfDesignations');
  const status = byId('selfServiceStatus');
  let directory;

  function applyTheme(dark) {
    document.body.classList.toggle('dark-mode', dark);
    byId('themeToggle').querySelector('.theme-icon').textContent = dark ? '☀️' : '🌙';
  }

  async function loadSignature() {
    preview.hidden = true;
    preview.replaceChildren();
    if (!select.value) return;
    try {
      const response = await fetch(`/api/picker/signature?email=${encodeURIComponent(select.value)}`, { credentials: 'same-origin' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'The signature is not available.');
      preview.innerHTML = body.html;
      preview.hidden = false;
    } catch (error) {
      preview.textContent = error.message;
      preview.hidden = false;
    }
  }

  function renderPreferences(user) {
    const mine = user && directory.currentUser && user.email.toLowerCase() === directory.currentUser.email.toLowerCase();
    const hasDesignations = Boolean(directory.designationOptions?.length);
    selfService.hidden = !mine || (!user.can_self_opt_out && !user.can_choose_tagline && !hasDesignations);
    optOutRow.hidden = !user?.can_self_opt_out;
    taglineRow.hidden = !user?.can_choose_tagline;
    designationsRow.hidden = !hasDesignations;
    if (!mine) return;
    optOut.checked = Boolean(user.self_opted_out);
    tagline.replaceChildren(...directory.taglineOptions.map((item) => new Option(item.label, item.key, false, item.key === user.tagline_key)));
    const selected = new Set(user.designation_keys || []);
    designations.replaceChildren(...(directory.designationOptions || []).map((item) => {
      const input = document.createElement('input');
      input.type = 'checkbox'; input.value = item.key; input.checked = selected.has(item.key);
      const label = document.createElement('label');
      const span = document.createElement('span'); span.textContent = item.label;
      label.append(input, span);
      return label;
    }));
  }

  async function loadDirectory() {
    const response = await fetch('/api/picker', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not load the managed directory.');
    directory = await response.json();
    document.title = `${directory.branding.organizationName} — Cornerstone Signatures`;
    byId('signaturePageDescription').textContent = `Preview the approved signature managed by ${directory.branding.organizationName}.`;
    byId('adminLink').hidden = !directory.canAccessAdmin;
    select.append(...directory.users.map((user) => new Option(`${user.first_name} ${user.last_name}`.trim() || user.email, user.email)));
    const selected = directory.currentUser || directory.users[0];
    if (selected) select.value = selected.email;
    renderPreferences(selected);
    await loadSignature();
  }

  select.addEventListener('change', () => {
    renderPreferences(directory.users.find((user) => user.email === select.value));
    loadSignature();
  });
  byId('saveSelfService').addEventListener('click', async () => {
    status.textContent = 'Saving…';
    const payload = { designationKeys: [...designations.querySelectorAll('input:checked')].map((input) => input.value) };
    if (!optOutRow.hidden) payload.selfOptedOut = optOut.checked;
    if (!taglineRow.hidden) payload.taglineKey = tagline.value;
    const response = await fetch('/api/picker/preferences', {
      method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) { status.textContent = body.message || 'Could not save preferences.'; return; }
    directory.currentUser = body.currentUser;
    const index = directory.users.findIndex((user) => user.email === body.currentUser.email);
    if (index >= 0) directory.users[index] = body.currentUser;
    status.textContent = 'Saved.';
    await loadSignature();
  });
  const savedTheme = localStorage.getItem('cornerstone-signatures:theme') === 'dark';
  applyTheme(savedTheme);
  byId('themeToggle').addEventListener('click', () => {
    const dark = !document.body.classList.contains('dark-mode');
    localStorage.setItem('cornerstone-signatures:theme', dark ? 'dark' : 'light');
    applyTheme(dark);
  });
  loadDirectory().catch((error) => { preview.textContent = error.message; preview.hidden = false; });
})();
