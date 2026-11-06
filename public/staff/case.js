import { api, $, el, label, loadShell, personName, run, showError, sourceLabel, STAGE_LABELS, timeAgo } from '/staff/app.js';
import { analyzePhoto } from '/photo/check.js';
import { openPhotoEditor } from '/photo/editor.js';
import { prepareScan } from '/photo/scan.js';

const SPOUSE_REQUIRED = 'married_spouse_not_us_citizen_or_lpr';
const PERSON_FIELDS = ['lastName', 'firstName', 'middleName', 'gender', 'birthDate', 'birthCity', 'birthCountry'];
const ENTRY_FIELDS = ['eligibilityCountry', 'mailingAddress', 'residenceCountry', 'phone', 'email', 'education', 'maritalStatus',
  'passportNumber', 'passportCountry', 'passportExpiry'];
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
      ['Passport number', upper(a.passportNumber)],
      ['Passport issuing country', upper(a.passportCountry)],
      ['Passport expiry', a.passportExpiry || '—'],
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

const DOCUMENT_NAMES = { passport: 'Passport photo page', passport_signature: 'Signature page (if separate)' };

function renderDocuments(c) {
  const draft = c.status === 'draft';
  $('#documents-card').hidden = Boolean(c.erasedAt);
  $('#documents-help').hidden = !draft;
  $('#documents').replaceChildren(...(c.documents ?? []).map(({ kind, uploaded }) => {
    const src = `/api/cases/${c.id}/documents/${kind}`;
    const cell = el('div', { className: 'photo' },
      uploaded ? el('a', { href: src, target: '_blank', rel: 'noopener' }, el('img', { src: `${src}?t=${Date.now()}`, alt: DOCUMENT_NAMES[kind], className: 'scan' }))
        : el('div', { className: 'empty', textContent: kind === 'passport' ? 'Required' : 'Optional' }),
      el('b', { textContent: DOCUMENT_NAMES[kind] }));
    if (draft) {
      const input = el('input', { type: 'file', accept: 'image/*' });
      input.setAttribute('aria-label', `Choose ${DOCUMENT_NAMES[kind]}`);
      input.addEventListener('change', () => run(input, async () => {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        await api('PUT', src, await prepareScan(file), 'image/jpeg');
        await reload();
      }));
      cell.append(input);
    } else if (uploaded) {
      cell.append(el('a', { className: 'btn small', href: `${src}?download=1`, textContent: 'Download' }));
    }
    return cell;
  }));
}

function renderPhotos(c) {
  renderDocuments(c);
  const draft = c.status === 'draft';
  $('#photos-help').hidden = !draft;
  $('#photos').replaceChildren(...c.photos.map(({ key, uploaded }) => {
    const src = `/api/cases/${c.id}/photos/${key}`;
    const name = personLabel(key, c.applicant);
    const picture = uploaded
      ? el('img', { src: `${src}?t=${Date.now()}`, alt: `Photo of ${name}` })
      : el('div', { className: 'empty', textContent: 'No photo yet' });
    const cell = el('div', { className: 'photo' }, picture, el('b', { textContent: name }));
    if (uploaded) showPhotoFlags(picture, cell);
    if (draft) {
      const input = el('input', { type: 'file', accept: 'image/*' });
      input.setAttribute('aria-label', `Choose photo for ${name}`);
      input.addEventListener('change', () => run(input, async () => {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        const edited = await openPhotoEditor(file, { title: `Photo of ${name}` });
        if (!edited) return;
        await api('PUT', src, edited.blob, 'image/jpeg');
        await reload();
      }));
      cell.append(input);
    } else if (uploaded) {
      cell.append(el('a', { className: 'btn small', href: `${src}?download=1`, textContent: 'Download' }));
    }
    return cell;
  }));
}

