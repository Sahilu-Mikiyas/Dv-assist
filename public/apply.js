// Applicant flow: package → details → (code) → photos → review → status.
// The server keeps the entry; this page only renders it and sends changes.

import { $, el } from '/dom.js';
import { prepareDvPhoto } from '/photo-prep.js';

const PACKAGES = {
  self: { name: 'Self-guided', am: 'በራስዎ', price: '500', points: ['We review your form', 'Photo checked and resized', 'You submit it yourself'] },
  managed: { name: 'Managed', am: 'እኛ እናስተዳድራለን', price: '1,500', points: ['Everything in Self-guided', 'We file your entry for you', 'Official fee paid for you', 'Confirmation number by SMS'] },
  assisted: { name: 'Assisted', am: 'በእገዛ', price: '2,000', points: ['Everything in Managed', 'Sit down with us at the office', 'Spouse and children handled', 'We check results for you'] },
  vip: { name: 'VIP', am: 'ልዩ አገልግሎት', price: '3,000', points: ['Everything in Assisted', 'Your own agent, start to finish', 'We come to you', 'A call on results day'] },
};

const EDUCATION = {
  primary_school_only: 'Primary school only',
  some_high_school_no_diploma: 'Some high school, no diploma',
  high_school_diploma: 'High school diploma',
  vocational_school: 'Vocational school',
  some_university_courses: 'Some university courses',
  university_degree: 'University degree',
  some_graduate_level_courses: 'Some graduate-level courses',
  masters_degree: "Master's degree",
  some_doctorate_level_courses: 'Some doctorate-level courses',
  doctorate: 'Doctorate',
};

const MARITAL = {
  unmarried: 'Unmarried',
  married_spouse_not_us_citizen_or_lpr: 'Married — spouse is not a U.S. citizen or resident',
  married_spouse_us_citizen_or_lpr: 'Married — spouse is a U.S. citizen or resident',
  divorced: 'Divorced',
  widowed: 'Widowed',
  legally_separated: 'Legally separated',
};
const NEEDS_SPOUSE = 'married_spouse_not_us_citizen_or_lpr';

const FIELD_NAMES = {
  lastName: 'last name', firstName: 'first name', gender: 'gender', birthDate: 'birth date', birthCity: 'city of birth',
  birthCountry: 'country of birth', eligibilityCountry: 'country of eligibility', mailingAddress: 'mailing address',
  residenceCountry: 'country where you live', email: 'email', education: 'education', maritalStatus: 'marital status',
};

let app = null; // the entry as the server sees it, once created
let chosenPackage = new URLSearchParams(location.search).get('package');
if (!PACKAGES[chosenPackage]) chosenPackage = 'managed';

// ---------- server ----------

async function api(method, path, body, contentType = 'application/json') {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': contentType } : {},
    body: body && contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(friendlyError(data));
    err.status = res.status;
    throw err;
  }
  return data;
}

// "children[1].birthDate must be YYYY-MM-DD" → "Child 2: birth date must be a date".
function friendlyError(data) {
  const details = (data.details ?? []).map((d) => d
    .replace(/^applicant\./, 'You: ')
    .replace(/^spouse\./, 'Spouse: ')
    .replace(/^children\[(\d+)\]\./, (_, i) => `Child ${Number(i) + 1}: `)
    .replace(/(\w+) (is required|is invalid|must be YYYY-MM-DD)/, (_, f, rule) => {
      const name = FIELD_NAMES[f] ?? f;
      if (rule === 'must be YYYY-MM-DD') return `${name} must be a full date`;
      if (rule === 'is invalid') return f === 'email' ? 'email address looks wrong' : `choose your ${name}`;
      return `${name} is required`;
    })
    .replace(/Photo missing for applicant/, 'Add your own photo')
    .replace(/Photo missing for spouse/, "Add your spouse's photo")
    .replace(/Photo missing for child(\d+)/, (_, i) => `Add a photo for child ${Number(i) + 1}`));
  return details.length ? details.join('\n') : (data.error ?? 'Something went wrong. Try again.');
}

