// Builds the three policy pages (privacy, terms, refunds) from one shared layout.
// Run: node scripts/build-legal.mjs   (rewrites public/privacy.html, public/terms.html, public/refunds.html)

import { writeFileSync } from 'node:fs';

const head = (title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Ethio DV Assist</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&amp;family=Inter:wght@400;500;600&amp;family=Noto+Sans+Ethiopic:wght@400;500;600&amp;family=Noto+Serif+Ethiopic:wght@500&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="/apply.css">
</head>
<body>
<header class="top">
  <div class="top-in">
    <a class="brand" href="/">
      <svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="10" fill="#fff"/><path d="M8 26h24M8 31h24" stroke="#B22234" stroke-width="3" stroke-linecap="round"/><path d="M20 7l2.1 4.3 4.7.6-3.4 3.2.9 4.7-4.3-2.3-4.3 2.3.9-4.7-3.4-3.2 4.7-.6z" fill="#0A3161"/></svg>
      <span>Ethio DV Assist</span>
    </a>
    <nav class="top-side legal-nav" aria-label="Policies">
      <a class="top-link" href="/privacy">Privacy</a>
      <a class="top-link" href="/terms">Terms</a>
      <a class="top-link" href="/refunds">Refunds</a>
    </nav>
  </div>
</header>
<main class="page">
  <article class="legal">
    <p class="draft-banner" role="note">Draft, to be reviewed by a lawyer before launch. Not yet final. · ረቂቅ ሰነድ</p>
`;

const foot = `  </article>
</main>
<footer class="foot">Independent service. Not affiliated with the U.S. Government. Entries are made only on the official site, dvprogram.state.gov.<br> <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/refunds">Refunds</a></footer>
<script type="module" src="/legal.js"></script>
</body>
</html>
`;

const page = (file, title, am, updated, body) => writeFileSync(new URL(`../public/${file}`, import.meta.url),
  `${head(title)}    <h1>${title}</h1>
    <p lang="am" class="am-sub">${am}</p>
    <p class="muted">Last updated ${updated}. The Amharic version is being prepared; until then the English text applies. · የአማርኛ ትርጉም በዝግጅት ላይ ነው።</p>
${body}
${foot}`);

const UPDATED = '7 November 2026';

page('privacy.html', 'Privacy policy', 'የግላዊነት ፖሊሲ', UPDATED, `
    <section>
      <h2>Who we are</h2>
      <p>Ethio DV Assist is an independent service in Addis Ababa, Ethiopia, that helps people prepare and file entries for the U.S. Diversity Visa (DV) lottery. We are not part of, or endorsed by, the U.S. Government. We are responsible ("data controller") for the personal data described here under Ethiopia's Personal Data Protection Proclamation No. 1321/2024.</p>
    </section>

    <section>
      <h2>What we collect</h2>
      <ul>
        <li><b>About you and your family:</b> names, gender, date, city and country of birth, country of eligibility and residence, mailing address, phone, email, education, marital status, and the same birth details for your spouse and each child under 21.</li>
        <li><b>Passport:</b> passport number, issuing country, expiry date, and pictures of the photo page and, if separate, the signature page.</li>
        <li><b>Photos</b> of each person on the entry.</li>
        <li><b>Payments:</b> your package, the amount you paid, how (Telebirr, CBE Birr, bank or cash) and the transaction number; refunds.</li>
        <li><b>Your entry's progress</b>, and the confirmation number from the official site once filed.</li>
        <li><b>Security records:</b> which staff member did what and when, and the internet address (IP) of sign-ins and changes.</li>
        <li><b>Referral partners:</b> name, organisation, phone, city and the Telebirr number for payouts; and the name and phone of people they introduce, with those people's permission.</li>
      </ul>
      <p>Your resume code is stored only in a scrambled form (a "hash"): we cannot read it back.</p>
    </section>

    <section>
      <h2>Why we use it</h2>
      <ul>
        <li>To prepare, check and file one DV entry per person on the official site, as you asked us to.</li>
        <li>To contact you about your entry, your approval, your payment and your confirmation number.</li>
        <li>To take payments and give refunds, and to pay referral partners their agreed share.</li>
        <li>To prevent mistakes and fraud, including duplicate entries, which disqualify people.</li>
        <li>To keep records the law requires.</li>
      </ul>
      <p>We use your data because you ask us to provide this service and agree to these terms, and, for security and fraud records, because we have a legitimate need to keep the service safe.</p>
    </section>

    <section>
      <h2>Who can see it</h2>
      <ul>
        <li><b>Our checking team,</b> once you send your entry for checking. Each person signs in with their own account and an authenticator code, and every action is recorded.</li>
        <li><b>The partner who referred you</b> sees only your name, package, how far your entry has gone and whether you have paid. Never your details, photos or passport.</li>
        <li><b>The U.S. Department of State,</b> when we file your entry on dvprogram.state.gov. Their privacy rules then apply to that copy.</li>
        <li><b>Companies that run parts of our service for us,</b> only for that purpose: our hosting (Render) and database (Turso), with servers in Frankfurt, Germany; and, when switched on, our SMS (AfroMessage) and email (Brevo) providers, which receive your phone number or email and the message. Our card provider (Bitnob) issues cards to us, not to you, and receives none of your personal data.</li>
        <li><b>Fonts</b> on our pages are loaded from Google Fonts, which receives your device's internet address.</li>
      </ul>
      <p>We never sell your data and never use it for advertising.</p>
    </section>

    <section>
      <h2>How we protect it</h2>
      <p>Your details, photos and passport pictures are encrypted (AES-256) before they are stored, so a copy of the database alone reveals nothing. Staff accounts need a password and an authenticator code; partners sign in with a personal code. Messages that contain codes are erased once delivered.</p>
    </section>

    <section>
      <h2>How long we keep it</h2>
      <ul>
        <li>Entries that were filed: <b data-retention="afterSubmission">until we decide the period</b>.</li>
        <li>Entries never sent for checking, and invitations never used: <b data-retention="unsent">until we decide the period</b>.</li>
      </ul>
      <p>When the time is up, your details, photos, passport pictures, codes and confirmation number are erased automatically. We keep only the entry number, its progress and the security records. People selected in the lottery need their details for the visa forms well into the following year, which is why filed entries are kept longer.</p>
    </section>

    <section>
      <h2>Your rights</h2>
      <ul>
        <li>See the personal data we hold about you, and get a copy.</li>
        <li>Have it corrected. Before your entry is filed, you can change it yourself or ask us; once filed, the official entry itself cannot be changed.</li>
        <li>Have it erased. We erase it on request, except while a payment card for your entry is being used, and except records we must keep by law. An entry already filed on the official site cannot be withdrawn by us.</li>
        <li>Withdraw your permission for things that rely on it, such as a partner sharing your number.</li>
        <li>Complain to the Ethiopian Communications Authority, which supervises data protection.</li>
      </ul>
      <p>To use these rights, contact us with your entry number (for example EDA-0012). We may ask for your resume code or passport to confirm it is you.</p>
    </section>

    <section>
      <h2>Children</h2>
      <p>The DV form requires every unmarried child under 21 to be listed. We collect children's details only from the parent or guardian who makes the entry, and only for that entry.</p>
    </section>

    <section>
      <h2>Cookies</h2>
      <p>We use only the cookies needed to keep you signed in (for your entry, a partner account or staff work). No tracking or advertising cookies.</p>
    </section>

    <section>
      <h2>Changes and contact</h2>
      <p>We will post any change here with a new date. Contact: <span class="contact-placeholder">phone and office address to be added</span>.</p>
    </section>`);

page('terms.html', 'Terms of service', 'የአገልግሎት ውሎች', UPDATED, `
    <section>
      <h2>What we do</h2>
      <p>We help you prepare a U.S. Diversity Visa (DV) lottery entry: we check your details twice, prepare your photos and passport pictures, and, depending on your package, file the entry for you on the official site, pay the official entry fee and give you the confirmation number. The packages and prices are on our <a href="/#services">home page</a>.</p>
    </section>

    <section>
      <h2>What we are not</h2>
      <ul>
        <li>We are an independent business, not the U.S. Government, and not endorsed by it.</li>
        <li>Selection is random. Nobody, including us, can improve your chances, and we never promise that you will be selected.</li>
        <li>Entries are only made on the official site, dvprogram.state.gov. Anyone can enter there themselves.</li>
      </ul>
    </section>

    <section>
      <h2>Your part</h2>
      <ul>
        <li>Give true, complete details, exactly as in your passport, including your spouse and every unmarried child under 21, even those who will not travel with you.</li>
        <li>Enter only once. If you, or anyone for you, files another entry for you, the DV rules disqualify all your entries. Tell us if you have already entered this year.</li>
        <li>Read your entry when we ask and give your approval. We file nothing without it.</li>
        <li>Keep your resume code and your confirmation number safe. You need the confirmation number to check your result on the official site.</li>
      </ul>
    </section>

    <section>
      <h2>Our part</h2>
      <ul>
        <li>Two different people on our team check every entry before you approve it.</li>
        <li>We file one entry per person, only after your approval, and give you the confirmation number.</li>
        <li>We keep your data private and secure, as described in our <a href="/privacy">privacy policy</a>.</li>
      </ul>
    </section>

    <section>
      <h2>Payment and refunds</h2>
      <p>You pay the package price before we file your entry. Refunds follow our <a href="/refunds">refund policy</a>.</p>
    </section>

    <section>
      <h2>Limits of our responsibility</h2>
      <p>We are not responsible for decisions of the U.S. Government, changes to the DV rules or dates, the official site being unavailable, or the result of the lottery. If we make a mistake that stops your entry from being filed, our responsibility is limited to refunding what you paid us.</p>
    </section>

    <section>
      <h2>Referral partners</h2>
      <p>Partners who refer applicants agree to: never charge applicants anything extra; only refer people who asked for help; never promise anyone they will be selected; keep applicants' details private; and only share a phone number with that person's permission. Partners are paid as agreed in writing with us. We may suspend a partner who breaks these promises.</p>
    </section>

    <section>
      <h2>Changes, law and contact</h2>
      <p>We may update these terms and will post the new version here with its date. These terms are governed by the laws of Ethiopia. Contact: <span class="contact-placeholder">phone and office address to be added</span>.</p>
    </section>`);

page('refunds.html', 'Refund policy', 'የተመላሽ ገንዘብ ፖሊሲ', UPDATED, `
    <p class="lead">These rules are a proposal for Ethio DV Assist to confirm. Prices are on our <a href="/#services">home page</a>.</p>

    <section>
      <h2>Full refund</h2>
      <ul>
        <li>You cancel before our team has started checking your entry.</li>
        <li>We cannot file your entry because of a mistake on our side.</li>
        <li>The entry period closes, or the U.S. Government cancels it, before we file your entry.</li>
      </ul>
    </section>

    <section>
      <h2>Partial refund</h2>
      <p>You cancel after our team has checked your entry but before it is filed: we refund the price minus <b>300 ETB</b> for the checking work.</p>
    </section>

    <section>
      <h2>No refund</h2>
      <ul>
        <li>After your entry has been filed on the official site: it cannot be withdrawn, and the official fee has been paid.</li>
        <li>For not being selected. Selection is random.</li>
        <li>If you gave false or incomplete details, or entered more than once.</li>
      </ul>
    </section>

    <section>
      <h2>How refunds are paid</h2>
      <p>Ask us with your entry number. We pay refunds within 14 days, to the same Telebirr or CBE Birr account you paid from, or in cash at our office if you paid in cash. Every refund is recorded with its reason.</p>
    </section>`);

console.log('wrote privacy.html, terms.html, refunds.html');
