// TEMPORARY: learns Bitnob's request formats by sending read-only requests and deliberately
// empty POSTs, which Bitnob rejects with the list of required fields (nothing is created).
// Logs status codes and response text only. Enabled with BITNOB_PROBE=true.

import { bitnobClient } from './bitnob.js';
import { log } from './log.js';

// A customer id that cannot exist, so card calls fail validation instead of creating anything.
const NOBODY = '00000000-0000-4000-8000-000000000000';
const CALLS = [
  ['POST', '/api/customers', { customer_type: 'not-a-type', email: 'probe@example.com' }],
  ['POST', '/api/cards', { card_type: 'virtual' }],
  ['POST', '/api/cards', { card_type: 'virtual', customer_id: NOBODY, currency: 'USD', card_brand: 'visa', amount: 500, reference: 'probe-1' }],
  ['POST', '/api/cards/kyc', { customer_id: NOBODY, terms_of_service_accepted: true }],
  ['POST', `/api/cards/${NOBODY}/fund`, {}],
  ['GET', `/api/cards/${NOBODY}`],
];

export async function probeBitnob(bitnobConfig) {
  const client = bitnobClient(bitnobConfig);
  for (const [method, path, body] of CALLS) {
    try {
      const data = await client.request(method, path, body);
      log.info('bitnob_probe', { method, path, sent: body, ok: true, body: JSON.stringify(data).slice(0, 1500) });
    } catch (err) {
      log.info('bitnob_probe', { method, path, sent: body, ok: false, status: err.status, details: err.details });
    }
  }
  log.info('bitnob_probe_done');
}
