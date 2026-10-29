// Prints the secret environment variables for a new deployment.
// Usage: npm run setup-secrets   (then type the operator password)

import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../src/infra/crypto.js';

const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = await rl.question('Operator password (min 12 characters): ');
rl.close();

if (password.length < 12) {
  console.error('Password too short.');
  process.exit(1);
}

console.log(`ADMIN_PASSWORD_HASH=${await hashPassword(password)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString('base64url')}`);
console.log(`DATA_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
console.error('\nStore DATA_ENCRYPTION_KEY somewhere safe: without it the stored data cannot be read.');
