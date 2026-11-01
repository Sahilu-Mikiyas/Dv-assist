// Photo editor dialog: auto-positions a photo for the DV rules, lets the person drag and zoom it with guide
// lines, shows the analyzer's checks live, and returns a 600 × 600 JPEG of at most 240 KB.
// Everything happens on the device; the caller decides whether to upload the result.

import { el } from '/dom.js';
import { HEAD_MAX, HEAD_MIN, OUTPUT_SIZE, analyzePhoto, clampCrop, suggestCrop } from '/photo/check.js';

const MAX_BYTES = 240 * 1024;
const ANALYSIS_SIDE = 800; // auto-positioning runs on a copy at most this big, for speed

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image. Use a JPEG or PNG photo.')); };
    img.src = url;
  });
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

export async function toDvJpeg(canvas) {
  for (let quality = 0.92; quality >= 0.4; quality -= 0.08) {
    const blob = await toBlob(canvas, quality);
    if (blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('Could not compress this photo under 240 KB. Try a simpler photo.');
}

function pixelsOf(img, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale),
  });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { pixels: ctx.getImageData(0, 0, canvas.width, canvas.height), scale };
}

function autoCrop(img) {
  const { pixels, scale } = pixelsOf(img, ANALYSIS_SIDE);
  const c = suggestCrop(pixels);
  return clampCrop({ x: c.x / scale, y: c.y / scale, side: c.side / scale }, img.naturalWidth, img.naturalHeight);
}

const LEVEL_ICON = { pass: '✓', warn: '!', fail: '✕' };

export function renderChecks(list, result) {
  list.replaceChildren(...result.checks.map((c) => el('li', { className: `pe-${c.level}` },
    el('span', { className: 'pe-icon', textContent: LEVEL_ICON[c.level], ariaHidden: 'true' }),
    el('span', {}, c.en, el('br'), el('small', { lang: 'am', textContent: c.am })))));
}

