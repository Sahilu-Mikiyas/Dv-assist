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

export function bitnobClient({ baseUrl, clientId, secretKey, cardCustomerId }, fetchImpl = fetch) {
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

    // Issues a USD virtual card loaded with amountUsd for the single card-holder customer.
    // Bitnob amounts are in millionths of a dollar ($2 = 2_000_000); minimum load is $2.
    // `reference` is unique per case so a retried request cannot create a second card.
    async createCard({ amountUsd, reference }) {
      const data = await request('POST', '/api/cards', {
        card_type: 'virtual',
        customer_id: cardCustomerId,
        currency: 'USD',
        card_brand: 'visa',
        amount: Math.round(amountUsd * 1_000_000),
        reference,
      });
      const cardId = data.id ?? data.card_id ?? data.card?.id;
      if (!cardId) throw new BitnobError(`Card created but no id returned (fields: ${Object.keys(data).join(', ')})`, 502);
      return { cardId };
    },

    // Card details are fetched on demand and never stored locally.
    async getCard(cardId) {
      const data = await request('GET', `/api/cards/${encodeURIComponent(cardId)}`);
      const card = data.card ?? data;
      const expiry = card.expiry ?? card.expiry_date
        ?? (card.expiry_month && card.expiry_year ? `${card.expiry_month}/${card.expiry_year}` : undefined);
      const details = {
        cardNumber: card.card_number ?? card.pan ?? card.number,
        cvv: card.cvv ?? card.cvv2,
        expiry,
        nameOnCard: card.name_on_card ?? card.card_name ?? card.name,
        billingAddress: card.billing_address ?? null,
      };
      // Field names are not documented; report which ones came back (names only, never values).
      if (!details.cardNumber) {
        throw new BitnobError(`Card number not in Bitnob response (fields: ${Object.keys(card).join(', ')})`, 502);
      }
      return details;
    },
  };
}
