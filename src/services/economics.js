// Cost settings used for the revenue share, edited by admins. Until saved, the offer's planning figures apply.
// The tech-centre commission here is also what tech centres are paid per submitted entry, once saved;
// before that, PARTNER_COMMISSION_ETB (if set) is used.

import { DEFAULT_ECONOMICS, validateEconomics } from '../domain/economics.js';
import { ForbiddenError } from './staff.js';

export function economicsService({ settingsRepo, audit, envCommissionEtb = null }) {
  async function current() {
    const saved = await settingsRepo.get('economics');
    return {
      values: { ...DEFAULT_ECONOMICS, ...(saved?.value ?? {}) },
      saved: Boolean(saved),
      updatedAt: saved?.updatedAt ?? null,
      updatedBy: saved?.updatedBy ?? null,
    };
  }

  return {
    current,
    values: async () => (await current()).values,

    // What a tech centre earns per submitted entry: null until agreed (saved settings or the env setting).
    async techCenterCommission() {
      const c = await current();
      return c.saved ? c.values.techCenterCommissionEtb : envCommissionEtb;
    },

    async save(input, ctx) {
      if (ctx?.staff?.role !== 'admin') throw new ForbiddenError('Admins only');
      const values = validateEconomics(input);
      await settingsRepo.set('economics', values, ctx.staff.name);
      await audit.record({ action: 'economics_updated', ip: ctx.ip, staffId: ctx.staff.id, detail: JSON.stringify(values) });
      return current();
    },
  };
}
