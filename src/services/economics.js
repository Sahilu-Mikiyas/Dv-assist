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

    // Every saved version with the date it took effect, oldest first; before the first save, the defaults.
    async history() {
      const saved = await settingsRepo.get('economics_history');
      const versions = saved?.value ?? [];
      if (!versions.length) {
        const single = await settingsRepo.get('economics');
        if (single) versions.push({ from: single.updatedAt, values: { ...DEFAULT_ECONOMICS, ...single.value } });
      }
      return [{ from: null, values: { ...DEFAULT_ECONOMICS } }, ...versions];
    },

    async save(input, ctx) {
      if (ctx?.staff?.role !== 'admin') throw new ForbiddenError('Admins only');
      const values = validateEconomics(input);
      // New figures apply from now on: applicants already counted keep the costs they were counted with.
      const versions = (await this.history()).slice(1);
      versions.push({ from: new Date().toISOString(), values });
      await settingsRepo.set('economics_history', versions, ctx.staff.name);
      await settingsRepo.set('economics', values, ctx.staff.name);
      await audit.record({ action: 'economics_updated', ip: ctx.ip, staffId: ctx.staff.id, detail: JSON.stringify(values) });
      return current();
    },
  };
}
