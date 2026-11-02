// Delivery adapters. Each exposes send(...) and throws DeliveryError on failure; neither logs message text.
//
// SMS: AfroMessage (Ethiopia). POST <base>/send with a Bearer token; JSON { from, sender, to, message }.
//      Success is reported in the body as { acknowledge: "success" }, even when the HTTP status is 200 either way.
// Email: Brevo transactional API. POST https://api.brevo.com/v3/smtp/email with an api-key header.

export class DeliveryError extends Error {}

async function post(fetchImpl, url, headers, body) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new DeliveryError(`Network error: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export function afroMessageSms({ token, identifierId, senderName, baseUrl = 'https://api.afromessage.com/api', fetchImpl = fetch }) {
  return {
    name: 'AfroMessage SMS',
    async send({ to, text }) {
      const body = { to, message: text };
      if (identifierId) body.from = identifierId;
      if (senderName) body.sender = senderName;
      const { res, data } = await post(fetchImpl, `${baseUrl}/send`, { Authorization: `Bearer ${token}` }, body);
      if (!res.ok || data.acknowledge !== 'success') {
        const reason = data.response?.errors?.join?.('; ') ?? data.response?.message ?? `HTTP ${res.status}`;
        throw new DeliveryError(`AfroMessage: ${String(reason).slice(0, 200)}`);
      }
    },
  };
}

export function brevoEmail({ apiKey, fromEmail, fromName = 'Ethio DV Assist', fetchImpl = fetch }) {
  return {
    name: 'Brevo email',
    async send({ to, subject, text }) {
      const { res, data } = await post(fetchImpl, 'https://api.brevo.com/v3/smtp/email', { 'api-key': apiKey }, {
        sender: { name: fromName, email: fromEmail }, to: [{ email: to }], subject, textContent: text,
      });
      if (!res.ok) throw new DeliveryError(`Brevo: ${String(data.message ?? `HTTP ${res.status}`).slice(0, 200)}`);
    },
  };
}