// Runs the photo analyzer on a saved photo so checkers see its flags next to it.
function showPhotoFlags(img, cell) {
  img.addEventListener('load', () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { checks, verdict } = analyzePhoto(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const flagged = checks.filter((c) => c.level !== 'pass');
    cell.append(el('div', { className: `photo-flags ${verdict}` },
      verdict === 'pass' ? 'Analyzer: no problems found' : `Analyzer: ${flagged.length} to look at`,
      ...flagged.map((c) => el('small', { textContent: `${c.level === 'fail' ? '✕' : '!'} ${c.en}` }))));
  }, { once: true });
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
      el('p', { className: 'muted', textContent: c.source === 'website'
        ? 'The applicant can approve online with their code. Or read it back to them and record their approval here.'
        : 'Read the entry back to the applicant. Record approval only when they confirm everything.' }),
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
  $('#meta').textContent = `${c.code} · ${c.photos.length} ${c.photos.length === 1 ? 'person' : 'people'} · ${sourceLabel(c)} · ${STAGE_LABELS[c.status]}`;
  renderStages(c);
  renderAssign(c);

  form.hidden = !draft;
  if (draft) writeForm(c.applicant);
  $('#copy-card').hidden = draft;
  if (!draft) renderCopy(c.applicant);

  $('#photos-card').hidden = false;
  renderPhotos(c);
  $('#side').hidden = false;
  if (c.erasedAt) {
    // Nothing left to work on: show only the number, stage and history.
    form.hidden = true;
    $('#copy-card').hidden = true;
    $('#photos-card').hidden = true;
    $('#action').replaceChildren(
      el('p', { className: 'eyebrow on-navy', textContent: 'Erased' }),
      el('h2', { textContent: 'Personal data erased' }),
      el('p', { className: 'muted', textContent: `Erased ${timeAgo(c.erasedAt)}. The case number and history are kept; the activity list shows why.` }));
  } else {
    renderAction(c);
  }
  $('#erase-box').hidden = me?.role !== 'admin' || Boolean(c.erasedAt) || c.status === 'card_issued';
  renderPayment(c);
  loadActivity().catch(showError);
}

const METHODS = { telebirr: 'Telebirr', cbe_birr: 'CBE Birr', bank: 'Bank transfer', cash: 'Cash' };
const birr = (n) => `${Number(n).toLocaleString('en-US')} ETB`;

// What the applicant paid us, recorded by staff until online payments are connected.
function renderPayment(c) {
  $('#payment-box').hidden = Boolean(c.erasedAt) && !c.payment;
  $('#payment-expected').textContent = c.expectedEtb ? `Package price: ${birr(c.expectedEtb)}.` : 'Entered by staff: no package price.';
  const paid = c.payment;
  $('#payment-form').hidden = Boolean(paid) || Boolean(c.erasedAt);
  $('#payment-recorded').hidden = !paid;
  if (paid) {
    const remove = me?.role === 'admin' && !paid.refundedAt
      ? el('button', { type: 'button', className: 'btn small danger', textContent: 'Remove (wrong entry)' })
      : null;
    remove?.addEventListener('click', () => {
      if (!confirm('Remove this payment record? Record the right one afterwards.')) return;
      run(remove, async () => render(await api('DELETE', `/api/cases/${caseId}/payment`)));
    });
    const refund = me?.role === 'admin' && !paid.refundedAt
      ? el('button', { type: 'button', className: 'btn small', textContent: 'Record refund' })
      : null;
    refund?.addEventListener('click', () => {
      const reason = prompt(`Refund ${birr(paid.amountEtb)} to the applicant? Say why (kept in the activity log).`);
      if (!reason) return;
      run(refund, async () => render(await api('POST', `/api/cases/${caseId}/payment/refund`, { reason })));
    });
    $('#payment-recorded').replaceChildren(...[
      paid.refundedAt
        ? el('p', { className: 'flat' }, el('span', { className: 'chip warn', textContent: 'Refunded' }), ` ${birr(paid.amountEtb)} · ${METHODS[paid.method]}`)
        : el('p', { className: 'flat' }, el('span', { className: 'chip submitted', textContent: 'Paid' }), ` ${birr(paid.amountEtb)} · ${METHODS[paid.method]}`),
      paid.refundedAt ? el('p', { className: 'muted small flat', textContent: `Refunded ${timeAgo(paid.refundedAt)} by ${paid.refundedBy}: ${paid.refundReason}` }) : null,
      refund,
      el('p', { className: 'muted small flat', textContent: `${paid.reference ? `Ref ${paid.reference} · ` : ''}${timeAgo(paid.receivedAt)} · ${paid.recordedBy}` }),
      paid.amountEtb !== c.expectedEtb && c.expectedEtb ? el('p', { className: 'muted small flat', textContent: `Differs from the package price (${birr(c.expectedEtb)}).` }) : null,
      remove,
    ].filter(Boolean));
  } else {
    $('#payment-form').elements.namedItem('amountEtb').value = c.expectedEtb ?? '';
  }
}

$('#payment-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const f = event.target.elements;
  run(event.target.querySelector('button'), async () => render(await api('POST', `/api/cases/${caseId}/payment`, {
    amountEtb: Number(f.namedItem('amountEtb').value), method: f.namedItem('method').value, reference: f.namedItem('reference').value,
  })));
});

$('#erase').addEventListener('click', () => {
  const typed = prompt('This erases the applicant\'s details, photos and confirmation number for good. Type ERASE to confirm.');
  if (typed !== 'ERASE') return;
  run($('#erase'), async () => {
    await api('POST', `/api/cases/${caseId}/erase`);
    render(await api('GET', `/api/cases/${caseId}`));
  });
});

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
    if (!caseId) history.replaceState(null, '', `/staff/case.html?id=${saved.id}`);
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
