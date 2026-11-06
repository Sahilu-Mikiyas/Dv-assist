// Applicant flow: package → details → (code) → photos → review → status.
// The server keeps the entry; this page only renders it and sends changes.

import { $, el } from '/dom.js';
import { openPhotoEditor } from '/photo/editor.js';
import { prepareScan } from '/photo/scan.js';

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
  passportNumber: 'passport number', passportCountry: 'passport issuing country', passportExpiry: 'passport expiry date',
};

let app = null; // the entry as the server sees it, once created
const params = new URLSearchParams(location.search);
let chosenPackage = params.get('package');
if (!PACKAGES[chosenPackage]) chosenPackage = 'managed';
// Referral partner links: ?ref=<partner code>, ?invite=<introduction reference>, and ?together=1 when a
// partner fills the entry in with the applicant on the partner's own phone.
const referral = { ref: params.get('ref'), invite: params.get('invite'), together: params.get('together') === '1' };
// A resume code shown once survives a reload of the same tab until the applicant confirms they saved it.
const pendingCode = {
  get: () => { try { return sessionStorage.getItem('pending-code'); } catch { return null; } },
  set: (code) => { try { if (code) sessionStorage.setItem('pending-code', code); else sessionStorage.removeItem('pending-code'); } catch { /* private mode */ } },
};

// Remembers, for this browser tab only, that a together-entry is in progress, so a reload keeps it open.
const tabFlag = {
  get: () => { try { return sessionStorage.getItem('together-started') === '1'; } catch { return false; } },
  set: (on) => { try { if (on) sessionStorage.setItem('together-started', '1'); else sessionStorage.removeItem('together-started'); } catch { /* private mode */ } },
};

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
    .replace(/^applicant\.passportExpiry has passed.*$/, 'Your passport has expired: renew it before entering')
    .replace(/(\w+) must be written in English letters as in the passport/, (_, f) => `${FIELD_NAMES[f] ?? f} must be in English letters, exactly as in the passport`)
    .replace(/birthDate is not possible/, 'birth date is not possible')
    .replace(/birthDate: only children under 21 are listed/, 'only children under 21 are listed on a DV entry')
    .replace(/^applicant\./, 'You: ')
    .replace(/^spouse\./, 'Spouse: ')
    .replace(/^children\[(\d+)\]\./, (_, i) => `Child ${Number(i) + 1}: `)
    .replace(/(\w+) (is required|is invalid|must be YYYY-MM-DD)/, (_, f, rule) => {
      const name = FIELD_NAMES[f] ?? f;
      if (rule === 'must be YYYY-MM-DD') return `${name} must be a full date`;
      if (rule === 'is invalid') {
        if (f === 'email') return 'email address looks wrong';
        if (f === 'passportNumber') return 'passport number looks wrong: copy the letters and digits from your passport';
        return `choose your ${name}`;
      }
      return `${name} is required`;
    })
    .replace(/Photo missing for applicant/, 'Add your own photo')
    .replace(/Passport scan missing/, "Add a picture of your passport's photo page")

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

// Each step is a browser-history entry: Back and Forward move between steps instead of leaving the page.
let restoring = false;
window.addEventListener('popstate', (event) => {
  const view = event.state?.view;
  if (!view) return;
  restoring = true;
  try {
    if (view === 'photos' && app) renderPhotos();
    if (view === 'review' && app) renderSummary($('#summary'), true);
    if (view === 'status' && app) return renderStatus();
    // Steps that need a saved entry fall back to the package choice when there is none yet.
    show(app || ['package', 'details', 'resume'].includes(view) ? view : 'package', event.state.step);
  } finally {
    restoring = false;
  }
});

function show(view, step = view) {
  if (!restoring) {
    const state = { view, step };
    if (history.state?.view) history.pushState(state, ''); else history.replaceState(state, '');
  }
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
  for (const name of ['eligibilityCountry', 'residenceCountry', 'mailingAddress', 'phone', 'email', 'education', 'maritalStatus', 'passportNumber', 'passportCountry', 'passportExpiry']) {
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
    passportNumber: v('passportNumber'),
    passportCountry: v('passportCountry'),
    passportExpiry: v('passportExpiry'),
    spouse: needsSpouse() ? readPerson($('#spouse-person')) : null,
    children: [...$('#children').children].map((box) => readPerson(box.querySelector('div'))),
  };
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  run(form.querySelector('[type=submit]'), async () => {
    const body = { package: app?.package ?? chosenPackage, applicant: readDetails(), expectedUpdatedAt: app?.updatedAt };
    if (app) {
      app = await api('PUT', '/api/apply', body);
      renderPhotos();
      show('photos');
    } else {
      const started = await api('POST', '/api/apply/start', {
        ...body, ref: referral.ref ?? undefined, invite: referral.invite ?? undefined, together: referral.together,
      });
      app = started.application;
      // Filled in together: the code is sent to the applicant, never shown on the partner's phone.
      $('#resume-code').textContent = started.resumeCode ?? 'Sent to your phone or email';
      pendingCode.set(started.resumeCode);
      $('#copy-code').hidden = !started.resumeCode;
      $('#code-together').hidden = !started.together;
      if (started.together) {
        $('#code-saved').checked = true;
        $('#code-saved').closest('label').hidden = true;
        $('#code-next').disabled = false;
      }
      tabFlag.set(started.together);
      show('code', 'details');
    }
  });
});

