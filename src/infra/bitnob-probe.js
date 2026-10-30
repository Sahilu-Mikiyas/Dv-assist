// TEMPORARY: checks that signed requests are accepted, using read-only endpoints,
// and logs status codes plus short response text. Enabled with BITNOB_PROBE=true.

import { bitnobClient } from './bitnob.js';
import { log } from './log.js';

const PATHS = ['/api/whoami', '/api/balances', '/api/customers', '/api/cards'];

export async function probeBitnob(bitnobConfig) {
  // Try the secret as given, and without a leading "label:" in case one was copied along with it.
  const variants = { full: bitnobConfig.secretKey, stripped: bitnobConfig.secretKey.replace(/^[a-z]+:/, '') };
  for (const [variant, secretKey] of Object.entries(variants)) {
    const client = bitnobClient({ ...bitnobConfig, secretKey });
    for (const path of PATHS) {
      try {
        const data = await client.request('GET', path);
        log.info('bitnob_probe', { variant, path, ok: true, body: JSON.stringify(data).slice(0, 400) });
      } catch (err) {
        log.info('bitnob_probe', { variant, path, ok: false, status: err.status, message: err.message });
      }
    }
  }
  log.info('bitnob_probe_done');
}
