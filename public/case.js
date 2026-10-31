import { api, $, el, label, loadShell, personName, run, showError, STAGE_LABELS, timeAgo } from '/app.js';
import { prepareDvPhoto } from '/photo-prep.js';

const SPOUSE_REQUIRED = 'married_spouse_not_us_citizen_or_lpr';
const PERSON_FIELDS = ['lastName', 'firstName', 'middleName', 'gender', 'birthDate', 'birthCity', 'birthCountry'];
const ENTRY_FIELDS = ['eligibilityCountry', 'mailingAddress', 'residenceCountry', 'phone', 'email', 'education', 'maritalStatus'];
const STAGE_ORDER = ['draft', 'checked', 'verified', 'approved', 'card_issued', 'submitted'];

const form = $('#form');
let caseId = new URLSearchParams(location.search).get('id');
let me = null;
let directory = [];
let options = {};

// ---------- the draft form ----------

const fillPersonFieldset = (fieldset) => fieldset.append($('#person-fields').content.cloneNode(true));

function addChild(child) {
  const fieldset = el('fieldset', { className: 'child' }, el('legend', { textContent: 'Child' }));
  fieldset.dataset.person = 'child';
  fillPersonFieldset(fieldset);
  const remove = el('button', { type: 'button', className: 'btn small', textContent: 'Remove child' });
  remove.addEventListener('click', () => fieldset.remove());
  fieldset.append(remove);
  $('#children').append(fieldset);
  if (child) writePerson(fieldset, child);
}

function fillSelect(select, values) {
  select.replaceChildren(new Option('—', ''), ...values.map((v) => new Option(label(v), v)));
}

function toggleSpouse() {
  const spouse = $('[data-person="spouse"]');
  spouse.hidden = form.maritalStatus.value !== SPOUSE_REQUIRED;
  spouse.disabled = spouse.hidden;
}

function readPerson(fieldset) {
  const p = Object.fromEntries(PERSON_FIELDS.map((f) => [f, fieldset.querySelector(`[name=${f}]`).value]));
  p.noFirstName = fieldset.querySelector('[name=noFirstName]').checked;
  return p;
}

function writePerson(fieldset, p) {
  for (const f of PERSON_FIELDS) fieldset.querySelector(`[name=${f}]`).value = p[f] ?? '';
  fieldset.querySelector('[name=noFirstName]').checked = Boolean(p.noFirstName);
}

function readForm() {
  return {
    ...readPerson($('[data-person="applicant"]')),
    ...Object.fromEntries(ENTRY_FIELDS.map((f) => [f, form[f].value])),
    spouse: form.maritalStatus.value === SPOUSE_REQUIRED ? readPerson($('[data-person="spouse"]')) : null,
    children: [...document.querySelectorAll('[data-person="child"]')].map(readPerson),
  };
}

function writeForm(a) {
  writePerson($('[data-person="applicant"]'), a);
  for (const f of ENTRY_FIELDS) form[f].value = a[f] ?? '';
  if (a.spouse) writePerson($('[data-person="spouse"]'), a.spouse);
  $('#children').replaceChildren();
  a.children.forEach((child) => addChild(child));
  toggleSpouse();
}

// ---------- copy view: values formatted as the official form expects ----------

const upper = (v) => (v ?? '').toUpperCase();
const usDate = (iso) => {
  const [y, m, d] = (iso ?? '').split('-');
  return y ? `${m}/${d}/${y}` : '';
};

function personRows(p) {
  return [
    ['Last name', upper(p.lastName)],
    ['First name', p.noFirstName ? 'NO FIRST NAME' : upper(p.firstName)],
    ['Middle name', upper(p.middleName) || '—'],
    ['Gender', upper(p.gender)],
    ['Birth date (MM/DD/YYYY)', usDate(p.birthDate)],
    ['City of birth', upper(p.birthCity)],
    ['Country of birth', upper(p.birthCountry)],
  ];
}

