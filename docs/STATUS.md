# Project status

Last updated: 2026-11-01

## Live

- App: https://dv-assist.onrender.com (Render free plan, Frankfurt, Docker, auto-deploys from `main`)
- Database: Turso `dv-assist-sahilu-mikiyas` (Frankfurt). Applicant data and photos are encrypted at rest.
- Repo: https://github.com/Sahilu-Mikiyas/Dv-assist

## Working

- Operator login, case form (applicant, spouse, children), automatic photo preparation (600×600 JPEG, 240 KB or less),
  issue card, show card details, record confirmation number.
- Bitnob signed requests (HMAC) to `https://api.bitnob.com`. Sandbox key, company "Furii Labs".
- Sandbox card-holder customer exists (`BITNOB_CARD_CUSTOMER_ID` on Render).
- 46 automated tests, run by GitHub Actions on every push.

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

## Public site (built)

- `/`: landing page, converted from the approved design. Its inline styles became classes in
  `public/landing.css` (the security policy blocks inline styles). Placeholders were removed rather than
  invented: no phone, office address, entry-window date, retention period or VIP service area yet.
  The language toggle was left out; both languages show side by side.
- `/apply`: package → you & family → resume code (shown once) → photos → review → send for checking.
  The entry then appears in the staff queue marked "Website · <package>". After Abol and Tona, the
  applicant gives Baraka online on the same page; staff can still record it by phone or in person.
  The status page shows progress and, at the end, the confirmation number.
- No accounts or SMS: a 12-character resume code (only its hash is stored) signs the applicant back in
  on any device. Separate signed cookie (`dv_applicant`, 30 days). Starting entries is limited to 10 per
  hour per IP; wrong codes to 10 per 15 minutes.
- Payment is a placeholder: "our team will contact you" (Telebirr / CBE Birr).
- Staff app moved to `/staff/`.

## Photo analyzer (built)

- One editor for applicants (`/apply`), the free check (`/photo`) and staff (case workspace): auto-position,
  drag and zoom with a "top of head" line and a green chin band, live checks, three confirmations, then a
  600 × 600 JPEG of 240 KB or less. Staff see the analyzer's flags next to every saved photo.
- No AI model or download (a face-detection model would add about 10 MB per visitor). The head is found
  against the plain background with pixel measurements. Head height is an estimate (within about 5% on the
  test photos); the chin band lets the person line up their real chin.
- Tuned on synthetic test photos only. Next: try it with 20–30 real photos (different skin tones, hair,
  headscarves, white and grey walls) and adjust the thresholds in `public/photo/check.js`.
- Not detected automatically: glasses, closed eyes, expression, photo age. These are confirmations, and
  staff check them in Abol and Tona.

## Design (done; staff app and applicant flow built)

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

- Telebirr / CBE Birr payments (needs merchant accounts) and SMS notifications.
- Fill in the landing-page facts: phone, office address, entry-window date, data retention.
- Referral partners: accounts, introductions, fill-together with SMS code, payouts.
- Photo analyzer: real-photo testing and threshold tuning (see above).
