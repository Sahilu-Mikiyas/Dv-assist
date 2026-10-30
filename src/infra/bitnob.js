// Bitnob client. Every Bitnob request lives here so a change in their API is a one-file change.
// Requests are signed as Bitnob's current API requires: HMAC-SHA256 (hex) of
// "clientId:timestamp:nonce:body", keyed with the client secret, sent in X-Auth-* headers.

import { createHmac, randomBytes } from 'node:crypto';

export class BitnobError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details; // Bitnob's error body, e.g. field-level validation errors
  }
}

export function signRequest({ clientId, secretKey, timestamp, nonce, body }) {
  return createHmac('sha256', secretKey).update(`${clientId}:${timestamp}:${nonce}:${body}`).digest('hex');
}

export function bitnobClient({ baseUrl, clientId, secretKey, cardCustomerEmail }, fetchImpl = fetch) {
  async function request(method, path, body) {
    const rawBody = body ? JSON.stringify(body) : '';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(rawBody ? { 'Content-Type': 'application/json' } : {}),
          'X-Auth-Client': clientId,
          'X-Auth-Timestamp': timestamp,
          'X-Auth-Nonce': nonce,
          'X-Auth-Signature': signRequest({ clientId, secretKey, timestamp, nonce, body: rawBody }),
        },
        body: rawBody || undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new BitnobError(`Bitnob unreachable at ${baseUrl} (${err.cause?.code ?? err.message})`, 0);
    }
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.status === false) {
      const message = payload.message ?? payload.detail ?? payload.title ?? `request failed (${res.status})`;
      throw new BitnobError(message, res.status, JSON.stringify(payload).slice(0, 1500));
    }
    return payload.data ?? payload;
  }

  return {
    request,

    // Issues a USD virtual card loaded with amountUsd, held by the business card user
    // (registered once in the Bitnob dashboard). `reference` makes the call idempotent.
    async createCard({ amountUsd, reference }) {
      const data = await request('POST', '/virtualcards/create', {
        customerEmail: cardCustomerEmail,
        cardBrand: 'visa',
        cardType: 'virtual',
        reference,
        amount: Math.round(amountUsd * 100), // cents
      });
      return { cardId: data.id };
    },

    // Card details are fetched on demand and never stored locally.
    async getCard(cardId) {
      const data = await request('GET', `/virtualcards/cards/${encodeURIComponent(cardId)}`);
      return {
        cardNumber: data.cardNumber,
        cvv: data.cvv2 ?? data.cvv,
        expiry: data.expiry ?? data.expiryDate,
        nameOnCard: data.cardName ?? data.nameOnCard,
        billingAddress: data.billingAddress ?? null,
      };
    },
  };
}
