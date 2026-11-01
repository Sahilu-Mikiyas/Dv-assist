// Free photo check: runs the editor and analyzer on the device and offers the prepared photo as a download.

import { $ } from '/dom.js';
import { openPhotoEditor, renderChecks } from '/photo/editor.js';

let objectUrl = null;

const VERDICT = {
  pass: 'Looks good. This photo meets the rules we can check.',
  warn: 'Almost there. Look at the points marked !',
  fail: 'This photo will likely be rejected. Fix the points marked ✕, or take a new one.',
};

$('#file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const error = $('#error');
  error.hidden = true;
  try {
    const edited = await openPhotoEditor(file, { title: 'Line up your photo' });
    if (!edited) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(edited.blob);
    $('#result-img').src = objectUrl;
    $('#download').href = objectUrl;
    $('#result-verdict').className = `pe-verdict pe-${edited.result.verdict}`;
    $('#result-verdict').textContent = VERDICT[edited.result.verdict];
    renderChecks($('#result-checks'), edited.result);
    $('#start').hidden = true;
    $('#result').hidden = false;
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});
