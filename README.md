# DV Assist

A minimal tool for an operator who files Diversity Visa (DV) lottery entries for applicants.
It records each applicant's entry details and photos, issues a Bitnob virtual USD card to pay
the official DV fee, and records the confirmation number.

No framework and no npm dependencies: Node's built-in `http` and `sqlite`, plus plain HTML.

## Flow

1. **Applicant details:** the fields the official entry form asks for, including spouse and children.
2. **Photos:** one per person, checked for JPEG format, exactly 600×600 pixels and 240 KB or less.
3. **Pay the DV fee:** issue a Bitnob virtual card loaded with `CARD_AMOUNT_USD`, show its details,
   and pay on the official site.
4. **Submit:** save the confirmation number. The case is then locked.

Case status: `draft` → `card_issued` → `submitted`.

## Run

Requires Node.js 22.9 or later.

```sh
cp .env.example .env   # fill in the values
npm start              # http://localhost:3000
npm test
```

## Bitnob setup

- Create an account (sandbox: https://sandboxapp.bitnob.co) and copy the secret key into `BITNOB_SECRET_KEY`.
- Register and KYC **one** card user, your business, in Bitnob. Put its email in
  `BITNOB_CARD_CUSTOMER_EMAIL`. Every card is issued under it, so applicants never go through Bitnob KYC.
- Keep enough USD balance in Bitnob to fund the cards.

All Bitnob calls are in `src/infra/bitnob.js`. They use the v1 Virtual Cards endpoints
(`POST /virtualcards/create`, `GET /virtualcards/cards/:id`) with Bearer auth. Bitnob has been
moving cards to a newer API, so check those paths against the docs for your account and test in
the sandbox before going live.

## Structure

```
src/
  domain/     pure rules: applicant validation, photo checks, status transitions
  services/   use cases: create/update case, save photo, issue card, submit
  infra/      SQLite repository and Bitnob client
  http/       routing, login, static files
  config.js   environment variables
  main.js     wires everything together
public/       HTML pages and browser JS
test/         node:test suites (Bitnob is faked)
```

## Security notes

- One operator password. The session cookie is HMAC-signed, HttpOnly and SameSite=Strict, and expires after 8 hours.
- Card number and CVV are fetched from Bitnob when needed and never stored. They can only be viewed
  while a case is waiting to be submitted.
- Each card request uses the reference `dv-<caseId>`, and requests for the same case are serialized,
  so a double click cannot issue two cards.
- Applicant data and photos are stored in `DB_PATH`. Protect and back up that file.
- Serve the app over HTTPS in production. `SECURE_COOKIES` defaults to `true`.
