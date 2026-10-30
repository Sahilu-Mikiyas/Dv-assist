// TEMPORARY: finds which Bitnob host and auth style accept our key by trying
// read-only requests and logging only status codes and short response text.
// Enabled with BITNOB_PROBE=true; remove once the integration is settled.

import { log } from './log.js';

const HOST = 'https://api.platform.bitnob.com';
const PATHS = ['/v1/me', '/v1/whoami', '/v1/account', '/v1/balances', '/v1/wallets', '/v1/cards', '/v1/customers', '/api/v1/cards'];

export async function probeBitnob(secretKey) {
  // Try the key as given, and without a leading "label:" in case one was copied along with it.
  const keys = { full: secretKey, stripped: secretKey.replace(/^[a-z]+:/, '') };
  for (const [variant, key] of Object.entries(keys)) {
    for (const path of PATHS) {
      try {
        const res = await fetch(`${HOST}${path}`, {
          headers: { 'X-API-Key': key, Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        const text = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
        log.info('bitnob_probe', { path, variant, status: res.status, body: text });
      } catch (err) {
        log.info('bitnob_probe', { path, variant, error: err.cause?.code ?? err.message });
      }
    }
  }
  log.info('bitnob_probe_done');
}
