import { $ } from '/dom.js';
import { api, showError } from '/partner/app.js';

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  showError(null);
  try {
    await api('POST', '/api/partner/login', { code: event.target.elements.namedItem('code').value });
    location.href = '/partner/';
  } catch (err) {
    showError(err);
  } finally {
    button.disabled = false;
  }
});
