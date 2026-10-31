import { api, $, el, loadShell, showError, STAGE_LABELS, timeAgo } from '/app.js';

const params = new URLSearchParams(location.search);
const STAGES = [
  ['', 'All open'],
  ['draft', 'Draft'],
  ['checked', 'Waiting for Tona'],
  ['verified', 'Waiting for Baraka'],
  ['approved', 'Ready for card'],
  ['card_issued', 'File now'],
  ['submitted', 'Submitted'],
];

let me;
let directory = new Map();
let stage = params.get('status') ?? '';
let searchTimer;

function renderCounters(counts) {
  const open = Object.entries(counts).filter(([s]) => s !== 'submitted').reduce((n, [, v]) => n + v, 0);
  $('#counters').replaceChildren(...STAGES.map(([value, text]) => {
    const n = value === '' ? open : (counts[value] ?? 0);
    const button = el('button', { type: 'button', className: 'counter' }, el('span', { textContent: text }), el('b', { textContent: String(n) }));
    button.setAttribute('aria-pressed', String(stage === value));
    button.addEventListener('click', () => {
      stage = value;
      load();
    });
    return button;
  }));
}

function renderRows(cases) {
  $('#cases').replaceChildren(...cases.map((c) => el('tr', {},
    el('td', { className: 'mono' }, el('a', { href: `/case.html?id=${c.id}`, textContent: c.code })),
    el('td', {}, el('b', { textContent: c.name }), el('br'), el('span', { className: 'muted', textContent: `${c.people} ${c.people === 1 ? 'person' : 'people'}` })),
    el('td', {}, el('span', { className: `chip ${c.status}`, textContent: STAGE_LABELS[c.status] ?? c.status })),
    el('td', { textContent: directory.get(c.assignedTo) ?? '—' }),
    el('td', { className: 'muted', textContent: timeAgo(c.updatedAt) }),
  )));
  $('#empty').hidden = cases.length > 0;
}

async function load() {
  try {
    showError(null);
    const query = new URLSearchParams();
    if (stage) query.set('status', stage);
    if ($('#search').value.trim()) query.set('q', $('#search').value.trim());
    if (params.has('mine')) query.set('assignedTo', me.id);
    const { cases, counts } = await api('GET', `/api/cases?${query}`);
    renderCounters(counts);
    // "All open" hides submitted cases; pick the Submitted counter to see them.
    renderRows(stage === '' ? cases.filter((c) => c.status !== 'submitted') : cases);
  } catch (err) {
    showError(err);
  }
}

$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 250);
});

try {
  me = await loadShell();
  if (params.has('mine')) {
    $('#title').textContent = 'My cases';
    document.querySelector('[aria-current="page"]').removeAttribute('aria-current');
    $('#mine-link').setAttribute('aria-current', 'page');
  }
  directory = new Map((await api('GET', '/api/staff/directory')).map((s) => [s.id, s.name]));
  await load();
} catch (err) {
  showError(err);
}
