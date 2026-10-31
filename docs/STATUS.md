# Project status

Last updated: 2026-10-30

## Live

- App: https://dv-assist.onrender.com (Render free plan, Frankfurt, Docker, auto-deploys from `main`)
- Database: Turso `dv-assist-sahilu-mikiyas` (Frankfurt). Applicant data and photos are encrypted at rest.
- Repo: https://github.com/Sahilu-Mikiyas/Dv-assist

## Working

- Operator login, case form (applicant, spouse, children), automatic photo preparation (600×600 JPEG, 240 KB or less),
  issue card, show card details, record confirmation number.
- Bitnob signed requests (HMAC) to `https://api.bitnob.com`. Sandbox key, company "Furii Labs".
- Sandbox card-holder customer exists (`BITNOB_CARD_CUSTOMER_ID` on Render).
- 27 automated tests, run by GitHub Actions on every push.

## Pinned: Bitnob sandbox card test

- "Issue card" reaches Bitnob and is refused only for funds:
  "Insufficient company balance: required 7.00, available 0.00 USDC".
- Bitnob charges a flat $2 per card on top of the load. Minimum load is $2.
- Tried: 20 test USDC from faucet.circle.com on Solana devnet. Not credited to the Bitnob sandbox wallet.
- Next: ask Bitnob support (dashboard → Chat with Support) how to add sandbox USDC, or check
  Wallets → USDC → Receive USDC for the networks the sandbox accepts.
- After funding: Issue card → Show card details. If the field names differ, the app reports which fields
  came back (names only), and `src/infra/bitnob.js#getCard` needs mapping.

## Before going live

- Rotate the Bitnob sandbox key and the Turso token. Both were pasted in chat.
- Change the first admin's temporary password (it was shared in chat).
- Card holder KYC on live (Bitnob asks for `id_type` and `id_number`).
- Set `CARD_AMOUNT_USD` to the official DV fee (minimum $2).
- Whitelist Render's outbound IPs on the live Bitnob key.

## Staff app (built, live)

- Personal staff accounts (admin / staff), password + authenticator code, set up on first sign-in.
  First admin: mickeysahilu@gmail.com (created from `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH`).
- Stages: draft → Abol → Tona (different person) → Baraka (applicant approval, recorded by staff) → card →
  submitted. Case numbers EDA-0001…, assignment, queue with counters and search.
- Case workspace with copy-ready fields, photo downloads, card reveal with billing address, activity.
- Admin-only team page and audit log (CSV export). Bitnob webhook receiver (`BITNOB_WEBHOOK_SECRET`) and
  `BITNOB_CARD_TYPE` (virtual / lite) ready but unconfigured.

## Design (done; staff app built, the rest awaiting build)

- Canvas: https://claude.ai/artifact/WTEsmBHebRooMcs47ahCVY (private to the owner)
- Brand: "Ethio DV Assist". English and Amharic side by side. Red, white and blue, with a waving flag and
  American landmark illustrations; tibeb borders and the coffee-ceremony rounds (Abol, Tona, Baraka) as
  the three checks.
- 16 screens: landing, design system, applicant flow (details, photos analyzer, review, payment, submitted),
  referral partners (landing, dashboard, introduce, fill together, sent), staff (login, queue, case
  workspace, audit log).
- Placeholders to decide: entry-window and results dates, phone, office address, data retention, partner
  commission and payout day, VIP service area.
- The Amharic copy needs a native-speaker review.

## Next phase

- Landing page and applicant flow, with applicant accounts, Telebirr / CBE Birr payments and SMS.
  Baraka approval then moves to the applicant.
- Referral partners: accounts, introductions, fill-together with SMS code, payouts.
- Photo analyzer (face position, background, etc.), modelled on the Lovable prototype
  (repo `Sahilu-Mikiyas/ethiopia-dv-assist`).
