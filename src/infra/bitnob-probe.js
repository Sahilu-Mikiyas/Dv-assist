// TEMPORARY: finds which Bitnob host and auth style accept our key by trying
// read-only requests and logging only status codes and short response text.
// Enabled with BITNOB_PROBE=true; remove once the integration is settled.

import { log } from './log.js';

const HOSTS = [
  'https://api.bitnob.com',
  'https://sandboxapi.bitnob.com',
  'https://api.platform.bitnob.com',
  'https://sandboxapi.bitnob.co',
];
const PATHS = ['/api/v1/whoami', '/api/whoami', '/api/v1/me', '/api/v1/wallets', '/api/cards', '/api/v1/cards'];

export async function probeBitnob(secretKey) {
  const auths = {
    bearer: { Authorization: `Bearer ${secretKey}` },
    'x-api-key': { 'X-API-Key': secretKey },
  };
  for (const host of HOSTS) {
    for (const path of PATHS) {
      for (const [style, headers] of Object.entries(auths)) {
        try {
          const res = await fetch(`${host}${path}`, {
            headers: { ...headers, Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
          });
          const text = (await res.text()).replace(/\s+/g, ' ').slice(0, 160);
          log.info('bitnob_probe', { host, path, style, status: res.status, body: text });
        } catch (err) {
          log.info('bitnob_probe', { host, path, style, error: err.cause?.code ?? err.message });
          break; // host unreachable: skip its other auth styles
        }
      }
    }
  }
  log.info('bitnob_probe_done');
}
