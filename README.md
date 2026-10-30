# DV Assist

A minimal tool for an operator who files Diversity Visa (DV) lottery entries for applicants.
It records each applicant's entry details and photos, issues a Bitnob virtual USD card to pay
the official DV fee, and records the confirmation number.

Plain Node.js and HTML. One runtime dependency: `@libsql/client`, which runs the same SQLite
database either as a local file or hosted on Turso.

## Flow

1. **Applicant details:** the fields the official entry form asks for, including spouse and children.
2. **Photos:** one per person, checked for JPEG format, exactly 600×600 pixels and 240 KB or less.
3. **Pay the DV fee:** issue a Bitnob virtual card loaded with `CARD_AMOUNT_USD`, show its details,
   and pay on the official site.
4. **Submit:** save the confirmation number. The case is then locked.

Case status: `draft` → `card_issued` → `submitted`.

## Run locally

Requires Node.js 22.9 or later.

```sh
npm install
cp .env.example .env
npm run setup-secrets      # paste the three printed lines into .env
npm start                  # http://localhost:3000
npm test
```

## Deploy for free: Render + Turso

Render's free web service has no persistent disk, so the data lives in Turso's free hosted SQLite.
Both offer free plans; check their current terms.

**1. Database (Turso)**
1. Sign up at https://turso.tech, using GitHub sign-in.
2. Create a database. Pick the region closest to the Render region you'll use (for example, Frankfurt for both).
3. Copy its URL (`libsql://…turso.io`) and create a database token.

**2. Secrets.** On your own machine, run `npm run setup-secrets` and keep the three printed values.
Store `DATA_ENCRYPTION_KEY` in a password manager. Without it, the stored data cannot be decrypted.

**3. App (Render)**
1. Sign up at https://render.com with GitHub.
2. Choose **New → Blueprint**, then select this repository. Render reads `render.yaml`.
3. Fill in the secret values it asks for: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `ADMIN_PASSWORD_HASH`,
   `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `BITNOB_CLIENT_ID`, `BITNOB_SECRET_KEY` and
   `BITNOB_CARD_CUSTOMER_ID`.
4. Deploy, then open the `…onrender.com` URL.

Free-tier limit: the service sleeps after about 15 minutes idle, and the first request after that
takes up to a minute.

## Move to Railway later

The same Dockerfile and environment variables work on Railway.
1. Create a project from this repository. Railway builds the `Dockerfile`.
2. Copy over the same variables, with `TRUST_PROXY=true`.
3. Database, either way:
   - **Keep Turso:** leave `DATABASE_URL` as it is. Nothing to migrate.
   - **Use a Railway volume:** mount it at `/app/data`, set `DATABASE_URL=file:/app/data/dv-assist.db`,
     and copy your data across first (`turso db shell <db> .dump`, then load the dump into the new file).

Keep the same `DATA_ENCRYPTION_KEY`, or existing data cannot be read.

## Bitnob setup

1. Sign up at https://app.bitnob.com and switch to **Sandbox Mode** for testing.
2. Create an API key. Whitelist Render's outbound IPs (Render → service → Connect → Outbound).
   Put its Client ID in `BITNOB_CLIENT_ID` and the key, including its `prd:` prefix, in `BITNOB_SECRET_KEY`.
3. Create **one** card-holder customer (`POST /api/customers` with `customer_type: individual`) and
   put its id in `BITNOB_CARD_CUSTOMER_ID`. Every card is issued to it, so applicants never go through Bitnob KYC.
4. Keep USDC in the company wallet. A $2 card needed $4.00 USDC in the sandbox (load plus fees).

How the integration works (`src/infra/bitnob.js`):
- Host `https://api.bitnob.com` serves both sandbox and live. The key decides which.
- Every request is signed: `X-Auth-Client`, `X-Auth-Timestamp` (Unix seconds), `X-Auth-Nonce`
  (16 random bytes, hex) and `X-Auth-Signature` = hex HMAC-SHA256 of `clientId:timestamp:nonce:body`.
- `POST /api/cards` issues a card. Amounts are in millionths of a dollar ($2 = 2,000,000), with a $2 minimum.
- `GET /api/cards/:id` returns card details. They are never stored.

## Structure

```
src/
  domain/     pure rules: applicant validation, photo checks, status transitions
  services/   use cases: create/update case, save photo, issue card, submit (each audited)
  infra/      database + migrations, encryption, Bitnob client, logging
  http/       routing, login, rate limiting, security headers
  config.js   environment variables, validated at startup
  main.js     wires everything together; shuts down cleanly on SIGTERM
public/       HTML pages and browser JS (no inline scripts)
scripts/      setup-secrets
test/         node:test suites (Bitnob is faked)
```

## Security

| Concern | Measure |
| --- | --- |
| Data at rest | Applicant details and photos are encrypted with AES-256-GCM before they reach the database. A leaked database or Turso account alone reveals no personal data. |
| Card data | Card number and CVV are never stored. They're fetched from Bitnob on demand, only while a case awaits submission, and every view is audited. |
| Login | One operator password, stored only as a scrypt hash. Failed logins are limited per IP (5 per 15 min) and overall (50 per 15 min). |
| Session | HMAC-signed cookie, `__Host-` prefixed, HttpOnly, Secure, SameSite=Strict, 8-hour expiry. Rotating `SESSION_SECRET` logs everyone out. |
| Cross-site attacks | Strict Content-Security-Policy with no inline scripts, `frame-ancestors 'none'`, Origin check on writes, and JSON/JPEG-only request bodies. |
| Transport | HSTS. HTTPS is provided by the host. |
| Duplicate payments | One card per case: requests for the same case are serialized, and Bitnob gets the idempotent reference `dv-<caseId>`. |
| Accountability | `audit_events` table: logins, failed logins, case edits, photo uploads, card issue/view and submission, with time and IP. |
| Logs | JSON request logs with a request id. They never include applicant or card data. |
| Supply chain | One pinned dependency, checked by `npm audit` on every push. |
| Runtime | The container runs as a non-root user. The host checks `/healthz`. |

Before handling real applicants, also decide on data retention, and on who besides you may hold
`DATA_ENCRYPTION_KEY` and the Bitnob key.
