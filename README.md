# DV Assist

A minimal tool for an operator who files Diversity Visa (DV) lottery entries for applicants.
It records each applicant's entry details and photos, issues a Bitnob virtual USD card to pay
the official DV fee, and records the confirmation number.

Plain Node.js and HTML. One runtime dependency: `@libsql/client`, which runs the same SQLite
database either as a local file or hosted on Turso.

## Pages

- `/`: public landing page.
- `/apply`: applicants start an entry, add family and photos, and send it for checking. A resume code
  lets them come back on any device, follow progress, and give their final approval online.
- `/photo`: free photo check. Nothing is uploaded; the prepared 600 × 600 photo can be downloaded.
- `/partners`: referral partner sign-up. `/partner/`: the partner's own dashboard (sign-in with a partner code).
- `/r/<code>` and `/i/<reference>`: a partner's referral link and a personal invitation; both open `/apply`.
- `/staff/`: the staff app.

## Messages

Applicants and partners get a short English + Amharic message at each step:

| When | To | Message |
| --- | --- | --- |
| Entry started on the website | Applicant | Their resume code and link |
| Entry sent for checking | Applicant | Received, being checked |
| Both checks done (website entries) | Applicant | Please approve online |
| Submitted | Applicant | Confirmation number |
| Partner introduces someone | Invitee | Their personal link (SMS only; otherwise the partner sends it) |
| Partner approved | Partner | Approved; sign in with the code from the team |

Messages go into an outbox (`messages` table, recipient and text encrypted, erased after delivery). A
background worker sends them by SMS to Ethiopian mobile numbers (AfroMessage) or else by email (Brevo),
retrying with backoff up to 5 times. Without a provider, or after repeated failures, they wait on the staff
**Messages** page with SMS/email/copy buttons and "Mark as sent". Set `AFROMESSAGE_TOKEN` (plus identifier
and sender name) and/or `BREVO_API_KEY` + `EMAIL_FROM` to send automatically.

## Data retention

Two rules, each off until its number of days is set (staff → **Data** shows what each would erase):
- `RETENTION_DAYS_AFTER_SUBMISSION`: submitted entries, counted from submission. Selected applicants need
  their details for the visa forms into the following year, so keep this long (about 548 days).
- `RETENTION_DAYS_UNSENT`: website entries never sent for checking, and unused partner invitations.

Erasing removes applicant details, photos, confirmation number, resume code and queued messages; the case
number, stage and audit trail stay. Rules run at start and every 6 hours. Entries still in progress are never
erased automatically. Admins can erase one case on request from its page (not while a card is issued).

## Referral partners

Shops, schools, faith and community groups introduce applicants.
1. They apply at `/partners`. An admin calls them, then approves them on the staff Partners page, which shows
   a sign-in code once (only its hash is stored).
2. In their dashboard they see each referral's name, package and stage (invited, started, being checked,
   being filed, submitted), never the entry's details, plus their referral link and earnings.
3. Three ways to refer: share their link; introduce someone (creates a personal link and a ready-made
   English and Amharic message to send by SMS or Telegram); or fill the form together on their phone. Together
   entries close on the partner's phone after 2 hours or when they tap "Finish & hand back"; the applicant
   keeps their own resume code.
4. Staff see "via <partner>" on every referred case, and a follow-up list of introductions not started after
   two days.

Commission per submitted entry comes from `PARTNER_COMMISSION_ETB` (unset: "to be confirmed").

**QR code and poster:** the dashboard shows the partner's QR code (their `/r/<code>` link) with a download, and
"Print counter poster" opens an A4 poster with the QR code, link and short bilingual pitch. QR codes are made in
the browser by the vendored `qrcode-generator` (MIT, `public/vendor/qrcode.mjs`).

**Statements:** every partner has a statement page (`/partner/statement.html`, CSV download) listing every
referral with its entry number, grouped by status, package, route (link / introduced / filled together) and
applicant payment, plus the commission ledger (paid, being paid, due, total) and each payout with the entry
numbers it covered. Partners see only their own referrals. Admins see every partner side by side with totals
on staff → Partners → Partner report (CSV export). All three views come from one calculation
(`src/domain/statement.js`), so they always agree.

**Applicant payments:** until Telebirr / CBE Birr are connected, staff record what each applicant paid on the
case page (amount, method, transaction number; one per case; admins can remove a wrong one).

**Payouts** (staff → Payouts, admins): "Owed now" lists each partner's submitted referrals not yet paid.
"Create payout" fixes the amount and the entries it covers; the admin sends it by Telebirr outside the app,
then records the Telebirr transaction number ("Mark paid"), and the partner gets a message. A pending payout
can be cancelled, which releases its entries. Each entry can be paid only once (enforced by the database).
Partners see paid and owed amounts and their payout history. CSV export for bookkeeping.

## Passport (DV-2027 rule)

