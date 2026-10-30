// TEMPORARY: learns Bitnob's request formats by sending read-only requests and deliberately
// empty POSTs, which Bitnob rejects with the list of required fields (nothing is created).
// Logs status codes and response text only. Enabled with BITNOB_PROBE=true.

import { bitnobClient } from './bitnob.js';
import { log } from './log.js';

const CALLS = [
  ['GET', '/api/balances'],
  ['POST', '/api/customers'],
  ['POST', '/api/cards'],
  ['POST', '/api/cards/kyc'],
  ['POST', '/api/cards/fund'],
];

export async function probeBitnob(bitnobConfig) {
  const client = bitnobClient(bitnobConfig);
  for (const [method, path] of CALLS) {
    try {
      const data = await client.request(method, path, method === 'POST' ? {} : undefined);
      log.info('bitnob_probe', { method, path, ok: true, body: JSON.stringify(data).slice(0, 1500) });
    } catch (err) {
      log.info('bitnob_probe', { method, path, ok: false, status: err.status, message: err.message, details: err.details });
    }
  }
  log.info('bitnob_probe_done');
}
