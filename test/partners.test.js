import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, refCodePrefix } from '../src/domain/partner.js';
import { applicantInput, ctxFor, fakeJpeg, fakePassport, seedStaff, setupCases } from './helpers.js';

const ctx = { ip: '203.0.113.7' };
const application = (overrides = {}) => ({
  name: 'Tigist Haile', organisation: 'Haile Internet Café', type: 'shop', phone: '0911 234 567',
  city: 'Addis Ababa', payoutPhone: '+251 911 234 567', agree: true, ...overrides,
});
const introduction = (overrides = {}) => ({
  name: 'Meseret Bekele', phone: '0922 000 111', people: 3, package: 'managed', note: 'Free after 5 pm', consent: true, ...overrides,
});

test('normalizes Ethiopian phone numbers and builds referral codes', () => {
  assert.equal(normalizePhone('0911 234 567'), '+251911234567');
  assert.equal(normalizePhone('+251-711-234-567'), '+251711234567');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(refCodePrefix('Haile Internet Café'), 'HAILE');
  assert.equal(refCodePrefix('ሰላም ሱቅ'), 'P');
});

async function activePartner(env, admin) {
  await env.partners.apply(application(), ctx);
  const [pending] = await env.partners.list(ctxFor(admin));
  const { code } = await env.partners.issueCode(pending.id, ctxFor(admin));
  return { partner: await env.partners.activeById(await env.partners.signIn(code)), code };
}

test('a partner applies, is approved by an admin, and signs in with a code', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);

  await assert.rejects(env.partners.apply(application({ phone: '123', agree: false }), ctx), /Ethiopian mobile.*Agree/s);
  await env.partners.apply(application(), ctx);
  await assert.rejects(env.partners.list(ctxFor(meron)), /Admins only/);
  const [pending] = await env.partners.list(ctxFor(admin));
  assert.equal(pending.status, 'pending');
  assert.equal(pending.phone, '+251911234567');
  assert.match(pending.refCode, /^HAILE[A-Z2-9]{2}$/);

  const { code } = await env.partners.issueCode(pending.id, ctxFor(admin));
  const id = await env.partners.signIn(code.toLowerCase());
  assert.equal(id, pending.id);
  assert.equal(await env.partners.signIn('AAAA-AAAA-AAAA'), null);

  // Contact details are encrypted at rest.
  const { rows } = await env.db.execute('SELECT details FROM partners');
  assert.ok(!Buffer.from(rows[0].details).toString('latin1').includes('Tigist'));

  // Suspended partners cannot sign in; a reset code replaces the old one.
  await env.partners.setStatus(id, 'suspended', ctxFor(admin));
  assert.equal(await env.partners.signIn(code), null);
  await env.partners.setStatus(id, 'active', ctxFor(admin));
  const { code: second } = await env.partners.issueCode(id, ctxFor(admin));
  assert.equal(await env.partners.signIn(code), null);
  assert.equal(await env.partners.signIn(second), id);
});

test('referrals: introductions, referral links and filling together, followed to submission', async () => {
  const env = await setupCases();
  const { admin, meron } = await seedStaff(env);
  const { partner } = await activePartner(env, admin);

  await assert.rejects(env.partners.introduce(partner, introduction({ consent: false }), ctx), /asked you to share/);
  const invite = await env.partners.introduce(partner, introduction(), ctx);
  assert.match(invite.reference, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(invite.firstName, 'Meseret');
  assert.deepEqual(await env.partners.referrer({ invite: invite.reference.toLowerCase() }),
    { organisation: 'Haile Internet Café', package: 'managed', firstName: 'Meseret' });
  assert.equal(await env.partners.referrer({ ref: 'NOPE99' }), null);

  let board = await env.partners.dashboard(partner);
  assert.deepEqual(board.counts, { introduced: 1, inProgress: 0, submitted: 0 });
  assert.equal(board.referrals[0].stage, 'invited');

  // The invitee starts with their link; someone else uses the partner's own link; a third is filled
  // together, which only counts when the partner is signed in on that device.
  const viaInvite = await env.applications.start({ package: 'managed', applicant: applicantInput(), invite: invite.reference }, ctx);
  await env.applications.start({ package: 'self', applicant: applicantInput({ firstName: 'Hanna' }), ref: partner.refCode }, ctx);
  const claimed = await env.applications.start({ package: 'vip', applicant: applicantInput({ firstName: 'Fake' }), ref: partner.refCode, together: true }, ctx);
  assert.equal(claimed.together, false);
  const together = await env.applications.start({ package: 'assisted', applicant: applicantInput({ firstName: 'Dawit' }), ref: partner.refCode, together: true }, { ...ctx, partnerId: partner.id });
  assert.equal(together.together, true);

  board = await env.partners.dashboard(partner);
  assert.deepEqual(board.counts, { introduced: 4, inProgress: 4, submitted: 0 });
  assert.deepEqual(board.referrals.map((r) => r.how).sort(), ['introduced', 'link', 'link', 'together']);
  // Partners see names, packages and stages, never the entry's details.
  assert.ok(!JSON.stringify(board).includes('kebede@example.com'));

  // Staff see who referred the entry.
  const id = viaInvite.caseId;
  await env.applications.savePhoto(id, 'applicant', fakeJpeg(), ctx);
  await env.applications.saveDocument(id, 'passport', fakePassport(), ctx);
  await env.applications.send(id, ctx);
  assert.equal((await env.cases.list()).cases[0].partner, 'Haile Internet Café');
  await env.cases.check(id, ctxFor(meron));
  await env.cases.verify(id, ctxFor(admin));
  await env.applications.approve(id, { confirm: true }, ctx);
  await env.cases.issueCard(id, ctxFor(admin));
  await env.cases.submit(id, '2028ABCD1234EFGH', ctxFor(admin));

  board = await env.partners.dashboard(partner);
  const submitted = board.referrals.find((r) => r.stage === 'submitted');
  assert.equal(submitted.earning, 200);
  assert.equal(board.earned, 200);

  // The team's follow-up list shows the introduction as started.
  const [intro] = await env.partners.introductions(ctxFor(admin));
  assert.equal(intro.started, true);
  assert.equal(intro.needsCall, false);
});

test('introductions nobody has started are flagged for a call after two days', async () => {
  const env = await setupCases();
  const { admin } = await seedStaff(env);
  const { partner } = await activePartner(env, admin);
  await env.partners.introduce(partner, introduction(), ctx);
  const later = Date.now() + 3 * 24 * 60 * 60 * 1000;
  const [intro] = await env.partners.introductions(ctxFor(admin), later);
  assert.equal(intro.needsCall, true);
  assert.equal(intro.phone, '+251922000111');
});
