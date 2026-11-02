// Public partner page: the "become a partner" form.

import { $ } from '/dom.js';

const form = $('#apply-form');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('[type=submit]');
  const v = (name) => form.elements.namedItem(name).value;
  button.disabled = true;
  $('#error').hidden = true;
  try {
    const res = await fetch('/api/partners/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: v('name'), organisation: v('organisation'), type: v('type'), city: v('city'),
        phone: v('phone'), payoutPhone: v('payoutPhone'), agree: form.elements.namedItem('agree').checked,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.details ?? [data.error ?? 'Something went wrong. Try again.']).join('\n'));
    form.hidden = true;
    $('#applied').hidden = false;
    $('#applied').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    $('#error').textContent = err.message;
    $('#error').hidden = false;
  } finally {
    button.disabled = false;
  }
});
