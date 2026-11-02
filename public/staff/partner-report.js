// Admin: every partner's referrals and commission side by side, with totals.

import { api, $, el, loadShell, showError } from '/staff/app.js';

const birr = (n) => (n == null ? '—' : `${n.toLocaleString('en-US')} ETB`);

function tile(label, value) {
  return el('div', { className: 'counter' }, el('b', { textContent: String(value) }), el('span', { textContent: label }));
}

try {
  const me = await loadShell();
  if (me.role !== 'admin') throw new Error('Only admins can see the partner report.');
  const r = await api('GET', '/api/partners/report');
  const t = r.totals;
  $('#rate').textContent = r.commissionEtb == null
    ? 'Commission per submitted entry is not set yet (PARTNER_COMMISSION_ETB), so amounts due are not calculated.'
    : `Commission: ${birr(r.commissionEtb)} per submitted entry.`;
  $('#totals').replaceChildren(
    tile('Partners (active)', `${t.partners} (${t.active})`),
    tile('Referrals', t.referrals), tile('People', t.people), tile('Being processed', t.processing), tile('Submitted', t.processed),
    tile('Applicants paid', t.applicantsPaid), tile('Commission paid', birr(t.paidEtb)), tile('Owed to partners', birr(t.dueEtb == null ? null : t.waitingEtb + t.dueEtb)));

  const cells = (p) => [p.referrals, p.people, p.byStage.invited, p.byStage.started, p.byStage.checking, p.byStage.filing, p.byStage.submitted,
    p.payments.paid, birr(p.earnings.paidEtb), birr(p.earnings.waitingEtb), birr(p.earnings.dueEtb), birr(p.earnings.earnedEtb)];
  $('#rows').replaceChildren(...r.partners.map((p) => el('tr', {},
    el('td', {}, el('b', { textContent: p.organisation }), el('br'), el('span', { className: 'muted small mono', textContent: `${p.refCode} · ${p.status}` })),
    ...cells(p).map((v) => el('td', { className: 'num', textContent: String(v) })))));
  const sumStage = (k) => r.partners.reduce((s, p) => s + p.byStage[k], 0);
  $('#foot').replaceChildren(el('tr', {}, el('th', { scope: 'row', textContent: 'Total' }),
    ...[t.referrals, t.people, sumStage('invited'), sumStage('started'), sumStage('checking'), sumStage('filing'), sumStage('submitted'),
      t.applicantsPaid, birr(t.paidEtb), birr(t.waitingEtb), birr(t.dueEtb), birr(t.earnedEtb)].map((v) => el('td', { className: 'num', textContent: String(v) }))));
  $('#none').hidden = r.partners.length > 0;
} catch (err) {
  showError(err);
}
