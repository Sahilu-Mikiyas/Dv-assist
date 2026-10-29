import { api, $, showError, label, personName } from '/app.js';

$('#logout').addEventListener('click', async () => {
  await api('POST', '/api/logout');
  location.href = '/login.html';
});

try {
  const cases = await api('GET', '/api/cases');
  $('#cases').replaceChildren(...cases.map((c) => {
    const tr = document.createElement('tr');
    const link = Object.assign(document.createElement('a'), {
      href: `/case.html?id=${c.id}`, textContent: personName(c.applicant),
    });
    const status = Object.assign(document.createElement('span'), {
      className: `status ${c.status}`, textContent: label(c.status),
    });
    const cells = [link, status, c.confirmationNumber ?? '—', new Date(c.updatedAt).toLocaleString()];
    tr.append(...cells.map((content) => {
      const td = document.createElement('td');
      td.append(content);
      return td;
    }));
    return tr;
  }));
  if (!cases.length) $('#cases').innerHTML = '<tr><td colspan="4" class="muted">No cases yet.</td></tr>';
} catch (err) {
  showError(err);
}
