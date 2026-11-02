// Reads and validates environment configuration once at startup. Fails fast on anything unsafe.

import { parseKey } from './infra/crypto.js';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const flag = (name, fallback) => (process.env[name] ?? String(fallback)) === 'true';

export function loadConfig() {
  // Bitnob card type: "virtual" (minimum load $3) or "lite" ($2–$250, closes itself on a set date).
  const cardType = process.env.BITNOB_CARD_TYPE ?? 'virtual';
  if (!['virtual', 'lite'].includes(cardType)) throw new Error('BITNOB_CARD_TYPE must be virtual or lite');
  const minLoad = cardType === 'lite' ? 2 : 3;

  // Amount loaded on each card: must cover the official DV fee.
  const cardAmountUsd = Number(process.env.CARD_AMOUNT_USD ?? '5');
  if (!Number.isFinite(cardAmountUsd) || cardAmountUsd < minLoad) {
    throw new Error(`CARD_AMOUNT_USD must be at least ${minLoad} for ${cardType} cards`);
  }

  const sessionSecret = required('SESSION_SECRET');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');

  // Only used to create the first admin account when no staff exist yet.
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || null;
  if (adminPasswordHash && !adminPasswordHash.startsWith('scrypt$')) {
    throw new Error('ADMIN_PASSWORD_HASH must come from `npm run setup-secrets`');
  }

  const secureCookies = flag('SECURE_COOKIES', true);

  // What a referral partner earns per submitted entry. Unset until agreed; partners then see "to be confirmed".
  const commission = process.env.PARTNER_COMMISSION_ETB;
  const partnerCommissionEtb = commission ? Number(commission) : null;
  if (partnerCommissionEtb !== null && !(Number.isInteger(partnerCommissionEtb) && partnerCommissionEtb >= 0)) {
    throw new Error('PARTNER_COMMISSION_ETB must be a whole number of birr');
  }

  // Data retention, in days. Unset = that rule is off and nothing is erased by it.
  const days = (name) => {
    const raw = process.env[name];
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a whole number of days`);
    return n;
  };
  const retention = { afterSubmissionDays: days('RETENTION_DAYS_AFTER_SUBMISSION'), unsentDays: days('RETENTION_DAYS_UNSENT') };

  // Messages. Each provider is optional; without one, messages wait on the staff Messages page.
  const afroToken = process.env.AFROMESSAGE_TOKEN || null;
  const brevoKey = process.env.BREVO_API_KEY || null;
  const emailFrom = process.env.EMAIL_FROM || null;
  if (brevoKey && !emailFrom) throw new Error('EMAIL_FROM (a sender verified in Brevo) is required with BREVO_API_KEY');
  // Links in messages. Render sets RENDER_EXTERNAL_URL itself.
  const publicUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT ?? '3000'}`)
    .replace(/\/+$/, '');

  return {
    port: Number(process.env.PORT ?? '3000'),
    database: {
      url: process.env.DATABASE_URL ?? 'file:./data/dv-assist.db',
      authToken: process.env.DATABASE_AUTH_TOKEN,
    },
    encryptionKey: parseKey(required('DATA_ENCRYPTION_KEY')),
    firstAdmin: { email: process.env.ADMIN_EMAIL || null, passwordHash: adminPasswordHash },
    sessionSecret,
    secureCookies,
    trustProxy: flag('TRUST_PROXY', false),
    cardAmountUsd,
    partnerCommissionEtb,
    publicUrl,
    retention,
    messaging: {
      sms: afroToken && {
        token: afroToken,
        identifierId: process.env.AFROMESSAGE_IDENTIFIER_ID || null,
        senderName: process.env.AFROMESSAGE_SENDER || null,
      },
      email: brevoKey && { apiKey: brevoKey, fromEmail: emailFrom, fromName: process.env.EMAIL_FROM_NAME || 'Ethio DV Assist' },
    },
    bitnob: {
      baseUrl: process.env.BITNOB_BASE_URL ?? 'https://api.bitnob.com',
      clientId: required('BITNOB_CLIENT_ID'),
      secretKey: required('BITNOB_SECRET_KEY'),
      cardCustomerId: required('BITNOB_CARD_CUSTOMER_ID'),
      cardType,
      webhookSecret: process.env.BITNOB_WEBHOOK_SECRET || null,
    },
  };
}
