// Reminders, sent once each: website applicants whose entry waits for their approval for 3 days, and
// those who started an entry 2 days ago without sending it. Runs with the other periodic jobs.

import { caseCode } from './cases.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function reminderService({ caseRepo, notifications, now = () => Date.now() }) {
  const olderThan = (iso, days) => iso && now() - Date.parse(iso) > days * DAY_MS;

  async function remind(c, kind) {
    if (await caseRepo.remindedAlready(c.id, kind)) return false;
    const full = await caseRepo.get(c.id);
    await notifications.notify(kind, {
      caseId: c.id, phone: full.applicant.phone, email: full.applicant.email, data: { code: caseCode(c.caseNumber) },
    });
    await caseRepo.markReminded(c.id, kind);
    return true;
  }

  return {
    async run() {
      let sent = 0;
      for (const c of await caseRepo.listForAccounting()) {
        if (c.source !== 'website' || c.erasedAt) continue;
        // The case's last change is when it reached its current stage (approval needed / started).
        const updated = c.updatedAt ?? c.createdAt;
        if (c.status === 'verified' && olderThan(updated, 3)) sent += await remind(c, 'approval_reminder');
        if (c.status === 'draft' && !c.sentAt && olderThan(c.createdAt, 2)) sent += await remind(c, 'finish_entry');
      }
      return sent;
    },
  };
}
