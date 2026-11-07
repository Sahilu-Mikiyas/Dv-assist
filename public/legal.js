// Fills in the data-retention periods the site is actually configured with.

const days = (n) => (n % 365 === 0 ? `${n / 365} year${n === 365 ? '' : 's'}` : n >= 60 && n % 30 === 0 ? `${n / 30} months` : `${n} days`);

try {
  const res = await fetch('/api/public/policy');
  const { retention } = await res.json();
  const text = {
    afterSubmission: retention.afterSubmissionDays ? `${days(retention.afterSubmissionDays)} after the entry is filed` : null,
    unsent: retention.unsentDays ? `${days(retention.unsentDays)} after the last change` : null,
  };
  for (const el of document.querySelectorAll('[data-retention]')) {
    if (text[el.dataset.retention]) el.textContent = text[el.dataset.retention];
  }
} catch {
  // Leave the default wording.
}
