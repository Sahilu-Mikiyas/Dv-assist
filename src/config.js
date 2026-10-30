// Reads and validates environment configuration once at startup. Fails fast on anything unsafe.

import { parseKey } from './infra/crypto.js';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const flag = (name, fallback) => (process.env[name] ?? String(fallback)) === 'true';

export function loadConfig() {
  // Amount loaded on each card: must cover the official DV fee plus any card-side charges.
  // Bitnob's minimum card load is $2.
  const cardAmountUsd = Number(process.env.CARD_AMOUNT_USD ?? '5');
  if (!Number.isFinite(cardAmountUsd) || cardAmountUsd < 2) {
    throw new Error('CARD_AMOUNT_USD must be at least 2');
  }

  const sessionSecret = required('SESSION_SECRET');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');

  const adminPasswordHash = required('ADMIN_PASSWORD_HASH');
  if (!adminPasswordHash.startsWith('scrypt$')) {
    throw new Error('ADMIN_PASSWORD_HASH must come from `npm run setup-secrets`');
  }

  const secureCookies = flag('SECURE_COOKIES', true);

  return {
    port: Number(process.env.PORT ?? '3000'),
    database: {
      url: process.env.DATABASE_URL ?? 'file:./data/dv-assist.db',
      authToken: process.env.DATABASE_AUTH_TOKEN,
    },
    encryptionKey: parseKey(required('DATA_ENCRYPTION_KEY')),
    adminPasswordHash,
    sessionSecret,
    secureCookies,
    trustProxy: flag('TRUST_PROXY', false),
    cardAmountUsd,
    bitnob: {
      baseUrl: process.env.BITNOB_BASE_URL ?? 'https://api.bitnob.com',
      clientId: required('BITNOB_CLIENT_ID'),
      secretKey: required('BITNOB_SECRET_KEY'),
      cardCustomerId: required('BITNOB_CARD_CUSTOMER_ID'),
    },
  };
}
