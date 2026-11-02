// Messages waiting for a person to send them (no SMS/email service yet, or delivery kept failing),
// plus a log of what went out.

import { api, $, el, loadShell, run, showError, timeAgo } from '/staff/app.js';

function provider(label, name) {
  return el('div', { className: `provider ${name ? 'on' : 'off'}` },
    el('b', { textContent: label }), el('span', { textContent: name ? `Sending automatically (${name})` : 'Not connected: messages wait here' }));
}

function copyButton(text) {
  const b = el('button', { type: 'button', className: 'btn small', textContent: 'Copy text' });
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Select the text and copy it';
    }
  });
  return b;
}

function messageCard(m) {
  const done = el('button', { type: 'button', className: 'btn small primary', textContent: 'Mark as sent' });
  done.addEventListener('click', () => run(done, async () => {
    await api('POST', `/api/messages/${m.id}/sent`);
    await load();
  }));
  const links = [];
  if (m.to.phone) links.push(el('a', { className: 'btn small', href: `sms:${m.to.phone}?body=${encodeURIComponent(m.text)}`, textContent: `SMS ${m.to.phone}` }));
  if (m.to.email) {
    links.push(el('a', {
      className: 'btn small',
      href: `mailto:${m.to.email}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.text)}`,
      textContent: `Email ${m.to.email}`,
    }));
  }
  return el('article', { className: 'card message-card' },
    el('div', { className: 'row between' },
      el('b', { textContent: m.label }),
      el('span', { className: `chip ${m.status === 'failed' ? 'warn' : ''}`, textContent: m.status === 'failed' ? 'Delivery failed' : 'No service' })),
    m.lastError ? el('p', { className: 'muted small flat', textContent: `Last error: ${m.lastError}` }) : null,
    el('pre', { className: 'message-text', textContent: m.text }),
    el('div', { className: 'row' },
      m.caseId ? el('a', { className: 'btn small', href: `/staff/case.html?id=${m.caseId}`, textContent: 'Open case' }) : null,
      ...links, copyButton(m.text), done),
    el('p', { className: 'muted small flat', textContent: `Queued ${timeAgo(m.createdAt)}` }));
}

async function load() {
  const data = await api('GET', '/api/messages');
  $('#providers').replaceChildren(provider('SMS', data.sms), provider('Email', data.email));
  $('#to-send').replaceChildren(...data.toSend.map(messageCard));
  $('#none-to-send').hidden = data.toSend.length > 0;
  $('#recent').replaceChildren(...data.recent.map((m) => el('tr', {},
    el('td', { textContent: m.label }),
    el('td', {}, m.caseId ? el('a', { href: `/staff/case.html?id=${m.caseId}`, textContent: 'Open' }) : '—'),
    el('td', { textContent: m.status === 'skipped' ? 'Sent by the partner' : m.status === 'done' ? `By hand · ${m.doneBy}` : m.channel.toUpperCase() }),
    el('td', { className: 'muted', textContent: timeAgo(m.at) }))));
  $('#no-recent').hidden = data.recent.length > 0;
}

try {
  await loadShell();
  await load();
} catch (err) {
  showError(err);
}
