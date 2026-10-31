import { api, $, el, loadShell, run, showError } from '/staff/app.js';

let me;

function memberActions(m) {
  if (m.id === me.id) return el('span', { className: 'muted', textContent: 'You' });
  const patch = (body, confirmText) => async () => {
    if (confirmText && !confirm(confirmText)) return;
    await api('PATCH', `/api/staff/${m.id}`, body);
    await load();
  };
  const button = (text, handler) => {
    const b = el('button', { type: 'button', className: 'btn small', textContent: text });
    b.addEventListener('click', () => run(b, handler));
    return b;
  };
  return el('div', { className: 'row' },
    button(m.active ? 'Deactivate' : 'Reactivate', patch({ active: !m.active }, m.active ? `Deactivate ${m.name}? They are signed out at once.` : null)),
    button(m.role === 'admin' ? 'Make staff' : 'Make admin', patch({ role: m.role === 'admin' ? 'staff' : 'admin' })),
    m.hasAuthenticator ? button('Reset authenticator', patch({ resetAuthenticator: true }, `Reset ${m.name}'s authenticator? They set up a new one at next sign-in.`)) : null,
  );
}

async function load() {
  const members = await api('GET', '/api/staff');
  $('#team').replaceChildren(...members.map((m) => el('tr', {},
    el('td', {}, el('b', { textContent: m.name }), el('br'), el('span', { className: 'muted', textContent: m.email })),
    el('td', { textContent: m.role === 'admin' ? 'Admin' : 'Staff' }),
    el('td', {}, el('span', { className: m.hasAuthenticator ? 'chip submitted' : 'chip warn', textContent: m.hasAuthenticator ? 'Set up' : 'Not yet' })),
    el('td', {}, el('span', { className: m.active ? 'chip' : 'chip draft', textContent: m.active ? 'Active' : 'Deactivated' })),
    el('td', {}, memberActions(m)),
  )));
}

$('#add').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  run(form.querySelector('button'), async () => {
    await api('POST', '/api/staff', {
      name: form.elements.namedItem('name').value, email: form.email.value, role: form.role.value, password: form.password.value,
    });
    form.reset();
    await load();
  });
});

try {
  me = await loadShell();
  await load();
} catch (err) {
  showError(err);
}
