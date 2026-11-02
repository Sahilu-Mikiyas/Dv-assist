// Counter poster with the partner's QR code and referral link.

import { $ } from '/dom.js';
import { api } from '/partner/app.js';
import { downloadQr, qrSvgElement } from '/partner/qr.js';

try {
  const me = await api('GET', '/api/partner');
  const link = `${location.origin}/r/${me.refCode}`;
  $('#qr').append(qrSvgElement(link, `QR code for ${link}`));
  $('#link').textContent = link.replace(/^https?:\/\//, '');
  $('#org').textContent = me.organisation;
  document.title = `${me.organisation} — Ethio DV Assist poster`;
  $('#poster').hidden = false;
  $('#print').addEventListener('click', () => window.print());
  $('#download').addEventListener('click', () => downloadQr(link, `ethio-dv-assist-${me.refCode}.svg`));
} catch (err) {
  $('#error').textContent = err.message;
  $('#error').hidden = false;
}
