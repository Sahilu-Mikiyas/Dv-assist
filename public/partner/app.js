// Shared helpers for the partner pages.

import { $ } from '/dom.js';

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/api/partner/login') {
    location.href = '/partner/login.html';
    throw new Error('Sign in first');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.details ?? [data.error ?? 'Something went wrong. Try again.']).join('\n'));
  return data;
}

export function showError(err) {
  const box = $('#error');
  box.textContent = err ? err.message : '';
  box.hidden = !err;
  if (err) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// Loads the signed-in partner and fills the header.
export async function loadPartner() {
  const me = await api('GET', '/api/partner');
  $('#org-name').textContent = me.organisation;
  $('#sign-out').addEventListener('click', async () => {
    await api('POST', '/api/partner/logout').catch(() => {});
    location.href = '/partner/login.html';
  });
  return me;
}

export const PACKAGE_NAMES = { self: 'Self-guided', managed: 'Managed', assisted: 'Assisted', vip: 'VIP' };