function showError(err) {
  const box = $('#error');
  box.textContent = err ? err.message : '';
  box.hidden = !err;
  if (err) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

let busy = false;
async function run(button, action) {
  if (busy) return;
  busy = true;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Working…';
  showError(null);
  try {
    await action();
  } catch (err) {
    showError(err);
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = original;
  }
}

// ---------- views ----------

const STEP_ORDER = ['details', 'photos', 'review', 'checking', 'submitted'];

function show(view, step = view) {
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `view-${view}`;
  $('#loading').hidden = true;
  $('#steps').hidden = !STEP_ORDER.includes(step);
  const current = STEP_ORDER.indexOf(step);
  for (const li of document.querySelectorAll('#steps li')) {
    const i = STEP_ORDER.indexOf(li.dataset.step);
    li.classList.toggle('done', i < current);
    li.classList.toggle('current', i === current);
    if (i === current) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  }
  const pkg = PACKAGES[app?.package ?? chosenPackage];
  $('#package-chip').textContent = `${pkg.name} · ${pkg.price} ETB`;
  $('#package-chip').hidden = view === 'package' || view === 'resume';
  $('#saved-note').hidden = !app || !app.editable;
  showError(null);
  window.scrollTo({ top: 0 });
}

// ---------- package ----------

function renderPackages() {
  const box = $('#packages');
  box.replaceChildren(...Object.entries(PACKAGES).map(([key, p]) => {
    const card = el('button', { type: 'button', className: 'package', role: 'radio' },
      key === 'managed' ? el('span', { className: 'badge', textContent: 'Recommended' }) : null,
      el('span', { className: 'package-name', textContent: p.name }),
      el('span', { className: 'am-small', lang: 'am', textContent: p.am }),
      el('span', { className: 'price' }, el('b', { textContent: p.price }), ' ETB'),
      el('ul', {}, ...p.points.map((t) => el('li', { textContent: t }))));
    card.setAttribute('aria-checked', String(key === chosenPackage));
    card.addEventListener('click', () => {
      chosenPackage = key;
      renderPackages();
    });
    return card;
  }));
}

$('#package-next').addEventListener('click', () => show('details'));

// ---------- details form ----------

function personFields(container, prefix) {
  const fragment = $('#person-fields').content.cloneNode(true);
  for (const radio of fragment.querySelectorAll('input[type=radio]')) radio.name = `${prefix}-gender`;
  container.replaceChildren(fragment);
}

function readPerson(container) {
  const value = (f) => container.querySelector(`[data-f="${f}"]`)?.value.trim() ?? '';
  return {
    lastName: value('lastName'),
    firstName: value('firstName'),
    middleName: value('middleName'),
    noFirstName: container.querySelector('[data-f="noFirstName"]').checked,
    gender: container.querySelector('[data-f="gender"]:checked')?.value ?? '',
    birthDate: value('birthDate'),
    birthCity: value('birthCity'),
    birthCountry: value('birthCountry'),
  };
}

function fillPerson(container, person) {
  for (const [f, v] of Object.entries(person ?? {})) {
    const inputs = container.querySelectorAll(`[data-f="${f}"]`);
    for (const input of inputs) {
      if (input.type === 'radio') input.checked = input.value === v;
      else if (input.type === 'checkbox') input.checked = Boolean(v);
      else input.value = v ?? '';
    }
  }
}

let childCounter = 0;
function addChild(child) {
  const id = childCounter++;
  const body = el('div');
  const box = el('fieldset', { className: 'person-box child' },
    el('legend', {}, 'Child ', el('span', { className: 'child-no' }), el('span', { lang: 'am', textContent: ' · ልጅ' })),
    body,
    el('button', { type: 'button', className: 'link-btn', textContent: 'Remove this child', onclick: () => { box.remove(); renumber(); } }));
  personFields(body, `child${id}`);
  if (child) fillPerson(body, child);
  $('#children').append(box);
  renumber();
}

function renumber() {
  [...document.querySelectorAll('#children .child-no')].forEach((span, i) => { span.textContent = String(i + 1); });
  const people = 1 + (needsSpouse() ? 1 : 0) + $('#children').children.length;
  $('#people-count').textContent = `${people} ${people === 1 ? 'person' : 'people'}`;
}

const form = $('#details-form');
const needsSpouse = () => form.elements.namedItem('maritalStatus').value === NEEDS_SPOUSE;

function setupDetailsForm() {
  personFields($('#applicant-person'), 'applicant');
  personFields($('#spouse-person'), 'spouse');
  const select = (name, options, placeholder) => form.elements.namedItem(name).replaceChildren(
    el('option', { value: '', textContent: placeholder }),
    ...Object.entries(options).map(([value, text]) => el('option', { value, textContent: text })));
  select('education', EDUCATION, 'Choose…');
  select('maritalStatus', MARITAL, 'Choose…');
  form.elements.namedItem('maritalStatus').addEventListener('change', () => {
    $('#spouse-box').hidden = !needsSpouse();
    renumber();
  });
  $('#add-child').addEventListener('click', () => addChild());
}

function fillDetails(a) {
  fillPerson($('#applicant-person'), a);
  for (const name of ['eligibilityCountry', 'residenceCountry', 'mailingAddress', 'phone', 'email', 'education', 'maritalStatus']) {
    form.elements.namedItem(name).value = a[name] ?? '';
  }
  $('#spouse-box').hidden = !a.spouse;
  if (a.spouse) fillPerson($('#spouse-person'), a.spouse);
  $('#children').replaceChildren();
  a.children.forEach((c) => addChild(c));
  renumber();
}

function readDetails() {
  const v = (name) => form.elements.namedItem(name).value.trim();
  return {
    ...readPerson($('#applicant-person')),
    eligibilityCountry: v('eligibilityCountry'),
    residenceCountry: v('residenceCountry'),
    mailingAddress: v('mailingAddress'),
    phone: v('phone'),
    email: v('email'),
    education: v('education'),
    maritalStatus: v('maritalStatus'),
    spouse: needsSpouse() ? readPerson($('#spouse-person')) : null,
    children: [...$('#children').children].map((box) => readPerson(box.querySelector('div'))),
  };
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  run(form.querySelector('[type=submit]'), async () => {
    const body = { package: app?.package ?? chosenPackage, applicant: readDetails() };
    if (app) {
      app = await api('PUT', '/api/apply', body);
      renderPhotos();
      show('photos');
    } else {
      const started = await api('POST', '/api/apply/start', body);
      app = started.application;
      $('#resume-code').textContent = started.resumeCode;
      show('code', 'details');
    }
  });
});

