// DV photo analyzer. Pure functions over RGBA pixels ({ data, width, height }, like ImageData), so it runs the
// same in the browser and in tests. Nothing here leaves the device.
//
// A DV photo has a plain white or off-white background, so the person stands out from it. That is enough to
// find the top of the head, the head's width and its centre, and from those to estimate the head height.
// Things pixels cannot reliably tell (glasses, eyes open, photo age) are left to the person and to staff.

export const OUTPUT_SIZE = 600;
export const HEAD_MIN = 0.5; // head height (top of hair to chin) as a share of the photo height
export const HEAD_MAX = 0.69;
const HEAD_TO_WIDTH = 1.32; // typical head height / head width, hair included

const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
function saturation(d, i) {
  const max = Math.max(d[i], d[i + 1], d[i + 2]);
  return max === 0 ? 0 : (max - Math.min(d[i], d[i + 1], d[i + 2])) / max;
}

// Mean and spread of a rectangle of pixels.
function regionStats(img, x0, y0, x1, y1) {
  const { data, width } = img;
  let n = 0; let sumL = 0; let sumL2 = 0; let sumS = 0; let r = 0; let g = 0; let b = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
      const i = (y * width + x) * 4;
      const l = luma(data, i);
      n++; sumL += l; sumL2 += l * l; sumS += saturation(data, i);
      r += data[i]; g += data[i + 1]; b += data[i + 2];
    }
  }
  if (!n) return null;
  const mean = sumL / n;
  return { n, mean, sd: Math.sqrt(Math.max(0, sumL2 / n - mean * mean)), sat: sumS / n, color: [r / n, g / n, b / n] };
}

// The background is sampled where a DV photo should be empty: a band along the top, and the left and right
// edges down to about shoulder height.
export function backgroundStats(img) {
  const { width: w, height: h } = img;
  const top = regionStats(img, 0, 0, w, h * 0.05);
  const left = regionStats(img, 0, h * 0.05, w * 0.08, h * 0.55);
  const right = regionStats(img, w * 0.92, h * 0.05, w, h * 0.55);
  const parts = [top, left, right];
  const n = parts.reduce((s, p) => s + p.n, 0);
  const avg = (f) => parts.reduce((s, p) => s + f(p) * p.n, 0) / n;
  const mean = avg((p) => p.mean);
  return {
    mean,
    sd: Math.sqrt(avg((p) => p.sd ** 2 + (p.mean - mean) ** 2)),
    sat: avg((p) => p.sat),
    color: [0, 1, 2].map((c) => avg((p) => p.color[c])),
    left: left.mean,
    right: right.mean,
  };
}

const smooth = (values, radius) => values.map((_, i) => {
  let sum = 0; let n = 0;
  for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) { sum += values[j]; n++; }
  return sum / n;
});

// Finds the head against the background. Returns { top, chin, height, width, centerX, cutOff } in pixels, or
// null when no person stands out (busy background, empty photo).
export function findHead(img, background = backgroundStats(img)) {
  const { data, width: w, height: h } = img;
  const [br, bg, bb] = background.color;
  // How different from the wall a pixel must be to count as the person. Capped, so that an uneven
  // (shadowed) wall does not make faces that are close to the wall colour disappear.
  const threshold = Math.min(60, Math.max(35, background.sd * 3));
  const minRun = Math.max(4, Math.round(w * 0.02));

  // Per row, the longest unbroken stretch of "not background" (gaps of a few pixels are bridged) that does not
  // touch the left or right edge. Stray specks do not stretch it, and edge shadows and shoulders, which run
  // off the side of the photo, are not mistaken for the head.
  const GAP = Math.max(3, Math.round(w * 0.01));
  const left = new Array(h).fill(-1);
  const right = new Array(h).fill(-1);
  const count = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    let runStart = -1;
    let lastHit = -GAP - 1;
    for (let x = 0; x <= w; x++) {
      const i = (y * w + x) * 4;
      const hit = x < w && Math.hypot(data[i] - br, data[i + 1] - bg, data[i + 2] - bb) > threshold;
      if (hit) {
        if (x - lastHit > GAP) runStart = x;
        lastHit = x;
      }
      if (runStart >= 0 && (x === w || (!hit && x - lastHit > GAP))) {
        const length = lastHit - runStart + 1;
        const touchesEdge = runStart <= 1 || lastHit >= w - 2;
        if (!touchesEdge && length > count[y]) { count[y] = length; left[y] = runStart; right[y] = lastHit; }
        runStart = -1;
      }
    }
  }

  const top = count.findIndex((c) => c >= minRun);
  if (top < 0 || top > h * 0.7) return null;

  const widths = smooth(count.map((c, y) => (c >= minRun ? right[y] - left[y] + 1 : 0)), 3);
  // Walk down from the top: the head widens, then narrows into the neck, then the shoulders widen again.
  // The head width stops growing once the outline has narrowed into the neck.
  let headWidth = 0;
  let neck = -1;
  let neckWidth = Infinity;
  for (let y = top; y < h; y++) {
    if (neck < 0) {
      if (widths[y] > headWidth) headWidth = widths[y];
      else if (y > top + h * 0.1 && widths[y] < headWidth * 0.85) { neck = y; neckWidth = widths[y]; }
    } else if (count[y] < minRun) {
      break; // only edge-to-edge shoulders below here
    } else if (widths[y] < neckWidth) {
      neck = y;
      neckWidth = widths[y];
    } else if (widths[y] > neckWidth * 1.15) {
      break; // shoulders
    }
  }
  // Too narrow is noise; nearly the full width means shoulders or clutter, not a head.
  if (headWidth < w * 0.08 || headWidth > w * 0.75) return null;

  // The chin sits a little above where the neck is narrowest; head proportions give a second estimate.
  const byShape = top + HEAD_TO_WIDTH * headWidth;
  // A head is at least about as tall as it is wide; a "neck" above that is a gap inside the face.
  const neckIsPlausible = neck > 0 && neck - top >= headWidth * 0.9;
  const chin = Math.min(byShape, neckIsPlausible ? neck : byShape, h);

  let sumCenter = 0; let rows = 0;
  for (let y = top; y < Math.min(chin, h); y++) {
    if (count[y] >= minRun) { sumCenter += (left[y] + right[y]) / 2; rows++; }
  }
  return {
    top,
    chin,
    height: chin - top,
    width: headWidth,
    centerX: rows ? sumCenter / rows : w / 2,
    cutOff: top <= 1,
  };
}

