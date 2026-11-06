// Admin: create partner payouts, record the Telebirr transaction once paid, or cancel.

import { api, $, el, loadShell, run, showError, timeAgo } from '/staff/app.js';

const birr = (n) => (n == null ? '—' : `${n.toLocaleString('en-US')} ETB`);
const STATUS = { pending: ['Waiting to be paid', 'warn'], paid: ['Paid', 'submitted'], cancelled: ['Cancelled', 'draft'] };

function button(text, handler, primary = false) {
  const b = el('button', { type: 'button', className: `btn small${primary ? ' primary' : ''}`, textContent: text });
  b.addEventListener('click', () => run(b, handler));
  return b;
}

function pendingActions(p) {
  const reference = el('input', { className: 'ref-input', placeholder: 'Telebirr transaction no.', maxLength: 30, ariaLabel: `Telebirr transaction number for ${p.organisation}` });
  return el('div', { className: 'row' }, reference,
    button('Mark paid', async () => {
      await api('POST', `/api/payouts/${p.id}/paid`, { reference: reference.value });
      await load();
    }, true),
    button('Cancel', async () => {
      if (!confirm(`Cancel this payout of ${birr(p.amountEtb)}? Its entries go back to "owed".`)) return;
      await api('POST', `/api/payouts/${p.id}/cancel`);
      await load();
    }));
}

async function load() {
  const o = await api('GET', '/api/payouts');
  $('#rate').textContent = o.commissionEtb == null
    ? 'The tech-centre commission is not set yet: save it on the Costs page. Revenue-share partners can be paid already.'
    : `Commission: ${birr(o.commissionEtb)} per submitted entry.`;

  $('#owed').replaceChildren(...o.owed.map((w) => el('tr', {},
    el('td', {}, el('b', { textContent: w.organisation }), w.status !== 'active' ? el('span', { className: 'muted small', textContent: ` · ${w.status}` }) : null,
      w.kind === 'revenue_share' ? el('div', { className: 'muted small' }, 'Revenue share · ', el('a', { href: `/partner/share.html?partner=${w.partnerId}`, textContent: 'account' })) : null),
    el('td', {}, String(w.entries), el('br'), el('span', { className: 'muted small mono', textContent: w.kind === 'revenue_share' ? 'applicants counted' : w.cases.join(', ') })),
    el('td', { textContent: w.amountEtb < 0 ? `−${birr(-w.amountEtb)} (refunds to recover)` : birr(w.amountEtb) }),
    el('td', { className: 'mono', textContent: w.payTo }),
    el('td', {}, (w.kind === 'revenue_share' ? w.amountEtb <= 0 : o.commissionEtb == null) ? '' : button('Create payout', async () => {
      if (!confirm(`Create a payout of ${birr(w.amountEtb)} to ${w.organisation} (${w.payTo})?`)) return;
      await api('POST', '/api/payouts', { partnerId: w.partnerId });
      await load();
    }, true)))));
  $('#none-owed').hidden = o.owed.length > 0;

  $('#payouts').replaceChildren(...o.payouts.map((p) => el('tr', {},
    el('td', {}, timeAgo(p.createdAt), el('br'), el('span', { className: 'muted small', textContent: `by ${p.createdBy ?? '—'}` })),
    el('td', { textContent: p.organisation }),
    el('td', {}, birr(p.amountEtb), el('br'), el('span', { className: 'muted small', textContent: p.rateEtb ? `${p.entries} × ${birr(p.rateEtb)}` : `Revenue share · ${p.entries} applicants` })),
    el('td', { className: 'mono', textContent: p.payTo }),
    el('td', {}, el('span', { className: `chip ${STATUS[p.status][1]}`, textContent: STATUS[p.status][0] }),
      p.reference ? el('div', { className: 'muted small mono', textContent: p.reference }) : null,
      p.settledAt ? el('div', { className: 'muted small', textContent: `${timeAgo(p.settledAt)} · ${p.settledBy}` }) : null),
    el('td', {}, p.status === 'pending' ? pendingActions(p) : ''))));
  $('#no-payouts').hidden = o.payouts.length > 0;
}

try {
  const me = await loadShell();
  if (me.role !== 'admin') throw new Error('Only admins can manage payouts.');
  await load();
} catch (err) {
  showError(err);
}