// Opens the editor for `file`. Resolves with { blob, result } when the person uses the photo, or null if
// they cancel.
export async function openPhotoEditor(file, { title = 'Position your photo' } = {}) {
  let img = await loadImage(file);
  if (Math.min(img.naturalWidth, img.naturalHeight) < 300) {
    throw new Error(`Photo is too small (${img.naturalWidth}×${img.naturalHeight}). Use a photo at least 600 pixels on each side.`);
  }

  const canvas = el('canvas', { width: OUTPUT_SIZE, height: OUTPUT_SIZE, className: 'pe-photo' });
  const overlay = el('canvas', { width: OUTPUT_SIZE, height: OUTPUT_SIZE, className: 'pe-overlay' });
  const stage = el('div', { className: 'pe-stage', tabIndex: 0, ariaLabel: 'Photo. Drag to move; use the zoom slider or + and − keys.' }, canvas, overlay);
  const zoom = el('input', { type: 'range', min: 0, max: 1000, value: 0, className: 'pe-zoom', ariaLabel: 'Zoom' });
  const checks = el('ul', { className: 'pe-checks', ariaLive: 'polite' });
  const verdict = el('p', { className: 'pe-verdict' });
  const confirms = [
    'My chin is inside the green band',
    'No glasses, eyes open, neutral face, nothing covering the face',
    'Taken in the last 6 months',
  ].map((text) => el('label', { className: 'pe-confirm' }, el('input', { type: 'checkbox' }), ` ${text}`));
  const useButton = el('button', { type: 'button', className: 'pe-btn pe-primary', textContent: 'Use this photo', disabled: true });
  const cancelButton = el('button', { type: 'button', className: 'pe-btn', textContent: 'Cancel' });
  const swapInput = el('input', { type: 'file', accept: 'image/*', className: 'pe-hidden', id: `pe-swap-${Date.now()}` });
  const error = el('p', { className: 'pe-error', role: 'alert', hidden: true });

  const dialog = el('dialog', { className: 'pe-dialog' },
    el('div', { className: 'pe-head' }, el('h2', { textContent: title }),
      el('p', { textContent: 'Drag the photo and zoom until the top of the head touches the line and the chin sits in the green band.' })),
    el('div', { className: 'pe-body' },
      el('div', { className: 'pe-left' }, stage,
        el('div', { className: 'pe-zoom-row' },
          el('button', { type: 'button', className: 'pe-step', textContent: '−', ariaLabel: 'Zoom out', onclick: () => nudgeZoom(-60) }),
          zoom,
          el('button', { type: 'button', className: 'pe-step', textContent: '+', ariaLabel: 'Zoom in', onclick: () => nudgeZoom(60) })),
        el('div', { className: 'pe-tools' },
          el('button', { type: 'button', className: 'pe-link', textContent: 'Auto-position', onclick: () => { crop = autoCrop(img); syncZoom(); draw(); } }),
          swapInput,
          el('label', { htmlFor: swapInput.id, className: 'pe-link', textContent: 'Choose a different photo' }))),
      el('div', { className: 'pe-right' }, verdict, checks,
        el('div', { className: 'pe-confirms' }, el('p', { className: 'pe-label', textContent: 'Please confirm' }), ...confirms),
        error)),
    el('div', { className: 'pe-foot' }, cancelButton, useButton));
  document.body.append(dialog);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const octx = overlay.getContext('2d');
  let crop = autoCrop(img);
  let result = null;
  let timer = null;

  const maxSide = () => Math.min(img.naturalWidth, img.naturalHeight);
  const minSide = () => Math.min(maxSide(), Math.max(200, maxSide() * 0.12));
  // Zoom is logarithmic, so each step feels the same at any size.
  const sideFor = (v) => maxSide() * (minSide() / maxSide()) ** (v / 1000);
  function syncZoom() {
    const ratio = Math.log(crop.side / maxSide()) / Math.log(minSide() / maxSide());
    zoom.value = String(Math.round((Number.isFinite(ratio) ? ratio : 0) * 1000));
  }
  function setSide(side) {
    const cx = crop.x + crop.side / 2;
    const cy = crop.y + crop.side / 2;
    crop = clampCrop({ x: cx - side / 2, y: cy - side / 2, side }, img.naturalWidth, img.naturalHeight);
    draw();
  }
  function nudgeZoom(delta) {
    zoom.value = String(Math.min(1000, Math.max(0, Number(zoom.value) + delta)));
    setSide(sideFor(Number(zoom.value)));
  }
  zoom.addEventListener('input', () => setSide(sideFor(Number(zoom.value))));

  function drawGuides() {
    const s = OUTPUT_SIZE;
    octx.clearRect(0, 0, s, s);
    const top = result?.head && !result.head.cutOff ? result.head.top : s * 0.1;
    octx.fillStyle = 'rgba(31, 107, 58, 0.22)';
    octx.fillRect(0, top + HEAD_MIN * s, s, (HEAD_MAX - HEAD_MIN) * s);
    octx.lineWidth = 3;
    octx.setLineDash([12, 8]);
    octx.strokeStyle = '#1F6B3A';
    for (const y of [top + HEAD_MIN * s, top + HEAD_MAX * s]) {
      octx.beginPath(); octx.moveTo(0, y); octx.lineTo(s, y); octx.stroke();
    }
    octx.strokeStyle = '#B22234';
    octx.setLineDash([]);
    octx.beginPath(); octx.moveTo(0, top); octx.lineTo(s, top); octx.stroke();
    octx.strokeStyle = 'rgba(10, 49, 97, 0.5)';
    octx.lineWidth = 2;
    octx.setLineDash([4, 10]);
    octx.beginPath(); octx.moveTo(s / 2, 0); octx.lineTo(s / 2, s); octx.stroke();
    octx.setLineDash([]);
    octx.font = '600 22px Inter, sans-serif';
    const label = (text, y, color) => {
      const w = octx.measureText(text).width + 20;
      octx.fillStyle = color;
      octx.fillRect(s - w - 10, y - 15, w, 30);
      octx.fillStyle = '#fff';
      octx.fillText(text, s - w, y + 8);
    };
    label('Top of head', Math.max(18, top), '#B22234');
    label('Chin here', Math.min(s - 18, top + ((HEAD_MIN + HEAD_MAX) / 2) * s), '#1F6B3A');
  }

  function analyze() {
    result = analyzePhoto(ctx.getImageData(0, 0, OUTPUT_SIZE, OUTPUT_SIZE), { sourceScale: OUTPUT_SIZE / crop.side });
    renderChecks(checks, result);
    verdict.className = `pe-verdict pe-${result.verdict}`;
    verdict.textContent = {
      pass: 'Looks good. Our team still checks every photo.',
      warn: 'Almost there. Check the points marked !',
      fail: 'This photo will likely be rejected. Fix the points marked ✕ or take a new one.',
    }[result.verdict];
    useButton.textContent = result.verdict === 'fail' ? 'Use this photo anyway' : 'Use this photo';
    drawGuides();
  }

  function draw() {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, crop.x, crop.y, crop.side, crop.side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    drawGuides();
    clearTimeout(timer);
    timer = setTimeout(analyze, 120);
  }

  // Dragging moves the photo under the frame.
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, crop: { ...crop } };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const perPixel = crop.side / stage.getBoundingClientRect().width;
    crop = clampCrop({ ...drag.crop, x: drag.crop.x - (e.clientX - drag.x) * perPixel, y: drag.crop.y - (e.clientY - drag.y) * perPixel },
      img.naturalWidth, img.naturalHeight);
    draw();
  });
  const endDrag = () => { drag = null; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('keydown', (e) => {
    const step = crop.side * 0.02;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      crop = clampCrop({ ...crop, x: crop.x + moves[e.key][0], y: crop.y + moves[e.key][1] }, img.naturalWidth, img.naturalHeight);
      draw();
    } else if (e.key === '+' || e.key === '=') nudgeZoom(40);
    else if (e.key === '-') nudgeZoom(-40);
  });

  const updateUse = () => { useButton.disabled = !confirms.every((c) => c.querySelector('input').checked); };
  for (const c of confirms) c.querySelector('input').addEventListener('change', updateUse);

  swapInput.addEventListener('change', async () => {
    if (!swapInput.files[0]) return;
    try {
      img = await loadImage(swapInput.files[0]);
      crop = autoCrop(img);
      syncZoom();
      draw();
      error.hidden = true;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });

  syncZoom();
  draw();
  dialog.showModal();
  analyze();

  return new Promise((resolve) => {
    const finish = (value) => {
      clearTimeout(timer);
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancelButton.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    useButton.addEventListener('click', async () => {
      useButton.disabled = true;
      try {
        analyze();
        finish({ blob: await toDvJpeg(canvas), result });
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        useButton.disabled = false;
      }
    });
  });
}
