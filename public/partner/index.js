// Partner dashboard: counts, referrals and the partner's own link.

import { $, el } from '/dom.js';
import { PACKAGE_NAMES, loadPartner, showError } from '/partner/app.js';

const STAGES = {
  invited: 'Invited',
  started: 'Started',
  checking: 'Being checked',
  filing: 'Approved · being filed',
  submitted: 'Submitted',
};
const HOW = { introduced: 'Introduced', link: 'Used your link', together: 'Filled together' };
const birr = (n) => `${n.toLocaleString('en-US')} ETB`;

try {
  const me = await loadPartner();
  const firstName = me.name.split(/\s+/)[0];
  $('#org-eyebrow').textContent = me.organisation;
  $('#hello').textContent = `Selam, ${firstName}`;
  $('#hello-am').textContent = `ሰላም፣ ${firstName}`;
  $('#n-introduced').textContent = me.counts.introduced;
  $('#n-progress').textContent = me.counts.inProgress;
  $('#n-submitted').textContent = me.counts.submitted;
  $('#earned').textContent = me.earned == null ? 'To be confirmed' : birr(me.earned);
  $('#earned').classList.toggle('words', me.earned == null);

  const link = `${location.origin}/r/${me.refCode}`;
  $('#ref-link').textContent = link;
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
  $('#payout').textContent = me.commissionEtb == null
    ? `Commission per submitted entry is being finalised. Payouts go to your Telebirr number ending ··${me.payoutPhoneEnding}.`
    : `${birr(me.commissionEtb)} for each submitted entry, paid to your Telebirr number ending ··${me.payoutPhoneEnding}.`;

  $('#rows').replaceChildren(...me.referrals.map((r) => el('tr', {},
    el('td', {}, el('b', { textContent: r.name }), el('br'),
      el('small', { textContent: `${HOW[r.how]} · ${r.people} ${r.people === 1 ? 'person' : 'people'}` })),
    el('td', { textContent: PACKAGE_NAMES[r.package] ?? '—' }),
    el('td', {}, el('span', { className: `pill ${r.stage}`, textContent: STAGES[r.stage] })),
    el('td', { textContent: r.earning != null ? birr(r.earning) : r.stage === 'submitted' ? 'To be confirmed' : r.stage === 'invited' ? '—' : 'Pending' }))));
  $('#empty').hidden = me.referrals.length > 0;
} catch (err) {
  showError(err);
}