function copyButton(value) {
  const button = el('button', { type: 'button', className: 'btn small', textContent: 'Copy' });
  button.setAttribute('aria-label', `Copy ${value}`);
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(value);
    button.textContent = 'Copied ✓';
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  });
  return button;
}

function renderCopy(a) {
  const groups = [
    ['Applicant', [
      ...personRows(a),
      ['Country of eligibility', upper(a.eligibilityCountry)],
      ['Mailing address', upper(a.mailingAddress)],
      ['Country where they live', upper(a.residenceCountry)],
      ['Phone', a.phone || '—'],
      ['Email', a.email],
      ['Education', upper(label(a.education))],
      ['Marital status', upper(label(a.maritalStatus))],
      ['Number of children', String(a.children.length)],
    ]],
    ...(a.spouse ? [['Spouse', personRows(a.spouse)]] : []),
    ...a.children.map((child, i) => [`Child ${i + 1}`, personRows(child)]),
  ];
  $('#copy').replaceChildren(...groups.flatMap(([name, rows]) => [
    el('div', { className: 'copy-group', textContent: name }),
    ...rows.map(([key, value]) => el('div', { className: 'copy-row' },
      el('dt', { textContent: key }), el('dd', { textContent: value }), value && value !== '—' ? copyButton(value) : el('span'))),
  ]));
}

// ---------- photos ----------

function personLabel(key, a) {
  if (key === 'applicant') return `${a.firstName || a.lastName} (applicant)`;
  if (key === 'spouse') return `${a.spouse?.firstName || 'Spouse'} (spouse)`;
  const child = a.children[Number(key.slice(5))];
  return `${child?.firstName || 'Child'} (child)`;
}

function renderPhotos(c) {
  const draft = c.status === 'draft';
  $('#photos-help').hidden = !draft;
  $('#photos').replaceChildren(...c.photos.map(({ key, uploaded }) => {
    const src = `/api/cases/${c.id}/photos/${key}`;
    const name = personLabel(key, c.applicant);
    const picture = uploaded
      ? el('img', { src: `${src}?t=${Date.now()}`, alt: `Photo of ${name}` })
      : el('div', { className: 'empty', textContent: 'No photo yet' });
    const cell = el('div', { className: 'photo' }, picture, el('b', { textContent: name }));
    if (draft) {
      const input = el('input', { type: 'file', accept: 'image/*' });
      input.setAttribute('aria-label', `Choose photo for ${name}`);
      input.addEventListener('change', () => run(input, async () => {
        const photo = await prepareDvPhoto(input.files[0]);
        await api('PUT', src, photo, 'image/jpeg');
        await reload();
      }));
      cell.append(input);
    } else if (uploaded) {
      cell.append(el('a', { className: 'btn small', href: `${src}?download=1`, textContent: 'Download' }));
    }
    return cell;
  }));
}

// ---------- the action panel: one next step per stage ----------

const action = (path, body) => async () => render(await api('POST', `/api/cases/${caseId}/${path}`, body));

function actionButton(text, handler, primary = true) {
  const button = el('button', { type: 'button', className: primary ? 'btn primary' : 'btn', textContent: text });
  button.addEventListener('click', () => run(button, handler));
  return button;
}

function reopenButton() {
  return actionButton('Reopen for corrections', async () => {
    const reason = prompt('What needs correcting? This clears the checks.');
    if (reason === null) return;
    await action('reopen', { reason })();
  }, false);
}

function cardSection() {
  const details = el('div', { className: 'vcard' },
    el('div', { className: 'card-line' }, el('span', { textContent: 'Bitnob virtual card' }), el('b', { textContent: 'VISA' })),
    el('p', { className: 'number', textContent: '•••• •••• •••• ••••' }));
  const reveal = actionButton('Reveal card · logged', async () => {
    const card = await api('GET', `/api/cases/${caseId}/card`);
    const address = card.billingAddress && typeof card.billingAddress === 'object'
      ? Object.values(card.billingAddress).filter(Boolean).join(', ') : (card.billingAddress ?? '');
    details.replaceChildren(
      ...[['Number', card.cardNumber], ['Expiry', card.expiry], ['CVV', card.cvv], ['Name', card.nameOnCard], ['Billing address', address]]
        .filter(([, v]) => v)
        .map(([k, v]) => el('div', { className: 'card-line' }, el('span', { textContent: k }), el('b', { className: 'mono', textContent: v }), copyButton(String(v)))),
    );
    reveal.remove();
    loadActivity();
  }, false);
  return [details, reveal];
}

