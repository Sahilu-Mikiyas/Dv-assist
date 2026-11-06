// Partner dashboard: counts, referrals and the partner's own link.

import { $, el } from '/dom.js';
import { PACKAGE_NAMES, loadPartner, showError } from '/partner/app.js';
import { downloadQr, qrSvgElement } from '/partner/qr.js';

const STAGES = {
  invited: 'Invited',
  started: 'Started',
  checking: 'Being checked',
  filing: 'Approved · being filed',
  submitted: 'Submitted',
};
const HOW = { introduced: 'Introduced', link: 'Used your link', together: 'Filled together' };
const birr = (n) => `${n.toLocaleString('en-US')} ETB`;
const PAYOUT = { paid: 'Paid', waiting: 'Being paid', due: 'Due' };

// Revenue-share partners earn a share of net profit, not a per-entry commission.
async function showRevenueShare(me) {
  const a = await (await fetch('/api/partner/revenue-share')).json();
  $('#earned').textContent = birr(a.totalShare);
  $('#paid-split').textContent = `${birr(a.paidEtb)} paid · ${birr(Math.max(0, a.balanceEtb + a.waitingEtb))} owed`;
  $('#revenue-share-link').hidden = false;
  me.earned = null; // keep the per-entry figures below from overwriting this
  me.revenueShare = true;
}

function earningCell(r) {
  if (r.stage !== 'submitted') return [r.stage === 'invited' ? '—' : 'When submitted'];
  return [r.earning != null ? birr(r.earning) : 'To be confirmed', el('br'), el('small', { textContent: PAYOUT[r.payout] })];
}

try {
  const me = await loadPartner();
  const firstName = me.name.split(/\s+/)[0];
  $('#org-eyebrow').textContent = me.organisation;
  $('#hello').textContent = `Selam, ${firstName}`;
  $('#hello-am').textContent = `ሰላም፣ ${firstName}`;
  $('#n-introduced').textContent = me.counts.introduced;
  $('#n-progress').textContent = me.counts.inProgress;
  $('#n-submitted').textContent = me.counts.submitted;
  if (me.kind === 'revenue_share') await showRevenueShare(me);
  else $('#earned').textContent = me.earned == null ? 'To be confirmed' : birr(me.earned);
  if (me.earned != null && !me.revenueShare) $('#paid-split').textContent = `${birr(me.paidEtb)} paid · ${birr(me.owedEtb)} owed`;
  $('#earned').classList.toggle('words', me.earned == null);

  const link = `${location.origin}/r/${me.refCode}`;
  $('#ref-link').textContent = link;
  $('#qr').replaceChildren(qrSvgElement(link, `QR code for your referral link ${link}`));
  $('#download-qr').addEventListener('click', () => downloadQr(link, `ethio-dv-assist-${me.refCode}.svg`));
  $('#together-link').href = `/apply?ref=${me.refCode}&together=1`;
  $('#share-link').href = `https://t.me/share/url?${new URLSearchParams({ url: link, text: 'Start your DV entry with Ethio DV Assist' })}`;
  $('#copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      $('#copy-link').textContent = 'Copied';
    } catch {
      $('#copy-link').textContent = 'Select and copy it';
    }
  });
  $('#payout').textContent = me.revenueShare
    ? `Your share of net profit is paid to your Telebirr ending ··${me.payoutPhoneEnding}. See "Revenue share" for the full account.`
    : me.commissionEtb == null
    ? `Commission per submitted entry is being finalised. Payouts go to your Telebirr number ending ··${me.payoutPhoneEnding}.`
    : `${birr(me.commissionEtb)} for each submitted entry, paid to your Telebirr number ending ··${me.payoutPhoneEnding}.`;

  $('#payout-list').replaceChildren(...me.payouts.map((p) => el('li', {},
    el('b', { textContent: birr(p.amountEtb) }), ` · ${p.entries} ${p.entries === 1 ? 'entry' : 'entries'} · `,
    p.status === 'paid' ? `paid ${new Date(p.at).toLocaleDateString('en-GB')} · ${p.reference}` : 'being paid')));
  $('#rows').replaceChildren(...me.referrals.map((r) => el('tr', {},
    el('td', {}, el('b', { textContent: r.name }), el('br'),
      el('small', { textContent: `${HOW[r.how]} · ${r.people} ${r.people === 1 ? 'person' : 'people'}` })),
    el('td', { textContent: PACKAGE_NAMES[r.package] ?? '—' }),
    el('td', {}, el('span', { className: `pill ${r.stage}`, textContent: STAGES[r.stage] })),
    el('td', {}, ...(me.revenueShare ? [r.stage === 'submitted' ? 'In your revenue share' : '—'] : earningCell(r))))));
  $('#empty').hidden = me.referrals.length > 0;
} catch (err) {
  showError(err);
}