Entrants must now give a valid passport. Both the applicant form and the staff form ask for passport number,
issuing country and expiry date (an expired passport is refused), and take a picture of the passport photo page
(required) and the signature page (only if separate). Pictures are resized in the browser (long side up to
1600 px, about 1 MB), stored encrypted in `documents`, erased with the rest of the case, and required before an
entry can be sent for checking or pass Abol. Staff see and download them on the case page.

## Photo analyzer

Every photo, from applicants or staff, goes through the same on-device editor (`public/photo/`):
1. It finds the head against the plain background and auto-positions the photo so the head fills about 60%.
2. The person drags and zooms with guides: a line for the top of the head and a green band where the chin
   must sit (head height 50–69% of the photo).
3. Live checks: background (light, plain, not coloured), shadow on one side, head size, centring, light on
   the face, focus, colour, and whether the photo had to be enlarged.
4. The person confirms what pixels cannot tell (glasses, eyes open, taken in the last 6 months), and the
   photo is saved as a 600 × 600 JPEG of at most 240 KB.

Staff see the analyzer's flags next to each saved photo. There is no AI model and no download: the checks are
plain pixel measurements (`public/photo/check.js`, unit-tested in `test/photo-check.test.js`). They are
advice, not an official decision.

## Flow

Entries come from the website (`/apply`) or are typed in by staff. Staff work each case through the checks the design calls the coffee rounds:

1. **Draft:** the applicant (on the website) or a staff member enters the applicant, spouse and children, and adds a photo for each person through the photo analyzer.
   Website entries reach the staff queue once the applicant sends them for checking.
2. **Abol:** the first check, against the passport.
3. **Tona:** the second check, which must be done by a *different* staff member.
4. **Baraka:** the applicant approves the final entry, online with their resume code, or staff record it
   as in person or by phone.
5. **Card:** a Bitnob virtual card is issued for the official fee.
6. **Submitted:** staff file on the official site, using Copy buttons, the photo downloads and the revealed
   card, then record the confirmation number.

A case can be reopened for corrections before its card is issued, which clears its checks.

Staff sign in with email, password and an authenticator app; the authenticator is set up on first sign-in.
Admins also manage the team and see the audit log, which records every action with who, when and from which IP.

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
  services/   use cases: cases (staff), applications (website applicants), staff accounts; each action audited
  infra/      database + migrations, encryption, Bitnob client, logging
  http/       routing, login, rate limiting, security headers
  config.js   environment variables, validated at startup
  main.js     wires everything together; shuts down cleanly on SIGTERM
public/       landing page, applicant flow (apply.*), staff app (staff/); no inline scripts or styles
scripts/      setup-secrets
test/         node:test suites (Bitnob is faked)
```

## Security

| Concern | Measure |
| --- | --- |
| Data at rest | Applicant details and photos are encrypted with AES-256-GCM before they reach the database. A leaked database or Turso account alone reveals no personal data. |
| Card data | Card number and CVV are never stored. They're fetched from Bitnob on demand, only while a case awaits submission, and every reveal is audited. |
| Four eyes | The second check must be done by a different staff member from the first. |
| Bitnob webhooks | Accepted only with a valid HMAC-SHA512 signature, and logged without card numbers. |
| Login | Personal accounts: password (scrypt hash) plus a 6-digit authenticator code (RFC 6238). Failed logins are limited per IP (5 per 15 min) and overall (50 per 15 min). Deactivated staff are signed out at once. |
| Partners | Sign-in with an admin-issued 12-character code (hash stored, rate-limited), on a separate signed cookie. Contact details and introductions are encrypted at rest. Partners see referrals' names and stages only. Introductions require the partner to confirm the person agreed. |
| Applicants | No accounts: a random 12-character resume code (60 bits). Only its SHA-256 hash is stored. Wrong codes and new entries are rate-limited per IP. Applicants see only their own entry, never staff names or card data. Their cookie is signed separately and cannot be used as a staff session. |
| Session | HMAC-signed cookie, `__Host-` prefixed, HttpOnly, Secure, SameSite=Strict, 8-hour expiry. Rotating `SESSION_SECRET` logs everyone out. |
| Cross-site attacks | Strict Content-Security-Policy with no inline scripts, `frame-ancestors 'none'`, Origin check on writes, and JSON/JPEG-only request bodies. |
| Transport | HSTS. HTTPS is provided by the host. |
| Duplicate payments | One card per case: requests for the same case are serialized, and Bitnob gets the idempotent reference `dv-<caseId>`. |
| Accountability | `audit_events` table: logins, failed logins, case edits, photo uploads, card issue/view and submission, with time and IP. |
| Logs | JSON request logs with a request id. They never include applicant or card data. |
| Retention | Personal data erased by policy or on request (see Data retention); erased cases can't be worked on, and their resume codes stop working. |
| CSV exports | Cells starting with = + - @ are prefixed so spreadsheet apps never run them as formulas. |
| Supply chain | One pinned dependency, checked by `npm audit` on every push. |
| Runtime | The container runs as a non-root user. The host checks `/healthz`. |

Before handling real applicants, also decide on data retention, and on who besides you may hold
`DATA_ENCRYPTION_KEY` and the Bitnob key.
