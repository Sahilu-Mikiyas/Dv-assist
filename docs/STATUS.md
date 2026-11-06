# Project status

Last updated: 2026-11-06

## Live

- App: https://dv-assist.onrender.com (Render free plan, Frankfurt, Docker, auto-deploys from `main`)
- Database: Turso `dv-assist-sahilu-mikiyas` (Frankfurt). Applicant data and photos are encrypted at rest.
- Repo: https://github.com/Sahilu-Mikiyas/Dv-assist

## Working

- Operator login, case form (applicant, spouse, children), automatic photo preparation (600×600 JPEG, 240 KB or less),
  issue card, show card details, record confirmation number.
- Bitnob signed requests (HMAC) to `https://api.bitnob.com`. Sandbox key, company "Furii Labs".
- Sandbox card-holder customer exists (`BITNOB_CARD_CUSTOMER_ID` on Render).
- 65 automated tests, run by GitHub Actions on every push.

## Pinned: automatic SMS and email are NOT switched on

- The messaging code is built and live, but no provider is connected: no AfroMessage (SMS) or Brevo (email)
  account or keys have been added. Every message waits on staff → Messages to be sent by hand.
- To come back to: open AfroMessage (top-up, registered sender name) and/or Brevo (verified sender), add
  the keys on Render (see "Messages" below), then send one real test SMS and email before relying on them.

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

## Passport scans (built)

- DV-2027 requires a valid passport: number, issuing country, expiry, and scans of the photo page (required)
  and signature page (if separate). On the applicant form, the staff form, Abol check and the copy rows.
- Entries started before this need the passport added before they can be sent or checked.
- Confirm the exact passport rules on travel.state.gov when the DV-2027 entry period opens.

## Data retention (built; rules off until you set the days)

- Staff → Data shows each rule, and what it would erase if switched on. Rules run every 6 hours.
- Decide and set on Render: `RETENTION_DAYS_AFTER_SUBMISSION` (suggested 548, about 18 months) and
  `RETENTION_DAYS_UNSENT` (suggested 60). Then the landing page FAQ can state the period.
- Admins can erase a single case on request from its page ("Erase personal data", type ERASE).
- Audit log entries (who did what, IPs) are kept; decide whether they also need a limit.

## Messages (built; no provider connected yet)

- Outbox + worker: SMS via AfroMessage for Ethiopian mobiles, email via Brevo otherwise, 5 retries with
  backoff. Recipient and text encrypted; erased once delivered.
- Applicant: resume code, received, approval needed (website entries), submitted + confirmation number.
  Partner: approval. Invitee: partner's invitation (SMS only).
- Until a provider is set, everything waits on staff → Messages ("SMS …" / "Email …" / Copy / Mark as sent).
- To switch on SMS: AfroMessage account, top-up, a registered sender name, then on Render set
  `AFROMESSAGE_TOKEN`, `AFROMESSAGE_IDENTIFIER_ID`, `AFROMESSAGE_SENDER`. The adapter follows AfroMessage's
  published Node SDK (afromessage.com itself is blocked from the build environment): test one real SMS first.
- To switch on email: Brevo free account, verify a sender address, set `BREVO_API_KEY` and `EMAIL_FROM`.
- Not built: reminders (e.g. approval still pending after 3 days), messages when staff reopen a case.
- Amharic message texts need native review.

## Referral partners (built)

- `/partners` sign-up → admin approves on staff Partners page (code shown once) → partner signs in at
  `/partner/` with the code.
- Dashboard: counts, referrals (name, package, stage, earning), referral link `/r/<CODE>` with copy and
  Telegram share, payout note.
- Introduce someone: creates `/i/<REF>` and an English + Amharic message for the partner to send by SMS or
  Telegram themselves (no SMS provider yet). The invitee's page greets them and preselects the package.
- Fill together: `/apply?ref=…&together=1`. Counts only when the partner is signed in on that device. The
  applicant writes down their own code; the session on the partner's phone ends after 2 hours or at
  "Finish & hand back".
- Staff: "via <partner>" on cases; follow-up list flags introductions not started after 2 days.
- Payouts (built): staff → Payouts. Owed now → Create payout → pay by Telebirr by hand → Mark paid with the
  transaction number → partner is messaged. Cancel releases entries. CSV export. Paying out needs
  `PARTNER_COMMISSION_ETB` set; the money itself is sent outside the app.
- QR code + printable A4 counter poster (built; QR checked to scan correctly).
- Partner statement page + CSV, and admin Partner report + CSV (built): referrals by status, package,
  route and applicant payment; commission ledger; payouts with entry numbers.
- Applicant payments are recorded by staff on the case page for now (amount, method, transaction number).
  Commission is earned on submission, not on payment; change if you want it tied to payment.
- Decide: commission per submitted entry (`PARTNER_COMMISSION_ETB`), payout day, partner terms text.
  Not built: SMS confirmation codes when filling together.
- The Amharic invitation uses the polite form (አስተዋውቆዎታል / ይጀምሩ) so it fits anyone; needs native review.

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
- Connect AfroMessage (SMS) and/or Brevo (email) for automatic messages.
- Photo analyzer: real-photo testing and threshold tuning (see above).
