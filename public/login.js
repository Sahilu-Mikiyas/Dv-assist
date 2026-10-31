import { api, $, showError } from '/app.js';

let secret = null;

async function showSetup() {
  $('#signin').hidden = true;
  $('#setup').hidden = false;
  const started = await api('POST', '/api/authenticator/begin');
  secret = started.secret;
  $('#secret').textContent = secret.match(/.{1,4}/g).join(' ');
  $('#otpauth').href = started.url;
  $('#setup').code.focus();
}

$('#signin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    showError(null);
    const result = await api('POST', '/api/login', {
      email: form.email.value, password: form.password.value, code: form.code.value,
    });
    if (result.needsAuthenticator) await showSetup();
    else location.href = '/';
  } catch (err) {
    showError(err);
  } finally {
    button.disabled = false;
  }
});

$('#setup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = $('#setup-error');
  box.hidden = true;
  try {
    await api('POST', '/api/authenticator/confirm', { secret, code: e.target.code.value });
    location.href = '/';
  } catch (err) {
    box.textContent = err.message;
    box.hidden = false;
  }
});

// Arriving here signed in but without an authenticator (e.g. after a reload) goes straight to setup.
if (new URLSearchParams(location.search).has('setup')) showSetup().catch(() => {});