$('#details-back').addEventListener('click', () => (app ? show('review') : show('package')));

// ---------- resume code ----------

$('#copy-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#resume-code').textContent);
    $('#copy-code').textContent = 'Copied';
  } catch {
    $('#copy-code').textContent = 'Select and copy it by hand';
  }
});
$('#code-saved').addEventListener('change', (e) => { $('#code-next').disabled = !e.target.checked; });
$('#code-next').addEventListener('click', () => {
  renderPhotos();
  show('photos');
});

$('#resume-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  run(button, async () => {
    app = await api('POST', '/api/apply/resume', { code: event.target.elements.namedItem('code').value });
    history.replaceState(null, '', '/apply');
    route();
  });
});

// ---------- photos ----------

const people = () => {
  const a = app.applicant;
  return [
    { key: 'applicant', name: `${a.firstName || a.lastName} (you)` },
    ...(a.spouse ? [{ key: 'spouse', name: `${a.spouse.firstName || a.spouse.lastName} (spouse)` }] : []),
    ...a.children.map((c, i) => ({ key: `child${i}`, name: `${c.firstName || c.lastName} (child ${i + 1})` })),
  ];
};

const photoUrl = (key) => `/api/apply/photos/${key}?v=${Date.now()}`;

function renderPhotos() {
  const uploaded = new Set(app.photos.filter((p) => p.uploaded).map((p) => p.key));
  $('#photo-list').replaceChildren(...people().map(({ key, name }) => {
    const input = el('input', { type: 'file', accept: 'image/*', className: 'visually-hidden', id: `file-${key}` });
    const status = el('p', { className: uploaded.has(key) ? 'ok' : 'muted', textContent: uploaded.has(key) ? '✓ Ready, 600 × 600' : 'No photo yet' });
    const preview = uploaded.has(key)
      ? el('img', { src: photoUrl(key), alt: `Photo of ${name}`, width: 160, height: 160 })
      : el('span', { className: 'photo-empty', textContent: name.slice(0, 1).toUpperCase() });
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const label = card.querySelector('label');
      run(label, async () => {
        const blob = await prepareDvPhoto(file);
        app = await api('PUT', `/api/apply/photos/${key}`, blob, 'image/jpeg');
        renderPhotos();
      });
    });
    const card = el('div', { className: `photo-card${uploaded.has(key) ? ' has' : ''}` },
      preview,
      el('div', {}, el('p', { className: 'photo-name', textContent: name }), status,
        input, el('label', { htmlFor: `file-${key}`, className: 'btn ghost small', textContent: uploaded.has(key) ? 'Replace photo' : 'Choose photo' })));
    return card;
  }));
  $('#photo-count').textContent = `${uploaded.size} of ${people().length} photos ready`;
}

