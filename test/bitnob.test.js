import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BitnobError, bitnobClient } from '../src/infra/bitnob.js';

const config = { baseUrl: 'https://bitnob.test/api/v1', secretKey: 'sk_test', cardCustomerEmail: 'ops@example.com' };

function fakeFetch(status, payload) {
  const requests = [];
  const impl = async (url, init) => {
    requests.push({ url, ...init, body: init.body && JSON.parse(init.body) });
    return { ok: status < 400, status, json: async () => payload };
  };
  return { impl, requests };
}

test('creates a card with amount in cents and bearer auth', async () => {
  const { impl, requests } = fakeFetch(200, { status: true, data: { id: 'card_1' } });
  const result = await bitnobClient(config, impl).createCard({ amountUsd: 5, reference: 'dv-1' });
  assert.deepEqual(result, { cardId: 'card_1' });
  assert.equal(requests[0].url, 'https://bitnob.test/api/v1/virtualcards/create');
  assert.equal(requests[0].headers.Authorization, 'Bearer sk_test');
  assert.deepEqual(requests[0].body, {
    customerEmail: 'ops@example.com', cardBrand: 'visa', cardType: 'virtual', reference: 'dv-1', amount: 500,
  });
});

test('surfaces Bitnob error messages', async () => {
  const { impl } = fakeFetch(400, { status: false, message: 'Insufficient balance' });
  await assert.rejects(bitnobClient(config, impl).createCard({ amountUsd: 5, reference: 'x' }),
    (err) => err instanceof BitnobError && err.message === 'Insufficient balance');
});

test('reports an unreachable Bitnob host as a BitnobError', async () => {
  const impl = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  await assert.rejects(bitnobClient(config, impl).createCard({ amountUsd: 5, reference: 'x' }),
    (err) => err instanceof BitnobError && /unreachable.*ENOTFOUND/.test(err.message));
});