function renderAction(c) {
  const missing = c.photos.filter((p) => !p.uploaded).length;
  const checks = c.checks ?? {};
  let parts = [];

  if (c.status === 'draft') {
    const button = actionButton('Mark first check done · Abol', action('check'));
    button.disabled = missing > 0;
    parts = [
      el('p', { className: 'eyebrow on-navy', textContent: 'Next: ዐቦል Abol' }),
      el('h2', { textContent: 'First check' }),
      el('p', { className: 'muted', textContent: 'Compare every field with the passport and look at every photo. Save any changes first.' }),
      missing ? el('p', { className: 'muted', textContent: `Waiting for ${missing} photo${missing > 1 ? 's' : ''}.` }) : null,
      button,
    ];
  } else if (c.status === 'checked') {
    const sameMe = checks.abol?.by === me.id;
    const button = actionButton('Mark second check done · Tona', action('verify'));
    button.disabled = sameMe;
    parts = [
      el('p', { className: 'eyebrow on-navy', textContent: 'Next: ቶና Tona' }),
      el('h2', { textContent: 'Second check, fresh eyes' }),
      el('p', { className: 'muted', textContent: sameMe
        ? 'You did the first check, so someone else must do this one.'
        : `${checks.abol?.name ?? 'A colleague'} did the first check. Go through everything again.` }),
      button, reopenButton(),
    ];
  } else if (c.status === 'verified') {
    const select = el('select');
    fillSelect(select, options.approvalMethods ?? []);
    parts = [
      el('p', { className: 'eyebrow on-navy', textContent: 'Next: በረካ Baraka' }),
      el('h2', { textContent: "Applicant's approval" }),
      el('p', { className: 'muted', textContent: 'Read the entry back to the applicant. Record approval only when they confirm everything.' }),
      el('label', { className: 'field' }, 'How did they approve?', select),
      actionButton('Record approval · Baraka', async () => action('approve', { method: select.value })()),
      reopenButton(),
    ];
  } else if (c.status === 'approved') {
    parts = [
      el('p', { className: 'eyebrow on-navy', textContent: 'Next: pay the fee' }),
      el('h2', { textContent: 'Issue the payment card' }),
      el('p', { className: 'muted', textContent: 'Creates a one-time Bitnob virtual card loaded with the official fee.' }),
      actionButton('Issue card', async () => {
        if (!confirm('Issue and fund a virtual card for this case?')) return;
        await action('card')();
      }),
      reopenButton(),
    ];
  } else if (c.status === 'card_issued') {
    const input = el('input', { placeholder: '2027…', autocomplete: 'off' });
    parts = [
      el('h2', { textContent: 'File on the official site' }),
      el('ol', {},
        el('li', {}, 'Open ', el('a', { href: 'https://dvprogram.state.gov', target: '_blank', rel: 'noopener', textContent: 'dvprogram.state.gov' })),
        el('li', { textContent: 'Copy each field, then upload the photos' }),
        el('li', { textContent: 'Pay the fee with this card, using its billing address' }),
        el('li', { textContent: 'Paste the confirmation number below' })),
      ...cardSection(),
      el('label', { className: 'field' }, 'Confirmation number', input),
      actionButton('Mark as submitted', async () => action('submit', { confirmationNumber: input.value })()),
    ];
  } else if (c.status === 'submitted') {
    parts = [
      el('p', { className: 'eyebrow on-navy', textContent: 'Submitted · ገብቷል' }),
      el('h2', { textContent: 'Confirmation number' }),
      el('p', { className: 'big-number', textContent: c.confirmationNumber }),
      copyButton(c.confirmationNumber),
      el('p', { className: 'muted', textContent: 'Give this number to the applicant. They need it to check results.' }),
    ];
  }
  $('#action').replaceChildren(...parts.filter(Boolean));
}