// Variance of the Laplacian: low for blurry or out-of-focus photos.
export function sharpness(img, x0, y0, x1, y1) {
  const { data, width } = img;
  const g = (x, y) => luma(data, (y * width + x) * 4);
  let n = 0; let sum = 0; let sum2 = 0;
  for (let y = Math.max(1, Math.floor(y0)); y < Math.min(img.height - 1, Math.ceil(y1)); y++) {
    for (let x = Math.max(1, Math.floor(x0)); x < Math.min(width - 1, Math.ceil(x1)); x++) {
      const v = g(x - 1, y) + g(x + 1, y) + g(x, y - 1) + g(x, y + 1) - 4 * g(x, y);
      n++; sum += v; sum2 += v * v;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

const check = (id, level, en, am) => ({ id, level, en, am });

// Runs every check on a finished 600 × 600 photo. Each result is pass, warn (probably fine, look again) or
// fail (will likely be rejected). `sourceScale` > 1 means the photo was enlarged to reach 600 × 600.
export function analyzePhoto(img, { sourceScale = 1 } = {}) {
  const checks = [];
  const bgs = backgroundStats(img);
  const head = findHead(img, bgs);
  const { width: w, height: h } = img;

  // Background
  if (bgs.mean >= 200 && bgs.sd <= 18 && bgs.sat <= 0.12) {
    checks.push(check('background', 'pass', 'Plain, light background', 'ግልጽ ነጭ ዳራ'));
  } else if (bgs.sat > 0.2) {
    checks.push(check('background', 'fail', 'Background is coloured. Use a plain white or off-white wall.', 'ዳራው ቀለም አለው፤ ነጭ ግድግዳ ይጠቀሙ።'));
  } else if (bgs.sd > 30) {
    checks.push(check('background', 'fail', 'Background is not plain. Stand in front of a bare white wall.', 'ዳራው ግልጽ አይደለም፤ ባዶ ነጭ ግድግዳ ፊት ይቁሙ።'));
  } else if (bgs.mean < 170) {
    checks.push(check('background', 'fail', 'Background is too dark or grey. Use a white wall and more light.', 'ዳራው ጨለማ ነው፤ ነጭ ግድግዳና ተጨማሪ ብርሃን ይጠቀሙ።'));
  } else {
    checks.push(check('background', 'warn', 'Background is a little grey or uneven. A brighter white wall is safer.', 'ዳራው ትንሽ ግራጫ ነው፤ ደማቅ ነጭ ግድግዳ ይሻላል።'));
  }

  const shadow = bgs.left - bgs.right;
  if (Math.abs(shadow) >= 25) {
    const side = shadow < 0 ? 'left' : 'right';
    const sideAm = shadow < 0 ? 'ግራ' : 'ቀኝ';
    checks.push(check('shadow', Math.abs(shadow) >= 45 ? 'fail' : 'warn',
      `Shadow on the ${side} side of the background. Face a window and stand a step away from the wall.`,
      `በዳራው ${sideAm} በኩል ጥላ አለ፤ መስኮት ፊት ለፊት ይቁሙ።`));
  } else {
    checks.push(check('shadow', 'pass', 'Even light, no shadow behind you', 'ከኋላዎ ጥላ የለም'));
  }

  // Head size and position
  if (!head) {
    checks.push(check('head', 'fail', 'Could not find a head against the background. Use a plain white background.', 'ጭንቅላትዎ አልተገኘም፤ ነጭ ዳራ ይጠቀሙ።'));
  } else {
    const share = head.height / h;
    const pct = Math.round(share * 100);
    if (head.cutOff) {
      checks.push(check('head', 'fail', 'The top of the head is cut off. Zoom out or move the photo down.', 'የጭንቅላቱ አናት ተቆርጧል።'));
    } else if (share < HEAD_MIN - 0.04) {
      checks.push(check('head', 'fail', `Head is too small (about ${pct}%). Zoom in so it fills 50–69% of the height.`, `ጭንቅላቱ ትንሽ ነው (${pct}%)፤ ያቅርቡት።`));
    } else if (share > HEAD_MAX + 0.04) {
      checks.push(check('head', 'fail', `Head is too large (about ${pct}%). Zoom out, or take the photo from further away.`, `ጭንቅላቱ ትልቅ ነው (${pct}%)፤ ያርቁት።`));
    } else if (share < HEAD_MIN || share > HEAD_MAX) {
      checks.push(check('head', 'warn', `Head is about ${pct}%, near the 50–69% limit. Put your chin inside the green band.`, `ጭንቅላቱ ${pct}% ገደማ ነው፤ አገጭዎን በአረንጓዴው መስመር ውስጥ ያድርጉ።`));
    } else {
      checks.push(check('head', 'pass', `Head size about ${pct}% (needs 50–69%)`, `የጭንቅላት መጠን ${pct}% ገደማ`));
    }

    const offCenter = Math.abs(head.centerX - w / 2) / w;
    if (offCenter > 0.1) {
      checks.push(check('center', 'fail', 'Head is not centred. Move the photo so the head is in the middle.', 'ጭንቅላቱ መሃል ላይ አይደለም።'));
    } else if (offCenter > 0.05) {
      checks.push(check('center', 'warn', 'Head is slightly off-centre.', 'ጭንቅላቱ ትንሽ ወደ ጎን ነው።'));
    } else {
      checks.push(check('center', 'pass', 'Head centred', 'ጭንቅላቱ መሃል ላይ ነው'));
    }
  }

  // Face: light, focus and colour, measured in the middle of the head.
  const face = head
    ? [head.centerX - head.width * 0.25, head.top + head.height * 0.3, head.centerX + head.width * 0.25, head.top + head.height * 0.8]
    : [w * 0.35, h * 0.3, w * 0.65, h * 0.6];
  const faceStats = regionStats(img, ...face);
  if (faceStats && faceStats.mean < 70) {
    checks.push(check('light', 'warn', 'Face looks dark. Face a window or add light in front of you.', 'ፊቱ ጨለማ ነው፤ ብርሃን ፊት ለፊት ያድርጉ።'));
  } else if (faceStats && faceStats.mean > 225) {
    checks.push(check('light', 'warn', 'Face looks overexposed. Avoid flash and direct sun.', 'ፊቱ በጣም ደምቋል፤ ፍላሽ አይጠቀሙ።'));
  } else {
    checks.push(check('light', 'pass', 'Good light on the face', 'በፊቱ ላይ በቂ ብርሃን'));
  }

  if (faceStats && faceStats.sat < 0.04) {
    checks.push(check('colour', 'fail', 'Photo looks black and white. It must be in colour.', 'ፎቶው ጥቁርና ነጭ ይመስላል፤ ባለቀለም መሆን አለበት።'));
  }

  const focus = sharpness(img, ...face);
  if (sourceScale > 1.25) {
    checks.push(check('sharp', 'warn', 'Photo was enlarged to fit, so it may look soft. Use a larger original photo.', 'ፎቶው ተለጥጧል፤ ትልቅ ፎቶ ይጠቀሙ።'));
  } else if (focus < 30) {
    checks.push(check('sharp', 'warn', 'Photo looks blurry. Hold the phone still and tap to focus on the face.', 'ፎቶው ደብዝዟል፤ ስልኩን አይነቅንቁ።'));
  } else {
    checks.push(check('sharp', 'pass', 'Sharp and in focus', 'ጥርት ያለ'));
  }

  return { checks, head, background: bgs, verdict: verdictOf(checks) };
}

export function verdictOf(checks) {
  if (checks.some((c) => c.level === 'fail')) return 'fail';
  if (checks.some((c) => c.level === 'warn')) return 'warn';
  return 'pass';
}

// Where to crop a source photo so the head fills about 60% of a square, with a little space above it.
// Falls back to a centred square biased to the top when no head is found.
export function suggestCrop(img) {
  const { width: w, height: h } = img;
  const maxSide = Math.min(w, h);
  const head = findHead(img);
  let side = maxSide;
  let x = (w - side) / 2;
  let y = (h - side) * 0.25;
  if (head && !head.cutOff) {
    side = Math.min(maxSide, head.height / 0.6);
    x = head.centerX - side / 2;
    y = head.top - side * 0.1;
  }
  return clampCrop({ x, y, side }, w, h);
}

export function clampCrop({ x, y, side }, w, h) {
  const s = Math.min(side, w, h);
  return { x: Math.min(Math.max(0, x), w - s), y: Math.min(Math.max(0, y), h - s), side: s };
}
