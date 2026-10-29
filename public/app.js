// Shared browser helpers.

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
  if (!res.ok) throw new Error([data.error, ...(data.details ?? [])].filter(Boolean).join('\n'));
  return data;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function showError(err) {
  const box = $('#error');
  box.textContent = err ? err.message : '';
  box.hidden = !err;
}

export const label = (value) => value.replaceAll('_', ' ');

export function personName(p) {
  return [p.lastName, p.firstName, p.middleName].filter(Boolean).join(', ');
}
