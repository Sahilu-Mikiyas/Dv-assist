// Admin: the data retention policy, what it erases, and a manual run.

import { api, $, loadShell, run, showError } from '/staff/app.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function rule(box, days, dueNow, preview, previewDays, one, many) {
  box.classList.toggle('on', days != null);
  box.classList.toggle('off', days == null);
  box.querySelector('.state').textContent = days == null ? 'Off: nothing is erased' : `Erased after ${days} days`;
  box.querySelector('.detail').textContent = days == null
    ? `If set to ${previewDays} days, ${plural(preview, one, many)} would be erased now.`
    : `${plural(dueNow, one, many)} due now.`;
}

async function load() {
  const o = await api('GET', '/api/retention');
  rule($('#rule-submitted'), o.policy.afterSubmissionDays, o.due.submitted, o.preview.submitted, o.preview.submittedDays, 'entry', 'entries');
  rule($('#rule-unsent'), o.policy.unsentDays, o.due.unsent + o.due.introductions,
    o.preview.unsent + o.preview.introductions, o.preview.draftDays, 'entry or invitation', 'entries or invitations');
  $('#totals').textContent = `${plural(o.kept, 'case')} with personal data · ${plural(o.erased, 'case')} erased`;
  $('#run').hidden = o.policy.afterSubmissionDays == null && o.policy.unsentDays == null;
}

$('#run').addEventListener('click', () => run($('#run'), async () => {
  const n = await api('POST', '/api/retention/run');
  $('#ran').textContent = `Erased ${plural(n.submitted + n.unsent, 'case')} and ${plural(n.introductions, 'invitation')}.`;
  await load();
}));

try {
  const me = await loadShell();
  if (me.role !== 'admin') throw new Error('Only admins can see data retention.');
  await load();
} catch (err) {
  showError(err);
}
