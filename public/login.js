import { api, $, showError } from '/app.js';

$('#login').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/login', { password: e.target.password.value });
    location.href = '/';
  } catch (err) {
    showError(err);
  }
});
