// Staff accounts: sign-in (password + authenticator code), authenticator setup, and team management.

import { randomUUID } from 'node:crypto';
import { ValidationError } from '../domain/case.js';
import { hashPassword, verifyPassword } from '../infra/crypto.js';
import { newTotpSecret, otpauthUrl, verifyTotp } from '../infra/totp.js';

export const ROLES = ['admin', 'staff'];

export class AuthError extends Error {}
export class ForbiddenError extends Error {}

const publicStaff = ({ id, email, name, role, active, totpSecret }) =>
  ({ id, email, name, role, active, hasAuthenticator: Boolean(totpSecret) });

function validateNew({ email, name, role, password }) {
  const errors = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '')) errors.push('Email is invalid');
  if (!(name ?? '').trim()) errors.push('Name is required');
  if (!ROLES.includes(role)) errors.push('Role is invalid');
  if (typeof password !== 'string' || password.length < 12) errors.push('Password must be at least 12 characters');
  if (errors.length) throw new ValidationError(errors);
}

export function staffService({ repo, audit }) {
  const record = (action, ctx, detail = null) =>
    audit.record({ action, ip: ctx?.ip, staffId: ctx?.staff?.id, detail });

  const requireAdmin = (ctx) => {
    if (ctx?.staff?.role !== 'admin') throw new ForbiddenError('Admins only');
  };

  return {
    // Creates the first admin from configuration when no staff exist yet.
    async bootstrap({ email, passwordHash }) {
      if (!email || !passwordHash || (await repo.count()) > 0) return false;
      await repo.insert({ id: randomUUID(), email: email.toLowerCase(), name: 'Administrator', role: 'admin', passwordHash });
      return true;
    },

    async activeById(id) {
      const staff = await repo.byId(id);
      return staff?.active ? staff : null;
    },

    // Returns { staff, needsAuthenticator }. Staff without an authenticator yet must set one up next.
    async signIn({ email, password, code }, ctx) {
      const staff = await repo.byEmail(String(email ?? '').trim().toLowerCase());
      const passwordOk = staff ? await verifyPassword(password, staff.passwordHash) : false;
      const codeOk = !staff?.totpSecret || verifyTotp(staff.totpSecret, code);
      if (!staff || !staff.active || !passwordOk || !codeOk) {
        await audit.record({ action: 'login_failed', ip: ctx?.ip, staffId: staff?.id ?? null });
        throw new AuthError('Email, password or code is wrong');
      }
      await audit.record({ action: 'login', ip: ctx?.ip, staffId: staff.id });
      return { staff: publicStaff(staff), needsAuthenticator: !staff.totpSecret };
    },

    // The secret stays with the client until a code proves the app was set up correctly.
    beginAuthenticator(ctx) {
      const secret = newTotpSecret();
      return { secret, url: otpauthUrl(secret, ctx.staff.email) };
    },

    async confirmAuthenticator({ secret, code }, ctx) {
      if (!/^[A-Z2-7]{32}$/.test(secret ?? '') || !verifyTotp(secret, code)) {
        throw new ValidationError(['That code does not match. Check the time on your phone and try again.']);
      }
      await repo.setTotp(ctx.staff.id, secret);
      await record('authenticator_set', ctx);
    },

    me: (ctx) => publicStaff(ctx.staff),

    // Names of active staff, for assignment pickers. Visible to every signed-in staff member.
    async directory() {
      return (await repo.list()).filter((m) => m.active).map(({ id, name }) => ({ id, name }));
    },

    async list(ctx) {
      requireAdmin(ctx);
      return (await repo.list()).map(publicStaff);
    },

    async create(input, ctx) {
      requireAdmin(ctx);
      const email = String(input.email ?? '').trim().toLowerCase();
      validateNew({ ...input, email });
      if (await repo.byEmail(email)) throw new ValidationError(['Someone with that email already exists']);
      const id = randomUUID();
      await repo.insert({ id, email, name: input.name.trim(), role: input.role, passwordHash: await hashPassword(input.password) });
      await record('staff_created', ctx, email);
      return publicStaff(await repo.byId(id));
    },

    async update(id, { role, active, password, resetAuthenticator }, ctx) {
      requireAdmin(ctx);
      const target = await repo.byId(id);
      if (!target) throw new ValidationError(['No such staff member']);
      if (id === ctx.staff.id && (active === false || (role && role !== 'admin'))) {
        throw new ValidationError(['You cannot deactivate or demote yourself']);
      }
      if (role !== undefined && !ROLES.includes(role)) throw new ValidationError(['Role is invalid']);
      if (password !== undefined && (typeof password !== 'string' || password.length < 12)) {
        throw new ValidationError(['Password must be at least 12 characters']);
      }
      await repo.update(id, {
        role, active, passwordHash: password === undefined ? undefined : await hashPassword(password),
      });
      if (resetAuthenticator) await repo.setTotp(id, null);
      await record('staff_updated', ctx, target.email);
      return publicStaff(await repo.byId(id));
    },
  };
}
