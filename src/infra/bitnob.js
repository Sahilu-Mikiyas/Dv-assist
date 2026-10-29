// Bitnob virtual card client. Every Bitnob request lives here so a change in their API
// is a one-file change. Paths follow the v1 Virtual Cards API; verify them against
// the docs for your account (https://docs.bitnob.com) before going live.

export class BitnobError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function bitnobClient({ baseUrl, secretKey, cardCustomerEmail }, fetchImpl = fetch) {
  async function request(method, path, body) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.status === false) {
      throw new BitnobError(payload.message ?? `Bitnob request failed (${res.status})`, res.status);
    }
    return payload.data ?? {};
  }

  return {
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
