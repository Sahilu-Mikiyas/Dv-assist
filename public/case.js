import { api, $, showError, label, personName } from '/app.js';

const SPOUSE_REQUIRED = 'married_spouse_not_us_citizen_or_lpr';
const PERSON_FIELDS = ['lastName', 'firstName', 'middleName', 'gender', 'birthDate', 'birthCity', 'birthCountry'];

const form = $('#form');
let caseId = new URLSearchParams(location.search).get('id');

// ---------- form building ----------

function fillPersonFieldset(fieldset) {
  fieldset.append($('#person-fields').content.cloneNode(true));
}

function addChild(child) {
  const fieldset = document.createElement('fieldset');
  fieldset.dataset.person = 'child';
  fieldset.innerHTML = '<legend>Child</legend>';
  fillPersonFieldset(fieldset);
  const remove = Object.assign(document.createElement('button'), {
    type: 'button', className: 'secondary', textContent: 'Remove child',
  });
  remove.addEventListener('click', () => fieldset.remove());
  fieldset.append(remove);
  $('#children').append(fieldset);
  if (child) writePerson(fieldset, child);
}

function fillSelect(select, values) {
  select.innerHTML = '<option value="">—</option>';
  for (const v of values) select.append(new Option(label(v), v));
}

function toggleSpouse() {
  const spouse = $('[data-person="spouse"]');
  spouse.hidden = form.maritalStatus.value !== SPOUSE_REQUIRED;
  spouse.disabled = spouse.hidden;
}

// ---------- form <-> data ----------

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
  const fields = ['eligibilityCountry', 'mailingAddress', 'residenceCountry', 'phone', 'email', 'education', 'maritalStatus'];
  return {
    ...readPerson($('[data-person="applicant"]')),
    ...Object.fromEntries(fields.map((f) => [f, form[f].value])),
    spouse: form.maritalStatus.value === SPOUSE_REQUIRED ? readPerson($('[data-person="spouse"]')) : null,
    children: [...document.querySelectorAll('[data-person="child"]')].map(readPerson),
  };
}

function writeForm(a) {
  writePerson($('[data-person="applicant"]'), a);
  for (const f of ['eligibilityCountry', 'mailingAddress', 'residenceCountry', 'phone', 'email', 'education', 'maritalStatus']) {
    form[f].value = a[f] ?? '';
  }
  if (a.spouse) writePerson($('[data-person="spouse"]'), a.spouse);
  $('#children').replaceChildren();
  a.children.forEach(addChild);
  toggleSpouse();
}

// ---------- rendering ----------

function renderPhotos(c) {
  $('#photos').replaceChildren(...c.photos.map(({ key, uploaded }) => {
    const row = document.createElement('div');
    row.className = 'photo';
    const img = document.createElement('img');
    if (uploaded) img.src = `/api/cases/${c.id}/photos/${key}?t=${Date.now()}`;
    else img.alt = 'none';
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/jpeg' });
    input.disabled = c.status !== 'draft';
    input.addEventListener('change', async () => {
      try {
        showError(null);
        await api('PUT', `/api/cases/${c.id}/photos/${key}`, input.files[0], 'image/jpeg');
        render(await api('GET', `/api/cases/${c.id}`));
      } catch (err) {
        showError(err);
        input.value = '';
      }
    });
    const name = Object.assign(document.createElement('strong'), { textContent: key });
    row.append(img, name, input);
    return row;
  }));
}

function render(c) {
  $('#title').textContent = personName(c.applicant);
  writeForm(c.applicant);
  const editable = c.status === 'draft';
  for (const el of form.elements) el.disabled = !editable;
  toggleSpouse();
  if (!editable) $('[data-person="spouse"]').disabled = true;

  $('#photos-section').hidden = false;
  renderPhotos(c);

  $('#pay-section').hidden = false;
  $('#pay-draft').hidden = c.status !== 'draft';
  $('#issue-card').disabled = !c.photos.every((p) => p.uploaded);
  $('#pay-issued').hidden = c.status !== 'card_issued';
  $('#pay-done').hidden = c.status !== 'submitted';
  $('#confirmation').textContent = c.confirmationNumber ?? '';
}

// ---------- actions ----------

form.maritalStatus.addEventListener('change', toggleSpouse);
$('#add-child').addEventListener('click', () => addChild());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    showError(null);
    const saved = caseId
      ? await api('PUT', `/api/cases/${caseId}`, readForm())
      : await api('POST', '/api/cases', readForm());
    if (!caseId) {
      caseId = saved.id;
      history.replaceState(null, '', `/case.html?id=${caseId}`);
    }
    render(saved);
  } catch (err) {
    showError(err);
  }
});

$('#issue-card').addEventListener('click', async (e) => {
  if (!confirm('Issue and fund a virtual card for this case?')) return;
  e.target.disabled = true;
  try {
    showError(null);
    render(await api('POST', `/api/cases/${caseId}/card`));
  } catch (err) {
    showError(err);
    e.target.disabled = false;
  }
});

$('#show-card').addEventListener('click', async () => {
  try {
    showError(null);
    const card = await api('GET', `/api/cases/${caseId}/card`);
    $('#card').textContent = [
      `Name:    ${card.nameOnCard ?? ''}`,
      `Number:  ${card.cardNumber ?? ''}`,
      `Expiry:  ${card.expiry ?? ''}`,
      `CVV:     ${card.cvv ?? ''}`,
      card.billingAddress ? `Billing: ${JSON.stringify(card.billingAddress)}` : '',
    ].filter(Boolean).join('\n');
    $('#card').hidden = false;
  } catch (err) {
    showError(err);
  }
});

$('#submit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    showError(null);
    render(await api('POST', `/api/cases/${caseId}/submit`, { confirmationNumber: e.target.confirmationNumber.value }));
  } catch (err) {
    showError(err);
  }
});

// ---------- init ----------

try {
  fillPersonFieldset($('[data-person="applicant"]'));
  fillPersonFieldset($('[data-person="spouse"]'));
  const options = await api('GET', '/api/options');
  fillSelect(form.education, options.educationLevels);
  fillSelect(form.maritalStatus, options.maritalStatuses);
  toggleSpouse();
  if (caseId) render(await api('GET', `/api/cases/${caseId}`));
} catch (err) {
  showError(err);
}
