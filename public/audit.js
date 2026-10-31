import { api, $, el, label, loadShell, showError } from '/app.js';

const FILTERS = [['', 'All'], ['card', 'Card'], ['login', 'Sign-ins'], ['check', 'Checks'], ['case_submitted', 'Submissions'], ['bitnob', 'Bitnob']];
const WARN = /^(card_revealed|login_failed|bitnob:.*declin)/;
let kind = '';

async function load() {
  try {
    showError(null);
    const events = await api('GET', `/api/audit${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`);
    $('#events').replaceChildren(...events.map((e) => el('tr', {},
      el('td', { className: 'muted', textContent: new Date(e.at).toLocaleString() }),
      el('td', { textContent: e.staffName ?? (e.action.startsWith('bitnob') ? 'Bitnob' : '—') }),
      el('td', {}, el('span', { className: WARN.test(e.action) ? 'chip warn' : 'chip', textContent: label(e.action) })),
      el('td', { className: 'mono' }, e.caseId ? el('a', { href: `/case.html?id=${e.caseId}`, textContent: e.caseCode ?? 'case' }) : '—'),
      el('td', { className: 'muted', textContent: e.detail ?? '' }),
      el('td', { className: 'mono muted', textContent: e.ip ?? '' }),
    )));
  } catch (err) {
    showError(err);
  }
}

function renderFilters() {
  $('#filters').replaceChildren(...FILTERS.map(([value, text]) => {
    const button = el('button', { type: 'button', className: value === kind ? 'btn small dark' : 'btn small', textContent: text });
    button.setAttribute('aria-pressed', String(value === kind));
    button.addEventListener('click', () => {
      kind = value;
      renderFilters();
      load();
    });
    return button;
  }));
}

try {
  await loadShell();
  renderFilters();
  await load();
} catch (err) {
  showError(err);
}
