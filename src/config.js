// Reads and validates environment configuration once at startup.

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfig() {
  // Amount loaded on each card: must cover the official DV fee plus any card-side charges.
  const cardAmountUsd = Number(process.env.CARD_AMOUNT_USD ?? '5');
  if (!Number.isFinite(cardAmountUsd) || cardAmountUsd <= 0) {
    throw new Error('CARD_AMOUNT_USD must be a positive number');
  }

  return {
    port: Number(process.env.PORT ?? '3000'),
    dbPath: process.env.DB_PATH ?? './data/dv-assist.db',
    adminPassword: required('ADMIN_PASSWORD'),
    sessionSecret: required('SESSION_SECRET'),
    cardAmountUsd,
    secureCookies: process.env.SECURE_COOKIES !== 'false',
    bitnob: {
      baseUrl: process.env.BITNOB_BASE_URL ?? 'https://sandboxapi.bitnob.co/api/v1',
      secretKey: required('BITNOB_SECRET_KEY'),
      cardCustomerEmail: required('BITNOB_CARD_CUSTOMER_EMAIL'),
    },
  };
}