$('#photos-back').addEventListener('click', () => {
  fillDetails(app.applicant);
  show('details');
});
$('#photos-next').addEventListener('click', () => {
  const missing = app.photos.filter((p) => !p.uploaded).length;
  if (missing) return showError(new Error(`Add ${missing === 1 ? 'the last photo' : `the ${missing} missing photos`} first.`));
  renderSummary($('#summary'), true);
  show('review');
});

// ---------- review ----------

const longDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
const fullName = (p) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');

function renderSummary(target, editable) {
  const a = app.applicant;
  const row = (dt, dd) => el('div', {}, el('dt', { textContent: dt }), el('dd', { textContent: dd || '—' }));
  const edit = (view) => (editable ? el('button', { type: 'button', className: 'link-btn', textContent: 'Edit', onclick: view }) : null);
  const toDetails = () => { fillDetails(app.applicant); show('details'); };
  const toPhotos = () => { renderPhotos(); show('photos'); };
  const family = [
    ...(a.spouse ? [{ p: a.spouse, role: 'Spouse', key: 'spouse' }] : []),
    ...a.children.map((c, i) => ({ p: c, role: c.gender === 'female' ? 'Daughter' : 'Son', key: `child${i}` })),
  ];
  target.replaceChildren(
    el('header', {},
      el('div', {}, el('p', { className: 'eyebrow', textContent: 'DV entry summary' }), el('p', { className: 'summary-name', textContent: fullName(a) })),
      el('span', { className: 'case-chip', textContent: `Entry ${app.code}` })),
    el('div', { className: 'summary-body' },
      el('div', { className: 'summary-photo' }, el('img', { src: photoUrl('applicant'), alt: 'Your photo', width: 120, height: 120 }), edit(toPhotos)),
      el('dl', {},
        row('Born', `${longDate(a.birthDate)} · ${a.birthCity}, ${a.birthCountry}`),
        row('Gender', a.gender === 'female' ? 'Female' : 'Male'),
        row('Eligibility country', a.eligibilityCountry),
        row('Education', EDUCATION[a.education]),
        row('Marital status', MARITAL[a.maritalStatus]),
        row('Mailing address', a.mailingAddress),
        row('Phone · email', [a.phone, a.email].filter(Boolean).join(' · '))),
      edit(toDetails)),
    el('div', { className: 'summary-family' },
      el('p', { className: 'eyebrow', textContent: family.length ? 'Family · all must be listed' : 'Family · none listed' }),
      el('div', { className: 'family-grid' }, ...family.map(({ p, role, key }) => el('div', { className: 'family-card' },
        el('img', { src: photoUrl(key), alt: '', width: 48, height: 48 }),
        el('span', {}, el('strong', { textContent: fullName(p) }), el('br'), el('small', { textContent: `${role} · ${p.birthDate.slice(0, 4)}` })))))),
    el('p', { className: 'muted small', textContent: `Package: ${PACKAGES[app.package].name} · ${PACKAGES[app.package].price} ETB` }));
}

