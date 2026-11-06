import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryError, afroMessageSms, brevoEmail } from '../src/infra/messaging.js';
import { applicantInput, ctxFor, fakeChannel, fakeJpeg, fakePassport, seedStaff, setupCases } from './helpers.js';

const ctx = { ip: '203.0.113.5' };
const start = (env, overrides = {}) =>
  env.applications.start({ package: 'managed', applicant: applicantInput({ phone: '0911 234 567', ...overrides }) }, ctx);

test('without a provider, messages wait for staff to send by hand, then their text is erased', async () => {
  const env = await setupCases();
  const { meron } = await seedStaff(env);
  const { resumeCode } = await start(env);
  await env.notifications.deliverDue();

  const [m] = await env.notifications.toSend();
  assert.equal(m.template, 'resume_code');
  assert.equal(m.to.phone, '+251911234567');
  assert.ok(m.text.includes(resumeCode) && m.text.includes('https://dv.example/apply#resume'));
  assert.ok(m.text.includes('ኮድዎ'));

  // Stored encrypted, and erased once handled.
  const raw = (await env.db.execute('SELECT content FROM messages')).rows[0].content;
  assert.ok(!Buffer.from(raw).toString('latin1').includes(resumeCode));
  await env.notifications.markSent(m.id, ctxFor(meron));
  assert.deepEqual(await env.notifications.toSend(), []);
  assert.equal((await env.db.execute('SELECT content FROM messages')).rows[0].content, null);
  const [recent] = await env.notifications.recent();
  assert.equal(recent.doneBy, 'Meron');
});

test('sends by SMS to Ethiopian mobiles, by email otherwise, through the whole entry', async () => {
  const sms = fakeChannel('sms');
  const email = fakeChannel('email');
  const env = await setupCases({ sms, email });
  const { admin, meron } = await seedStaff(env);

  const { caseId } = await start(env);
  await start(env, { phone: '+1 202 555 0100', email: 'abroad@example.com' });
  await env.notifications.deliverDue();
  assert.equal(sms.sent.length, 1);
  assert.equal(sms.sent[0].to, '+251911234567');
  assert.equal(email.sent.length, 1);
  assert.equal(email.sent[0].to, 'abroad@example.com');
  assert.match(email.sent[0].subject, /EDA-0002 is saved/);

  await env.applications.savePhoto(caseId, 'applicant', fakeJpeg(), ctx);
  await env.applications.saveDocument(caseId, 'passport', fakePassport(), ctx);
  await env.applications.send(caseId, ctx);
  await env.cases.check(caseId, ctxFor(meron));
  await env.cases.verify(caseId, ctxFor(admin));
  await env.applications.approve(caseId, { confirm: true }, ctx);
  await env.cases.issueCard(caseId, ctxFor(admin));
  await env.cases.submit(caseId, '2028ABCD1234EFGH', ctxFor(admin));
  await env.notifications.deliverDue();

  const texts = sms.sent.map((m) => m.text);
  assert.equal(texts.length, 4);
  assert.match(texts[1], /we received entry EDA-0001/);
  assert.match(texts[2], /approve it with your code/);
  assert.match(texts[3], /Confirmation number: 2028ABCD1234EFGH/);
  const activity = await env.cases.activity(caseId);
  assert.ok(activity.some((a) => a.action === 'message_sent:submitted' && a.detail === 'sms'));
});

test('retries failed deliveries with backoff, then hands them to staff', async () => {
  const sms = fakeChannel('sms');
  const env = await setupCases({ sms });
  await start(env, { email: 'x@example.com' });

  sms.fail = 1;
  await env.notifications.deliverDue();
  assert.equal(sms.sent.length, 0);
  await env.notifications.deliverDue(); // not due yet
  assert.equal(sms.fail, 0);
  assert.equal(sms.sent.length, 0);
  env.advanceClock(61_000);
  await env.notifications.deliverDue();
  assert.equal(sms.sent.length, 1);

  await start(env);
  sms.fail = 10;
  for (let i = 0; i < 5; i++) {
    await env.notifications.deliverDue();
    env.advanceClock(3 * 60 * 60_000);
  }
  const [failed] = await env.notifications.toSend();
  assert.equal(failed.status, 'failed');
  assert.match(failed.lastError, /sms is down/);
});

test('partner invitations go by SMS when possible; otherwise the partner sends them', async () => {
  for (const withSms of [false, true]) {
    const sms = withSms ? fakeChannel('sms') : null;
    const env = await setupCases({ sms });
    const { admin } = await seedStaff(env);
    await env.partners.apply({ name: 'Tigist', organisation: 'Haile Cafe', type: 'shop', phone: '0911000000', city: 'Adama', payoutPhone: '0911000000', agree: true }, ctx);
    const [p] = await env.partners.list(ctxFor(admin));
    const { code } = await env.partners.issueCode(p.id, ctxFor(admin));
    const partner = await env.partners.activeById(await env.partners.signIn(code));
    const invite = await env.partners.introduce(partner, { name: 'Meseret B', phone: '0922000111', people: 1, package: 'self', consent: true }, ctx);
    assert.equal(invite.sentBySms, withSms);
    await env.notifications.deliverDue();
    const manual = await env.notifications.toSend();
    if (withSms) {
      assert.deepEqual(sms.sent.map((m) => m.to), ['+251911000000', '+251922000111']);
      assert.ok(sms.sent[1].text.includes(`https://dv.example/i/${invite.reference}`));
      assert.equal(manual.length, 0);
    } else {
      // The approval message waits for staff; the invitation does not (the partner has it to send).
      assert.deepEqual(manual.map((m) => m.template), ['partner_approved']);
    }
  }
});

test('the AfroMessage and Brevo adapters report failures', async () => {
  const calls = [];
  const fakeFetch = (reply) => async (url, init) => {
    calls.push({ url, init });
    return { ok: reply.status < 300, status: reply.status, json: async () => reply.body };
  };
  const ok = afroMessageSms({ token: 't', identifierId: 'id1', senderName: 'EDVA', fetchImpl: fakeFetch({ status: 200, body: { acknowledge: 'success' } }) });
  await ok.send({ to: '+251911234567', text: 'hi' });
  assert.equal(calls[0].url, 'https://api.afromessage.com/api/send');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer t');
  assert.deepEqual(JSON.parse(calls[0].init.body), { to: '+251911234567', message: 'hi', from: 'id1', sender: 'EDVA' });

  const refused = afroMessageSms({ token: 't', fetchImpl: fakeFetch({ status: 200, body: { acknowledge: 'error', response: { errors: ['Insufficient balance'] } } }) });
  await assert.rejects(refused.send({ to: '+251911234567', text: 'hi' }), (err) => err instanceof DeliveryError && /Insufficient balance/.test(err.message));

  const mail = brevoEmail({ apiKey: 'k', fromEmail: 'hi@example.com', fetchImpl: fakeFetch({ status: 400, body: { message: 'sender not verified' } }) });
  await assert.rejects(mail.send({ to: 'a@example.com', subject: 's', text: 't' }), /sender not verified/);
  assert.equal(calls.at(-1).init.headers['api-key'], 'k');
});
