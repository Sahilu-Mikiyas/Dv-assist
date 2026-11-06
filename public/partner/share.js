// Revenue-share account: the partner's own view, or an admin's view of a partner (?partner=<id>).

import { $, el } from '/dom.js';
import { loadPartner } from '/partner/app.js';

const adminView = new URLSearchParams(location.search).get('partner');
const birr = (n) => `${(Math.round(n) || 0).toLocaleString('en-US')} ETB`;
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const date = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function bars(target, rows) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  target.replaceChildren(...rows.map(([label, n]) => {
    const fill = el('span', { className: 'bar-fill' });
    fill.style.setProperty('--w', `${(n / max) * 100}%`);
    return el('div', { className: 'bar' }, el('span', { className: 'bar-label', textContent: label }),
      el('span', { className: 'bar-track' }, fill), el('b', { textContent: String(n) }));
  }));
}

async function fetchAccount() {
  const res = await fetch(adminView ? `/api/partners/${encodeURIComponent(adminView)}/revenue-share` : '/api/partner/revenue-share');
  if (res.status === 401) {
    location.href = adminView ? '/staff/login.html' : '/partner/login.html';
    throw new Error('Sign in first');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Could not load the account');
  return data;
}

try {
  if (adminView) {
    $('#back').href = '/staff/partners.html';
    $('#back').textContent = '← Partners';
    $('#csv').hidden = true;
    $('#sign-out').hidden = true;
    $('#org-name').textContent = 'Admin view';
  } else {
    await loadPartner();
  }
  const a = await fetchAccount();
  const { direct: d, throughUs: t } = a.streams;
  const ladder = a.deal.ladder ? ` (ladder: ${a.deal.ladder.map((s) => `${s.pct}% from ${s.from.toLocaleString('en-US')}`).join(', ')})` : '';
  $('#terms').textContent = `${d.pct}% of net profit on applicants who register through your account${ladder}, and ${t.pct}% on every other applicant we serve.`;
  $('#t-counted').textContent = String(a.countedApplicants);
  $('#t-share').textContent = birr(a.totalShare);
  $('#t-paid').textContent = birr(a.paidEtb);
  if (a.balanceEtb < 0) {
    $('#t-balance-label').textContent = 'To come off later (refunds)';
    $('#t-balance').textContent = birr(-a.balanceEtb);
  } else {
    $('#t-balance').textContent = birr(a.balanceEtb + a.waitingEtb);
    if (a.waitingEtb) $('#t-balance-label').textContent = `Owed to you (${birr(a.waitingEtb)} being paid)`;
  }

  // One line of the table: direct, through us, and their total.
  const row = (label, pick, { strong = false, money = true } = {}) => {
    const show = (v) => (money ? birr(v) : v.toLocaleString('en-US'));
    return el('tr', { className: strong ? 'total' : '' }, el('th', { scope: 'row', textContent: label }),
      ...[pick(d), pick(t), pick(d) + pick(t)].map((v) => el('td', { textContent: show(v) })));
  };
  $('#streams').replaceChildren(
    row('Applicants counted', (s) => s.applicants, { money: false }),
    row('Paid by applicants', (s) => s.revenue),
    row('− Payment cost (official fee, cards)', (s) => s.costs.payment),
    row('− Collection fee', (s) => s.costs.collection),
    row('− Tech-centre commission', (s) => s.costs.commission),
    row('− Marketing', (s) => s.costs.marketing),
    row('− Support', (s) => s.costs.support),
    row('− Development', (s) => s.costs.development),
    row('Net profit', (s) => s.netProfit, { strong: true }),
    el('tr', {}, el('th', { scope: 'row', textContent: 'Your percentage' }), el('td', { textContent: `${d.pct}%` }), el('td', { textContent: `${t.pct}%` }), el('td')),
    row('Your share', (s) => s.share, { strong: true }));
  const e = a.economics;
  $('#cost-basis').textContent = `payment ${birr(e.paymentCostEtb)}, collection ${e.collectionFeePct}%, tech-centre commission ${birr(e.techCenterCommissionEtb)} (only where a tech centre referred), marketing ${birr(e.marketingEtb)} (through us only), support ${birr(e.supportEtb)}, development ${birr(e.developmentEtb)}`;

  $('#months').replaceChildren(...a.months.map((m) => el('tr', {},
    el('td', { textContent: monthName(m.month) }),
    el('td', { textContent: `${m.direct.applicants} · ${birr(m.direct.netProfit)}` }),
    el('td', { textContent: `${m.throughUs.applicants} · ${birr(m.throughUs.netProfit)}` }),
    el('td', { textContent: birr(m.direct.netProfit + m.throughUs.netProfit) }),
    el('td', {}, el('b', { textContent: birr(m.share) })))));
  $('#no-months').hidden = a.months.length > 0;

  $('#payouts').replaceChildren(...a.payouts.map((p) => el('li', {},
    el('b', { textContent: birr(p.amountEtb) }),
    ` · ${p.status === 'paid' ? `paid ${date(p.settledAt)} · Telebirr ${p.reference}` : 'being paid'}`,
    el('br'), el('small', { textContent: `Covering ${p.entries} counted applicants at the time` }))));
  $('#no-payouts').hidden = a.payouts.length > 0;

  bars($('#pipeline'), [
    ['Being processed', a.pipeline.inProgress], ['Submitted, payment not cleared', a.pipeline.awaitingPayment],
    ['Paid, not yet submitted', a.pipeline.awaitingSubmission], ['Refunded', a.pipeline.refunded],
  ]);
  bars($('#channels'), [
    ['Tech centres', a.channels.techCentres], ['Our website', a.channels.website], ['Our office', a.channels.office],
    ['Other partners', a.channels.otherPartners],
  ]);
  $('#view').hidden = false;
} catch (err) {
  $('#error').textContent = err.message;
  $('#error').hidden = false;
}
