// A partner's full statement: every referral, grouped, and how their commission adds up.

import { $, el } from '/dom.js';
import { PACKAGE_NAMES, loadPartner, showError, api } from '/partner/app.js';

const STAGES = { invited: 'Invited', started: 'Started', checking: 'Being checked', filing: 'Approved · being filed', submitted: 'Submitted' };
const HOW = { link: 'Used your link', introduced: 'Introduced by you', together: 'Filled together' };
const COMMISSION = { paid: 'Paid', waiting: 'Being paid', due: 'Due' };
const birr = (n) => (n == null ? 'To be confirmed' : `${n.toLocaleString('en-US')} ETB`);
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function bars(target, counts, labels) {
  const max = Math.max(1, ...Object.values(counts));
  target.replaceChildren(...Object.entries(counts).map(([key, n]) => {
    const bar = el('span', { className: 'bar-fill' });
    bar.style.setProperty('--w', `${(n / max) * 100}%`);
    return el('div', { className: 'bar' }, el('span', { className: 'bar-label', textContent: labels[key] ?? key }),
      el('span', { className: 'bar-track' }, bar), el('b', { textContent: String(n) }));
  }));
}

function fill(select, labels) {
  select.append(...Object.entries(labels).map(([value, text]) => new Option(text, value)));
}

let rows = [];
let revenueShare = false;
function renderRows() {
  const stage = $('#f-stage').value;
  const pkg = $('#f-package').value;
  const paid = $('#f-paid').value;
  const q = $('#f-q').value.trim().toLowerCase();
  const shown = rows.filter((r) => (!stage || r.stage === stage) && (!pkg || r.package === pkg)
    && (!paid || (paid === 'yes') === r.applicantPaid) && (!q || r.name.toLowerCase().includes(q) || (r.code ?? '').toLowerCase().includes(q)));
  $('#rows').replaceChildren(...shown.map((r) => el('tr', {},
    el('td', { className: 'mono', textContent: r.code ?? '—' }),
    el('td', {}, el('b', { textContent: r.name }), el('br'),
      el('small', { textContent: `${HOW[r.how]} · ${r.people} ${r.people === 1 ? 'person' : 'people'}${r.submittedAt ? ` · submitted ${date(r.submittedAt)}` : ''}` })),
    el('td', { textContent: PACKAGE_NAMES[r.package] ?? '—' }),
    el('td', {}, el('span', { className: `pill ${r.stage}`, textContent: STAGES[r.stage] })),
    el('td', { textContent: r.stage === 'invited' ? '—' : r.applicantPaid ? 'Yes' : 'Not yet' }),
    el('td', {}, ...(revenueShare ? [r.stage === 'submitted' ? 'In your revenue share' : '—']
      : r.commission ? [birr(r.commission.amountEtb), el('br'), el('small', { textContent: COMMISSION[r.commission.status] })] : ['When submitted'])))));
  $('#shown').textContent = `Showing ${shown.length} of ${rows.length}.`;
}

try {
  await loadPartner();
  const st = await api('GET', '/api/partner/statement');
  $('#org').textContent = st.organisation;
  $('#t-referrals').textContent = st.totals.referrals;
  $('#t-people').textContent = st.totals.people;
  $('#t-processing').textContent = st.totals.processing;
  $('#t-processed').textContent = st.totals.processed;

  if (st.kind === 'revenue_share') {
    $('#commission-card').replaceChildren(el('h2', { textContent: 'Your earnings' }),
      el('p', { className: 'muted', textContent: 'You earn a share of net profit rather than a fixed amount per entry. The full account, with every cost and payout, is on your revenue-share page.' }),
      el('a', { className: 'btn primary', href: '/partner/share.html', textContent: 'Open your revenue share' }));
    $('#payouts-card').hidden = true;
  }
  const e = st.earnings;
  $('#rule').textContent = e.commissionEtb == null
    ? 'Your commission per submitted entry is being finalised. Your entries are counted below and will be paid at the agreed rate.'
    : `You earn ${birr(e.commissionEtb)} for every entry of yours that we submit. Payouts go to your Telebirr ending ··${st.payoutPhoneEnding}.`;
  $('#e-submitted').textContent = String(e.submittedEntries);
  $('#e-paid').textContent = birr(e.paidEtb);
  $('#e-waiting').textContent = birr(e.waitingEtb);
  $('#e-due').textContent = `${e.dueEntries} × ${birr(e.commissionEtb)} = ${birr(e.dueEtb)}`;
  $('#e-earned').textContent = birr(e.earnedEtb);

  $('#payouts').replaceChildren(...st.payouts.map((p) => el('li', {},
    el('b', { textContent: birr(p.amountEtb) }),
    ` · ${p.entries} × ${birr(p.rateEtb)} · ${p.status === 'paid' ? `paid ${date(p.settledAt)} · Telebirr ${p.reference}` : 'being paid'}`,
    el('br'), el('small', { className: 'mono', textContent: `Entries: ${p.codes.join(', ')}` }))));
  $('#no-payouts').hidden = st.payouts.length > 0;

  bars($('#by-stage'), st.byStage, STAGES);
  bars($('#by-package'), st.byPackage, PACKAGE_NAMES);
  bars($('#by-how'), st.byHow, HOW);
  bars($('#by-payment'), { paid: st.payments.paid, notPaid: st.payments.notPaid }, { paid: 'Paid', notPaid: 'Not paid yet' });

  fill($('#f-stage'), STAGES);
  fill($('#f-package'), PACKAGE_NAMES);
  rows = st.rows;
  revenueShare = st.kind === 'revenue_share';
  for (const id of ['#f-stage', '#f-package', '#f-paid']) $(id).addEventListener('change', renderRows);
  $('#f-q').addEventListener('input', renderRows);
  renderRows();
} catch (err) {
  showError(err);
}
