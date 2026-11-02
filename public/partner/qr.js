// QR codes for a partner's referral link, as SVG (sharp at any print size).

import { qrcode } from '/vendor/qrcode.mjs';

const SVG = 'http://www.w3.org/2000/svg';

// One path of dark squares, with a 4-module quiet zone as the QR standard asks.
export function qrSvgMarkup(text, { margin = 4, color = '#0A2350' } = {}) {
  const qr = qrcode(0, 'M'); // version chosen automatically; M recovers ~15% damage (a smudged print)
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  return `<svg xmlns="${SVG}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="${color}"/></svg>`;
}

// The same QR as a DOM element (no innerHTML), labelled for screen readers.
export function qrSvgElement(text, label) {
  const doc = new DOMParser().parseFromString(qrSvgMarkup(text), 'image/svg+xml');
  const svg = document.importNode(doc.documentElement, true);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  return svg;
}

export function downloadQr(text, filename) {
  const url = URL.createObjectURL(new Blob([qrSvgMarkup(text)], { type: 'image/svg+xml' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
