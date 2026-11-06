// The cost figures net profit is computed from, and the terms of a revenue-share deal. Pure rules only.

import { ValidationError } from './case.js';

// Defaults: the planning figures of the Ermiyas Abera offer, Model A (Bitnob cards), 200 ETB per US dollar.
// Admins replace them with actual costs as they become known.
export const DEFAULT_ECONOMICS = Object.freeze({
  paymentCostEtb: 900, // per applicant: the official $1 fee and card costs
  collectionFeePct: 1, // of what the applicant paid
  techCenterCommissionEtb: 300, // per applicant a tech centre referred
  marketingEtb: 40, // per applicant who did not come through a revenue-share partner
  supportEtb: 20, // per applicant
  developmentEtb: 41, // per applicant: the platform build spread over the planned season
});

const FIELDS = {
  paymentCostEtb: [0, 100_000],
  collectionFeePct: [0, 50],
  techCenterCommissionEtb: [0, 100_000],
  marketingEtb: [0, 100_000],
  supportEtb: [0, 100_000],
  developmentEtb: [0, 100_000],
};

export function validateEconomics(input) {
  const errors = [];
  const clean = {};
  for (const [key, [min, max]] of Object.entries(FIELDS)) {
    const n = Number(input?.[key]);
    if (!Number.isFinite(n) || n < min || n > max) errors.push(`${key} must be a number from ${min} to ${max}`);
    else clean[key] = Math.round(n * 100) / 100;
  }
  if (errors.length) throw new ValidationError(errors);
  return clean;
}

// A revenue-share deal: percentages of net profit on the partner's own (direct) applicants and on everyone
// else's (through us). An optional ladder sets the direct percentage by how many direct applicants count,
// applied to all of them, e.g. [{ from: 0, pct: 45 }, { from: 1000, pct: 55 }, { from: 5000, pct: 60 }].
export function validateDeal(input) {
  const errors = [];
  const pct = (v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100;
  if (!pct(input?.directPct)) errors.push('Direct share must be a percentage from 0 to 100');
  if (!pct(input?.throughUsPct)) errors.push('Through-us share must be a percentage from 0 to 100');
  let ladder = null;
  if (Array.isArray(input?.ladder) && input.ladder.length) {
    ladder = input.ladder.map((t) => ({ from: Number(t.from), pct: Number(t.pct) }))
      .sort((a, b) => a.from - b.from);
    if (ladder[0].from !== 0) errors.push('The ladder must start from 0 applicants');
    if (ladder.some((t) => !Number.isInteger(t.from) || t.from < 0 || !pct(t.pct))) errors.push('Each ladder step needs a whole number of applicants and a percentage');
    if (new Set(ladder.map((t) => t.from)).size !== ladder.length) errors.push('Each ladder step needs a different number of applicants');
  }
  if (errors.length) throw new ValidationError(errors);
  return { directPct: Number(input.directPct), throughUsPct: Number(input.throughUsPct), ladder };
}

// The direct percentage that applies for a given number of counted direct applicants.
export function directPctFor(deal, directCount) {
  if (!deal.ladder) return deal.directPct;
  return deal.ladder.filter((t) => directCount >= t.from).at(-1).pct;
}