// ---------- header, stages, assignment, activity ----------

function renderStages(c) {
  const at = STAGE_ORDER.indexOf(c.status);
  const checks = c.checks ?? {};
  const items = [
    ['Abol', 1, checks.abol?.name],
    ['Tona', 2, checks.tona?.name],
    ['Baraka', 3, checks.baraka ? label(checks.baraka.method) : null],
    ['Card', 4, null],
    ['Submitted', 5, null],
  ];
  $('#stages').hidden = false;
  $('#stages').replaceChildren(...items.map(([name, step, who]) => {
    const li = el('li', { textContent: at >= step ? `✓ ${name}${who ? ` · ${who}` : ''}` : name });
    li.className = at >= step ? 'done' : at + 1 === step ? 'now' : '';
    return li;
  }));
}

function renderAssign(c) {
  $('#assign-box').hidden = false;
  const select = $('#assign');
  select.replaceChildren(new Option('Unassigned', ''), ...directory.map((s) => new Option(s.name, s.id)));
  select.value = c.assignedTo ?? '';
}

async function loadActivity() {
  const events = await api('GET', `/api/cases/${caseId}/activity`);
  $('#activity').replaceChildren(...events.slice(0, 12).map((e) => el('li', {},
    el('b', { textContent: label(e.action.replace('check_', 'check: ').replace('bitnob:', 'Bitnob: ')) }),
    ` · ${e.staffName ?? 'system'} · ${timeAgo(e.at)}${e.detail ? ` · ${e.detail}` : ''}`)));
}

function render(c) {
  caseId = c.id;
  const draft = c.status === 'draft';
  document.title = `${c.code} — Ethio DV Assist staff`;
  $('#title').textContent = personName(c.applicant);
  $('#meta').textContent = `${c.code} · ${c.photos.length} ${c.photos.length === 1 ? 'person' : 'people'} · ${STAGE_LABELS[c.status]}`;
  renderStages(c);
  renderAssign(c);

  form.hidden = !draft;
  if (draft) writeForm(c.applicant);
  $('#copy-card').hidden = draft;
  if (!draft) renderCopy(c.applicant);

  $('#photos-card').hidden = false;
  renderPhotos(c);
  $('#side').hidden = false;
  renderAction(c);
  loadActivity().catch(showError);
}

async function reload() {
  render(await api('GET', `/api/cases/${caseId}`));
}

// ---------- events ----------

form.maritalStatus.addEventListener('change', toggleSpouse);
$('#add-child').addEventListener('click', () => addChild());
form.addEventListener('submit', (e) => {
  e.preventDefault();
  run($('#save'), async () => {
    const saved = caseId
      ? await api('PUT', `/api/cases/${caseId}`, readForm())
      : await api('POST', '/api/cases', readForm());
    if (!caseId) history.replaceState(null, '', `/case.html?id=${saved.id}`);
    render(saved);
  });
});
$('#assign').addEventListener('change', (e) => run(e.target, async () => {
  render(await api('POST', `/api/cases/${caseId}/assign`, { staffId: e.target.value || null }));
}));

// ---------- init ----------

try {
  me = await loadShell();
  fillPersonFieldset($('[data-person="applicant"]'));
  fillPersonFieldset($('[data-person="spouse"]'));
  [options, directory] = await Promise.all([api('GET', '/api/options'), api('GET', '/api/staff/directory')]);
  fillSelect(form.education, options.educationLevels);
  fillSelect(form.maritalStatus, options.maritalStatuses);
  toggleSpouse();
  if (caseId) await reload();
} catch (err) {
  showError(err);
}
