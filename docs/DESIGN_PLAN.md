# Design plan

## Creative direction: "Two horizons"

The story is a journey: one person in Ethiopia taking a careful, hopeful step towards a life in America,
with a trusted guide beside them. The design should feel like a well-made travel document crossed with an
Ethiopian home: precise, warm and dignified. Not a flag mash-up, not a visa-mill ad.

America, through imagery of the journey rather than flags:
- Horizon and open sky. Night-sky navy and a dawn gradient for "new day".
- Passport and travel-document craft: guilloché line patterns, embossed seals, stamp marks used as
  progress and success moments, perforated edges on "ticket" cards.
- A single line that travels across the page (the journey line), joining the steps.

Ethiopia, through feeling and craft rather than literal colour:
- Tibeb, the woven border of the netela, as a thin ornamental band on section dividers and card edges.
- Ge'ez script as a design element. Amharic headings sit beside English as equals, not as translations
  hidden behind a toggle.
- Coffee-ceremony hospitality in the voice: "We sit with you, step by step." Warm, patient, never pushy.
- Meskel gold as the accent: sunrise, celebration, the moment an entry is submitted.

Trust guardrails (non-negotiable):
- Never look like a U.S. government site. No eagle seals or State Department styling, and a clear
  "independent service, not affiliated with the U.S. government" line on every public page.
- Plain warning that the official entry is free to enter, apart from any official fee, and that no
  service can raise anyone's odds.

## Visual system

| Token | Direction |
| --- | --- |
| Base | Warm parchment (light) / deep night navy (dark) |
| Ink | Near-black navy for text |
| Accent | Meskel gold for highlights and success |
| Secondary | Muted terracotta / coffee for warmth; dusk blue for links and states |
| Display type | An editorial serif (e.g. Fraunces or Instrument Serif) |
| Body type | A clean sans (e.g. Inter or Geist) |
| Amharic | Noto Sans Ethiopic / Noto Serif Ethiopic, sized to match the Latin x-height |
| Ornament | Tibeb band, guilloché line art, stamp marks, all SVG and tiny |

Motion, used with purpose:
- The journey line draws itself as you scroll or progress through the form.
- A stamp "lands" when a step is completed. A soft gold shimmer marks submission.
- Gentle parallax on the hero horizon. Animated counters for trust stats.
- Respect `prefers-reduced-motion`. No animation blocks reading or input.

Performance is part of the design: many users are on mobile data in Ethiopia.
- Mobile-first layouts, SVG over photos, one or two web fonts with subsetting, and a target of under 300 KB
  for the first load.

## Page inventory

### Public site
1. **Landing:** hero ("Your entry, done right"), how it works, services, trust and safety, FAQ, partners, footer.
2. **Services and pricing:** Self-guided 500 ETB, Managed 1,500, Assisted 2,000, VIP 3,000, with a comparison.
3. **How it works:** the journey in five stamped steps, with timelines (entry window, results day).
4. **Eligibility check:** a three-question quick check (country of birth, education or work, passport).
5. **Free photo check:** upload, get instant feedback. A lead magnet that uses the photo analyzer.
6. **Trust and FAQ:** what we do and don't do, scam warning, privacy, refund policy.
7. **Start or continue:** begin a new application or resume with a code.

### Applicant flow
8. **Multi-step form:** profile, birth, eligibility country, contact and address, education, marital status,
   spouse, children. Save and resume; progress shown as the journey line.
9. **Photos:** per person, with the analyzer's live checklist (size, face position, background, lighting).
10. **Review and consent:** a document-style summary, with an edit link per section.
11. **Service payment:** the selected package, in ETB (Telebirr / CBE / card). Not built in the backend yet.
12. **Status tracker:** submitted, confirmation number, and a results-day reminder ("Check on May …").

### Referral partners
13. Partner landing ("You introduce. We support.")
14. Partner registration
15. Introduce someone new
16. Fill the form together (partner-assisted)
17. Register a completed applicant
18. Referral received (confirmation with a reference)
19. Partner overview (referrals, statuses, earnings)

### Staff app (redesign of what exists)
20. Login
21. Case queue (filters by status and package, search)
22. Case workspace (data, photos and analyzer results, card, confirmation)
23. Audit log

### Shared
404 and error pages, empty states, loading states, email and SMS templates.

## Backend reality check

Built today: staff login, cases, photos, Bitnob card, submission.

Not built yet, and needed before the public pages are live:
- Applicant accounts and save-and-resume.
- Service-fee payments in ETB.
- Referral partners and attribution.
- Staff roles and multiple logins.
- Results-day reminders.

The designs can come first. Each page states which backend piece it depends on.

## Process

1. **Design system and landing:** a Claude Design artifact. Review and iterate until it feels right.
2. **Applicant flow:** form, photos, review, payment, status.
3. **Referral partner flow.**
4. **Staff app redesign.**
5. **Build:** implement the approved designs page by page, with the backend pieces each one needs.

## Open decisions

- Brand name: "DV Assist", "Ethio DV Assist", or something new?
- Languages: English and Amharic side by side? Also Afaan Oromo or Tigrinya?
- Packages and prices: still 500 / 1,500 / 2,000 / 3,000 ETB?
- Service-fee payment methods: Telebirr, CBE Birr, bank transfer, card?
- Photography or illustration? Real Ethiopian faces (licensed or our own shoot) or illustrated people?
