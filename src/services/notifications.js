// Messages to applicants and partners, through an outbox: a business action only queues a message; a
// background worker delivers it by SMS (Ethiopian mobile numbers) or email, and retries with backoff.
// With no provider for a message, it waits on the staff Messages page to be sent by hand.

import { TEMPLATE_LABELS, render } from '../domain/messages.js';
import { normalizePhone } from '../domain/partner.js';
import { log } from '../infra/log.js';

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export function notificationService({ repo, audit, sms = null, email = null, publicUrl, now = () => Date.now() }) {
  let running = null;

  function channelFor(m) {
    if (m.to?.phone && sms) return 'sms';
    if (!m.smsOnly && m.to?.email && email) return 'email';
    return null;
  }

  async function deliver(m) {
    const channel = channelFor(m);
    if (!channel) {
      // An invitation the partner already sends themselves needs no manual copy.
      if (m.smsOnly) await repo.finish(m.id, { status: 'skipped' });
      else await repo.retryLater(m.id, { attempts: m.attempts, error: null, nextAttemptAt: new Date(now()).toISOString(), status: 'manual' });
      return;
    }
    try {
      if (channel === 'sms') await sms.send({ to: m.to.phone, text: m.text });
      else await email.send({ to: m.to.email, subject: m.subject, text: m.text });
      await repo.finish(m.id, { status: 'sent', channel });
      await audit.record({ action: `message_sent:${m.template}`, caseId: m.caseId, detail: channel });
    } catch (err) {
      const attempts = m.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await repo.retryLater(m.id, {
        attempts,
        error: String(err.message).slice(0, 300),
        nextAttemptAt: new Date(now() + (BACKOFF_MS[attempts - 1] ?? 0)).toISOString(),
        status: failed ? 'failed' : 'pending',
        channel,
      });
      log.warn('message_failed', { id: m.id, template: m.template, channel, attempts, error: err.message });
    }
  }

  const service = {
    smsEnabled: Boolean(sms),

    // Queues a message. Never throws: a message problem must not undo the action that caused it.
    async notify(template, { caseId = null, partnerId = null, phone = null, email: address = null, data = {}, smsOnly = false }) {
      try {
        const to = { phone: normalizePhone(phone), email: address || null };
        if (!to.phone && (smsOnly || !to.email)) return;
        const { subject, text } = render(template, { ...data, url: publicUrl });
        await repo.insert({ template, caseId, partnerId, to, subject, text, smsOnly, at: new Date(now()) });
        service.wake();
      } catch (err) {
        log.error('message_queue_failed', { template, message: err.message });
      }
    },

    // Delivers everything due. One run at a time; later calls wait for the current run.
    deliverDue() {
      running ??= (async () => {
        try {
          for (const m of await repo.due(new Date(now()).toISOString())) await deliver(m);
        } finally {
          running = null;
        }
      })();
      return running;
    },

    wake() {
      service.deliverDue().catch((err) => log.error('message_worker_failed', { message: err.message }));
    },

    // ---- staff ----

    async overview() {
      return { sms: sms?.name ?? null, email: email?.name ?? null, counts: await repo.counts() };
    },

    // Messages a person has to send: no provider for them, or delivery kept failing.
    async toSend() {
      return (await repo.list({ statuses: ['manual', 'failed'] })).map((m) => ({
        id: m.id, template: m.template, label: TEMPLATE_LABELS[m.template] ?? m.template, caseId: m.caseId,
        to: m.to, subject: m.subject, text: m.text, status: m.status, lastError: m.lastError, createdAt: m.createdAt,
      }));
    },

    async recent() {
      return (await repo.list({ statuses: ['sent', 'done', 'skipped'], limit: 50 })).map((m) => ({
        id: m.id, label: TEMPLATE_LABELS[m.template] ?? m.template, caseId: m.caseId, status: m.status,
        channel: m.channel, doneBy: m.doneBy, at: m.doneAt,
      }));
    },

    async markSent(id, ctx) {
      const m = await repo.get(id);
      if (!m || !['manual', 'failed'].includes(m.status)) return;
      await repo.finish(id, { status: 'done', channel: 'by hand', doneBy: ctx.staff.name });
      await audit.record({ action: `message_sent_by_hand:${m.template}`, caseId: m.caseId, staffId: ctx.staff.id, ip: ctx.ip });
    },
  };
  return service;
}