$('#details-back').addEventListener('click', () => {
  if (!app) return show('package');
  renderPhotos();
  return show('photos');
});

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
  pendingCode.set(null);
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
      input.value = ''; // so choosing the same file again still opens the editor
      if (!file) return;
      const label = card.querySelector('label');
      run(label, async () => {
        const edited = await openPhotoEditor(file, { title: `Photo of ${name}` });
        if (!edited) return;
        app = await api('PUT', `/api/apply/photos/${key}`, edited.blob, 'image/jpeg');
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
  renderDocuments();
}

const DOCUMENTS = [
  { kind: 'passport', name: 'Passport photo page', note: 'Required' },
  { kind: 'passport_signature', name: 'Signature page', note: 'Only if your signature is on a different page' },
];

function renderDocuments() {
  const uploaded = new Set((app.documents ?? []).filter((d) => d.uploaded).map((d) => d.kind));
  $('#document-list').replaceChildren(...DOCUMENTS.map(({ kind, name, note }) => {
    const input = el('input', { type: 'file', accept: 'image/*', className: 'visually-hidden', id: `doc-${kind}` });
    const label = el('label', { htmlFor: `doc-${kind}`, className: 'btn ghost small', textContent: uploaded.has(kind) ? 'Replace picture' : 'Add picture' });
    input.addEventListener('change', () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      run(label, async () => {
        app = await api('PUT', `/api/apply/documents/${kind}`, await prepareScan(file), 'image/jpeg');
        renderDocuments();
      });
    });
    return el('div', { className: `photo-card doc-card${uploaded.has(kind) ? ' has' : ''}` },
      uploaded.has(kind)
        ? el('img', { src: `/api/apply/documents/${kind}?v=${Date.now()}`, alt: name, width: 160, height: 110 })
        : el('span', { className: 'photo-empty doc-empty', textContent: '🛂' }),
      el('div', {}, el('p', { className: 'photo-name', textContent: name }),
        el('p', { className: uploaded.has(kind) ? 'ok' : 'muted', textContent: uploaded.has(kind) ? '✓ Added' : note }),
        input, label));
  }));
}

$('#photos-back').addEventListener('click', () => {
  fillDetails(app.applicant);
  show('details');
});
$('#photos-next').addEventListener('click', () => {
  const missing = app.photos.filter((p) => !p.uploaded).length;
  if (missing) return showError(new Error(`Add ${missing === 1 ? 'the last photo' : `the ${missing} missing photos`} first.`));
  if (!app.documents?.find((d) => d.kind === 'passport')?.uploaded) {
    return showError(new Error("Add a picture of your passport's photo page first."));
  }
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
        row('Passport', `${a.passportNumber} · ${a.passportCountry} · valid until ${longDate(a.passportExpiry)}`),
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
  const pay = app.payment;
  const price = PACKAGES[app.package]?.price;
  $('#payment-text').textContent = pay?.status === 'paid'
    ? `Payment received: ${pay.amountEtb.toLocaleString('en-US')} ETB. Thank you.`
    : pay?.status === 'refunded'
      ? `Your payment of ${pay.amountEtb.toLocaleString('en-US')} ETB was refunded.`
      : `Price: ${price} ETB. Our team will contact you to arrange payment by Telebirr or CBE Birr before your entry is filed.`;
  $('#payment-note').hidden = stage === 'submitted' && pay?.status !== 'paid';
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

// ---------- referral partners ----------

async function setupReferral() {
  if (!referral.ref && !referral.invite) return;
  // "Filling in together" only applies on a partner's own phone, signed in. Anyone else just uses the link.
  if (referral.together && !(await fetch('/api/partner').then((r) => r.ok, () => false))) referral.together = false;
  const res = await fetch(`/api/apply/referrer?${new URLSearchParams(Object.entries(referral).filter(([k, v]) => v && k !== 'together'))}`);
  const found = res.ok ? await res.json() : {};
  if (!found.organisation) return;
  if (found.package && !params.get('package')) chosenPackage = found.package;
  if (found.firstName) $('#applicant-person [data-f="firstName"]').value = found.firstName;
  $('#referral-text').textContent = referral.together
    ? `Filling in together with ${found.organisation}. When you are done, tap “Finish & hand back”.`
    : `${found.firstName ? `Welcome, ${found.firstName}. ` : ''}You were referred by ${found.organisation}.`;
  $('#finish-together').hidden = !referral.together;
  $('#referral-banner').hidden = false;
}

// Ends the applicant's session on the partner's phone, so the next person cannot open this entry.
$('#finish-together').addEventListener('click', async () => {
  if (app && !confirm('Has the applicant written down their code? They need it to follow their entry.')) return;
  await api('POST', '/api/apply/leave').catch(() => {});
  tabFlag.set(false);
  location.href = '/partner/';
});

// ---------- start ----------

function route() {
  if (!app) return location.hash === '#resume' ? show('resume') : show('package');
  if (!app.editable) return renderStatus();
  if (pendingCode.get()) {
    $('#resume-code').textContent = pendingCode.get();
    return show('code', 'details');
  }
  fillDetails(app.applicant);
  if (app.photos.some((p) => !p.uploaded) || !app.documents?.find((d) => d.kind === 'passport')?.uploaded) {
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
await setupReferral().catch(() => {});
renderPackages();
if (referral.together && !tabFlag.get()) {
  // A partner's phone may still hold the previous applicant's session: always start clean.
  await api('POST', '/api/apply/leave').catch(() => {});
}
try {
  app = await api('GET', '/api/apply');
} catch (err) {
  if (err.status !== 401) showError(err);
}
route();
