// TEMPORARY: learns Bitnob's card flow in the sandbox. Enabled with BITNOB_PROBE=true;
// remove once the integration is settled.

import { bitnobClient } from './bitnob.js';
import { log } from './log.js';

// Sandbox only: finds or creates the single card-holder customer, then shows what card-holder
// verification (KYC) and card creation ask for. Logs Bitnob's responses, never our secrets.
export async function probeBitnob(bitnobConfig) {
  const client = bitnobClient(bitnobConfig);
  const step = async (label, method, path, body) => {
    try {
      const data = await client.request(method, path, body);
      log.info('bitnob_probe', { label, ok: true, body: JSON.stringify(data).slice(0, 1500) });
      return data;
    } catch (err) {
      log.info('bitnob_probe', { label, ok: false, status: err.status, details: err.details });
      return null;
    }
  };

  const who = await step('whoami', 'GET', '/api/whoami');
  if (who?.environment !== 'sandbox') {
    log.info('bitnob_probe', { label: 'stopped', reason: 'not a sandbox key' });
    return;
  }

  const email = bitnobConfig.cardCustomerEmail;
  const list = await step('find customer', 'GET', `/api/customers?email=${encodeURIComponent(email)}`);
  let customer = list?.customers?.find((c) => c.email === email);
  if (!customer) {
    customer = await step('create customer', 'POST', '/api/customers', {
      customer_type: 'individual', email, first_name: 'Mikiyas', last_name: 'Sahilu',
    });
  }
  const customerId = customer?.id ?? customer?.customer_id;
  if (!customerId) return log.info('bitnob_probe_done');

  await step('kyc requirements', 'POST', '/api/cards/kyc', { customer_id: customerId, terms_of_service_accepted: true });
  await step('create card', 'POST', '/api/cards', {
    card_type: 'virtual', customer_id: customerId, currency: 'USD', card_brand: 'visa',
    amount: 2_000_000, reference: 'dv-probe-1',
  });
  log.info('bitnob_probe_done');
}
