// Admin: approve referral partners, issue or reset their sign-in codes, suspend them, and follow up introductions.

import { api, $, el, loadShell, PACKAGE_LABELS, run, showError, timeAgo } from '/staff/app.js';

const TYPES = { shop: 'Shop / internet café', school: 'School / tutor', faith: 'Faith community', community: 'Iddir / community', other: 'Other' };
const STATUS = { pending: ['Waiting for approval', 'warn'], active: ['Active', 'submitted'], suspended: ['Suspended', 'draft'] };

function showCode(partner, code) {
  $('#code-title').textContent = `Sign-in code for ${partner.organisation}`;
  $('#code-value').textContent = code;
  $('#code-box').hidden = false;
  $('#code-box').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function actions(p) {
  const button = (text, handler, primary = false) => {
    const b = el('button', { type: 'button', className: `btn small${primary ? ' primary' : ''}`, textContent: text });
    b.addEventListener('click', () => run(b, handler));
    return b;
  };
  const issue = (confirmText) => async () => {
    if (confirmText && !confirm(confirmText)) return;
    const { code, partner } = await api('POST', `/api/partners/${p.id}/code`);
    await load();
    showCode(partner, code);
  };
  const status = (value, confirmText) => async () => {
    if (confirmText && !confirm(confirmText)) return;
    await api('POST', `/api/partners/${p.id}/status`, { status: value });
    await load();
  };
  if (p.status === 'pending') return el('div', { className: 'row' }, button('Approve', issue(`Approve ${p.organisation}? Only after a verification call.`), true));
  if (p.status === 'suspended') return el('div', { className: 'row' }, button('Reactivate', status('active')));
  return el('div', { className: 'row' },
    button('New code', issue(`Issue a new code for ${p.organisation}? Their current code stops working.`)),
    button('Suspend', status('suspended', `Suspend ${p.organisation}? They are signed out and their links stop counting.`)));
}

async function load() {
  const [partners, intros] = await Promise.all([api('GET', '/api/partners'), api('GET', '/api/introductions')]);
  $('#partners').replaceChildren(...partners.map((p) => el('tr', {},
    el('td', {}, el('b', { textContent: p.organisation }), el('br'), el('span', { className: 'muted', textContent: `${TYPES[p.type] ?? p.type} · ${p.city}` })),
    el('td', {}, p.name, el('br'), el('span', { className: 'muted mono', textContent: p.phone }), el('br'),
      el('span', { className: 'muted small', textContent: `Telebirr ${p.payoutPhone}` })),
    el('td', { className: 'mono', textContent: p.refCode }),
    el('td', { textContent: `${p.counts.introduced} · ${p.counts.submitted} submitted` }),
    el('td', {}, el('span', { className: `chip ${STATUS[p.status][1]}`, textContent: STATUS[p.status][0] }), el('br'),
      el('span', { className: 'muted small', textContent: `Applied ${timeAgo(p.createdAt)}` })),
    el('td', {}, actions(p)),
  )));
  $('#no-partners').hidden = partners.length > 0;

  $('#introductions').replaceChildren(...intros.map((i) => el('tr', {},
    el('td', {}, el('b', { textContent: i.name }), el('br'), el('span', { className: 'muted', textContent: `${i.people} ${i.people === 1 ? 'person' : 'people'} · ${timeAgo(i.createdAt)}` })),
    el('td', {}, el('a', { href: `tel:${i.phone}`, className: 'mono', textContent: i.phone })),
    el('td', { textContent: i.partner }),
    el('td', { textContent: PACKAGE_LABELS[i.package] ?? i.package }),
    el('td', { className: 'muted', textContent: i.note || '—' }),
    el('td', {}, el('span', {
      className: `chip ${i.started ? 'submitted' : i.needsCall ? 'warn' : ''}`,
      textContent: i.started ? 'Started' : i.needsCall ? 'Call' : 'Invited',
    })),
  )));
  $('#no-introductions').hidden = intros.length > 0;
}

try {
  const me = await loadShell();
  if (me.role !== 'admin') throw new Error('Only admins can manage partners.');
  await load();
} catch (err) {
  showError(err);
}
