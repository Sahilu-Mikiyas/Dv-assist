// Admin: the cost figures revenue-share profit is computed from.

import { api, $, loadShell, run, showError, timeAgo } from '/staff/app.js';

const form = $('#costs');
const FIELDS = ['paymentCostEtb', 'collectionFeePct', 'techCenterCommissionEtb', 'marketingEtb', 'supportEtb', 'developmentEtb'];
const value = (name) => Number(form.elements.namedItem(name).value);
const birr = (n) => `${Math.round(n).toLocaleString('en-US')} ETB`;

// Same rule as src/domain/revenue-share.js, for one applicant paying 1,500 ETB.
function preview() {
  const price = 1500;
  const common = price - value('paymentCostEtb') - (price * value('collectionFeePct')) / 100 - value('supportEtb') - value('developmentEtb');
  $('#net-direct').textContent = birr(common);
  $('#net-tech').textContent = birr(common - value('techCenterCommissionEtb') - value('marketingEtb'));
  $('#net-own').textContent = birr(common - value('marketingEtb'));
}

function fill(current) {
  for (const name of FIELDS) form.elements.namedItem(name).value = current.values[name];
  $('#saved-note').textContent = current.saved
    ? `Last saved ${timeAgo(current.updatedAt)} by ${current.updatedBy}.`
    : 'Not saved yet: these are the planning figures from the partnership offer (Model A). Tech centres are not paid until you save.';
  preview();
}

form.addEventListener('input', preview);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  run(form.querySelector('button'), async () => {
    fill(await api('PUT', '/api/economics', Object.fromEntries(FIELDS.map((f) => [f, value(f)]))));
  });
});

try {
  const me = await loadShell();
  if (me.role !== 'admin') throw new Error('Only admins can change costs.');
  fill(await api('GET', '/api/economics'));
} catch (err) {
  showError(err);
}
