// Introduce someone: creates an invitation and a ready-to-send message with their personal link.

import { $ } from '/dom.js';
import { api, loadPartner, showError } from '/partner/app.js';

const form = $('#intro-form');
let people = 1;
const setPeople = (n) => { people = Math.min(15, Math.max(1, n)); $('#people').textContent = String(people); };
$('#fewer').addEventListener('click', () => setPeople(people - 1));
$('#more').addEventListener('click', () => setPeople(people + 1));

const me = await loadPartner().catch((err) => showError(err));
form.elements.namedItem('name').addEventListener('input', (e) => {
  const first = e.target.value.trim().split(/\s+/)[0];
  $('#consent-text').textContent = `${first || 'They'} asked me to share their number with Ethio DV Assist.`;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  showError(null);
  try {
    const v = (name) => form.elements.namedItem(name).value;
    const invite = await api('POST', '/api/partner/introductions', {
      name: v('name'), phone: v('phone'), people, package: form.querySelector('[name=package]:checked')?.value,
      note: v('note'), consent: form.elements.namedItem('consent').checked,
    });
    const link = `${location.origin}/i/${invite.reference}`;
    const message = `Selam ${invite.firstName}, ${me.organisation} introduced you to Ethio DV Assist. Start your DV entry here: ${link}\n\n`
      + `ሰላም ${invite.firstName}፣ ${me.organisation} ከኢትዮ ዲቪ አሲስት ጋር አስተዋውቆዎታል። የዲቪ ምዝገባዎን እዚህ ይጀምሩ፦ ${link}`;
    $('#sent-title').textContent = `Invitation for ${invite.firstName}`;
    if (invite.sentBySms) $('#sms-note').hidden = false;
    $('#message').textContent = message;
    $('#reference').textContent = invite.reference;
    $('#send-sms').href = `sms:${invite.phone}?body=${encodeURIComponent(message)}`;
    $('#send-telegram').href = `https://t.me/share/url?${new URLSearchParams({ url: link, text: message.split('\n')[0] })}`;
    $('#copy-message').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message);
        $('#copy-message').textContent = 'Copied';
      } catch {
        $('#copy-message').textContent = 'Select and copy it';
      }
    });
    form.hidden = true;
    $('#sent').hidden = false;
    window.scrollTo({ top: 0 });
  } catch (err) {
    showError(err);
  } finally {
    button.disabled = false;
  }
});
