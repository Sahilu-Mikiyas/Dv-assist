// What we tell applicants and partners, in English and Amharic. Kept short: Amharic SMS are billed per
// 70 characters. Pure functions only — no I/O.

const BRAND = 'Ethio DV Assist';

// Each template returns { subject, text }. `url` is the site's public address, e.g. https://example.com.
export const TEMPLATES = {
  resume_code: ({ code, resumeCode, url }) => ({
    subject: `Your entry ${code} is saved`,
    text: `${BRAND}: your entry ${code} is saved. Your code: ${resumeCode}. Keep it private. Continue: ${url}/apply#resume\n`
      + `ምዝገባዎ ተቀምጧል። ኮድዎ፦ ${resumeCode}። ለማንም አያጋሩ።`,
  }),
  received: ({ code }) => ({
    subject: `We received entry ${code}`,
    text: `${BRAND}: we received entry ${code} and are checking it. We will contact you if anything needs fixing.\n`
      + 'ምዝገባዎን ተቀብለናል፤ እያጣራን ነው።',
  }),
  approval_needed: ({ code, url }) => ({
    subject: `Please approve entry ${code}`,
    text: `${BRAND}: entry ${code} is checked. Please read it and approve it with your code: ${url}/apply#resume\n`
      + `ምዝገባዎ ተጣርቷል። እባክዎ አንብበው ያጽድቁ፦ ${url}/apply#resume`,
  }),
  submitted: ({ code, confirmationNumber }) => ({
    subject: `Entry ${code} is submitted`,
    text: `${BRAND}: your DV entry is submitted. Confirmation number: ${confirmationNumber}. Keep it private; you need it to check results on dvprogram.state.gov.\n`
      + `ምዝገባዎ ገብቷል። የማረጋገጫ ቁጥር፦ ${confirmationNumber}። በጥንቃቄ ያስቀምጡት።`,
  }),
  invitation: ({ firstName, organisation, reference, url, link = `${url}/i/${reference}` }) => ({
    subject: `${organisation} introduced you to ${BRAND}`,
    text: `Selam ${firstName}, ${organisation} introduced you to ${BRAND}. Start your DV entry here: ${link}\n`
      + `ሰላም ${firstName}፣ ${organisation} ከኢትዮ ዲቪ አሲስት ጋር አስተዋውቆዎታል። ምዝገባዎን እዚህ ይጀምሩ፦ ${link}`,
  }),
  partner_approved: ({ organisation, url }) => ({
    subject: 'Your partner account is approved',
    text: `${BRAND}: the partner account for ${organisation} is approved. Sign in at ${url}/partner/ with the code our team gives you.\n`
      + 'የአጋርነት ጥያቄዎ ጸድቋል።',
  }),
  payout_paid: ({ amountEtb, entries, reference, ending }) => ({
    subject: `Payout of ${amountEtb} ETB sent`,
    text: `${BRAND}: we sent ${amountEtb} ETB for ${entries} submitted ${entries === 1 ? 'entry' : 'entries'} to your Telebirr ending ${ending}. Transaction: ${reference}. Thank you!\n`
      + `${amountEtb} ብር ወደ ቴሌብርዎ ተልኳል። ቁጥር፦ ${reference}። እናመሰግናለን!`,
  }),
};

export const TEMPLATE_LABELS = {
  resume_code: 'Resume code',
  received: 'Entry received',
  approval_needed: 'Approval needed',
  submitted: 'Submitted + confirmation number',
  invitation: 'Partner invitation',
  partner_approved: 'Partner approved',
  payout_paid: 'Partner payout sent',
};

export function render(template, data) {
  const build = TEMPLATES[template];
  if (!build) throw new Error(`Unknown message template: ${template}`);
  return build(data);
}