$('#review-back').addEventListener('click', () => { renderPhotos(); show('photos'); });
$('#send-form').addEventListener('submit', (event) => {
  event.preventDefault();
  run(event.target.querySelector('[type=submit]'), async () => {
    app = await api('POST', '/api/apply/send');
    renderStatus();
  });
});

// ---------- status ----------

function stageOf(a) {
  if (a.status === 'submitted') return 'submitted';
  if (a.status === 'approved' || a.status === 'card_issued') return 'filing';
  if (a.status === 'verified') return 'approve';
  return 'checking';
}

const STATUS_TEXT = {
  checking: ['We are checking your entry', 'ምዝገባዎን እያጣራን ነው', 'Two people on our team check every detail and photo. We will contact you if anything needs fixing.'],
  approve: ['Your approval is needed', 'ፈቃድዎ ያስፈልጋል', 'Both checks are done. Read your entry and approve it below.'],
  filing: ['Approved. We are filing your entry', 'ጸድቋል፤ እያስገባን ነው', 'Our team will file your entry on the official site and send you the confirmation number.'],
  submitted: ['Your entry is submitted', 'ምዝገባዎ ገብቷል', 'Your entry is on the official site. Keep your confirmation number safe.'],
};

function renderStatus() {
  const stage = stageOf(app);
  const [title, titleAm, lead] = STATUS_TEXT[stage];
  $('#status-code').textContent = `Entry ${app.code}`;
  $('#status-title').textContent = title;
  $('#status-title-am').textContent = titleAm;
  $('#status-lead').textContent = lead;
  $('#confirmation').hidden = !app.confirmationNumber;
  $('#confirmation-number').textContent = app.confirmationNumber ?? '';
  $('#approve-form').hidden = stage !== 'approve';
  $('#payment-note').hidden = stage === 'submitted';
  if (stage === 'approve') renderSummary($('#approve-summary'), false);

  const steps = [
    ['Sent for checking', 'ለማጣራት ተልኳል', Boolean(app.sentAt)],
    ['Abol: first check', 'ዐቦል', app.checks.abol],
    ['Tona: second check', 'ቶና', app.checks.tona],
    ['Baraka: your approval', 'በረካ', app.checks.baraka],
    ['Filed on the official site', 'ገብቷል', app.status === 'submitted'],
  ];
  const next = steps.findIndex(([, , done]) => !done);
  $('#timeline').replaceChildren(...steps.map(([text, am, done], i) => el('li', { className: done ? 'done' : i === next ? 'current' : '' },
    el('span', { className: 'dot', textContent: done ? '✓' : String(i + 1) }),
    el('span', {}, el('strong', { textContent: text }), ' ', el('span', { lang: 'am', className: 'am-small', textContent: am })))));
  show('status', stage === 'submitted' ? 'submitted' : 'checking');
}

$('#approve-form').addEventListener('submit', (event) => {
  event.preventDefault();
  run(event.target.querySelector('[type=submit]'), async () => {
    app = await api('POST', '/api/apply/approve', { confirm: true });
    renderStatus();
  });
});

$('#leave').addEventListener('click', async () => {
  if (!confirm('Sign out? You will need your code to come back.')) return;
  await api('POST', '/api/apply/leave').catch(() => {});
  location.href = '/';
});

// ---------- start ----------

function route() {
  if (!app) return location.hash === '#resume' ? show('resume') : show('package');
  if (!app.editable) return renderStatus();
  fillDetails(app.applicant);
  if (app.photos.some((p) => !p.uploaded)) {
    renderPhotos();
    return show('photos');
  }
  renderSummary($('#summary'), true);
  return show('review');
}

window.addEventListener('hashchange', () => {
  if (!app && location.hash === '#resume') show('resume');
});

setupDetailsForm();
renderPackages();
try {
  app = await api('GET', '/api/apply');
} catch (err) {
  if (err.status !== 401) showError(err);
}
route();
