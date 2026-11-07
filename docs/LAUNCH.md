# Launch checklist

Work through this before the first real applicant. Tick each line; anything not done is a known risk.

## 1. Accounts and keys (owner)

- [ ] **Rotate the secrets that were pasted in chat:** the Bitnob API key, the Turso token, and the first admin's
      temporary password. New values go on Render → Environment; then redeploy.
- [ ] **Keep `DATA_ENCRYPTION_KEY` in two safe places** (a password manager and a sealed paper copy). Without it,
      neither the live database nor any backup can be read. Never change it once real data exists.
- [ ] **Bitnob:** live (not sandbox) key, live card-holder customer, Render's outbound IPs whitelisted, company
      wallet funded. Issue one real card for a test case, reveal it, and check the official fee can be paid with it.
- [ ] **Payments:** Telebirr and CBE Birr merchant accounts. Until online payment is built, staff record payments on
      the case page.
- [ ] **Messages:** AfroMessage (SMS) and/or Brevo (email) keys on Render (see README → Messages). Send one real
      SMS and one email to yourself. Until then, an admin sends everything from staff → Messages.

## 2. Decisions (owner)

- [ ] Tech-centre commission per submitted entry (staff → Costs) and partner payout day.
- [ ] Revenue-share terms for Mr. Ermiyas Abera signed by both sides, after a lawyer drafts them; correct the
      5,000-direct bar in the offer (it uses 55%, the ladder says 60%).
- [ ] Data retention: `RETENTION_DAYS_AFTER_SUBMISSION` (suggested 548) and `RETENTION_DAYS_UNSENT` (suggested 60).
      The privacy page then shows them automatically.
- [ ] Refund rules: confirm or change the proposal on /refunds (scripts/build-legal.mjs, then rebuild).
- [ ] Have a lawyer review /privacy, /terms and /refunds; then remove the "draft" banner (scripts/build-legal.mjs).
- [ ] Landing-page facts: phone, office address, entry-window dates; the same contact details on the policy pages.
- [ ] Native-speaker review of every Amharic text (landing, applicant flow, messages, policies).

## 3. Safety nets (owner, about 15 minutes)

- [ ] **Uptime monitor:** create a free monitor (for example UptimeRobot or Better Stack) for
      `https://dv-assist.onrender.com/healthz`, every 5 minutes, alerting your phone and email. It reports
      "database unreachable" separately (HTTP 503).
- [ ] **Render alerts:** Render → service → Notifications: failed deploys and service down, to your email.
- [ ] **Turso:** in the Turso dashboard, check which point-in-time restore your plan includes, and turn on any
      automatic backups offered.
- [ ] **Our own backup:** staff → Data → Download full backup, weekly and before every big change. Store it on an
      encrypted drive. Try a restore once (README → Backups) so you know it works.
- [ ] **Render plan:** the free plan sleeps after 15 minutes idle (first visit takes up to a minute). Move to a
      paid instance, or to Railway, before advertising.

## 4. Rehearsal on the live site (owner + one staff member, about an hour)

Use made-up people and passports (e.g. EP0000001…). Afterwards, erase each rehearsal case (case page → Erase
personal data) and cancel or zero any rehearsal payouts.

1. **Applicant on a phone:** start at the home page → Start your entry → Managed. Fill in a family with a spouse and
   two children, add photos through the photo checker and a passport picture, write down the code, send.
2. **Resume:** on another phone, open /apply → Continue with your code → check the progress page.
3. **Staff A:** sign in, open the case from the queue, run Abol. **Staff B** (a different person) runs Tona.
4. **Applicant:** approve online (Baraka).
5. **Admin:** record the payment (case page), issue the card, reveal it, then record a made-up confirmation number.
6. **Applicant:** the status page shows the confirmation number.
7. **Partner:** apply at /partners; admin approves (staff → Partners), sign in at /partner/ with the code, print the
   counter poster, introduce someone, fill one entry together on the partner's phone, finish and hand back.
8. **Payouts:** staff → Payouts → create and mark paid a payout for the partner (use a test transaction number).
9. **Revenue share:** set a test partner to revenue share (staff → Partners → Set terms), open its account page.
10. **Messages:** staff → Messages shows everything that would have been sent; send one by hand.
11. **Backup:** staff → Data → Download full backup; restore it into a local file (README → Backups).
12. **Clean up:** erase the rehearsal cases; check staff → Audit log shows every step with the right names.

Anything that confuses you during the rehearsal will confuse an applicant: note it and send it to me.

## 5. Known limits

- One server process (Render today). Card issuing and the one-entry-per-passport rule are also protected in the
  database, so running two servers later is safe; rate-limit counters are kept per server.
- Bitnob webhook replays only add audit rows.
