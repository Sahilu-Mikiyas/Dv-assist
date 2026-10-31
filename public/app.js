// Shared browser helpers for the staff app.

export async function api(method, path, body, contentType = 'application/json') {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': contentType } : {},
    body: body && contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  if (res.status === 401 && path !== '/api/login') {
    location.href = '/login.html';
    throw new Error('Login required');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && /authenticator/i.test(data.error ?? '')) {
    location.href = '/login.html?setup=1';
    throw new Error(data.error);
  }
  if (!res.ok) throw new Error([data.error, ...(data.details ?? [])].filter(Boolean).join('\n'));
  return data;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export function showError(err) {
  const box = $('#error');
  box.textContent = err ? err.message : '';
  box.hidden = !err;
  if (err) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export const label = (value) => (value ?? '').replaceAll('_', ' ');

export function personName(p) {
  return [p.lastName, p.firstName, p.middleName].filter(Boolean).join(', ');
}

export const STAGE_LABELS = {
  draft: 'Draft',
  checked: 'Abol done',
  verified: 'Tona done',
  approved: 'Approved · ready for card',
  card_issued: 'Card issued · file now',
  submitted: 'Submitted',
};

export const initials = (name) => (name ?? '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export function timeAgo(iso) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString();
}

// Loads the signed-in staff member, fills the sidebar and hides admin-only links for others.
export async function loadShell() {
  const me = await api('GET', '/api/me');
  if (me.stage === 'setup') {
    location.href = '/login.html?setup=1';
    throw new Error('Authenticator setup required');
  }
  $('#me-name').textContent = me.name;
  $('#me-role').textContent = me.role === 'admin' ? 'Admin' : 'Staff';
  $('#me-avatar').textContent = initials(me.name);
  for (const link of document.querySelectorAll('[data-admin]')) link.hidden = me.role !== 'admin';
  $('#logout').addEventListener('click', async () => {
    await api('POST', '/api/logout');
    location.href = '/login.html';
  });
  return me;
}

// Runs one server action at a time: locks the control, shows progress, reports errors.
let busy = false;
export async function run(control, action, after) {
  if (busy) return;
  busy = true;
  const original = control?.tagName === 'BUTTON' ? control.textContent : null;
  if (control) control.disabled = true;
  if (original) control.textContent = 'Working…';
  showError(null);
  try {
    await action();
  } catch (err) {
    showError(err);
  } finally {
    busy = false;
    if (original) control.textContent = original;
    if (control) control.disabled = false;
    after?.();
  }
}
