import { env } from 'node:process';
import { betterAuth } from 'better-auth';
import { authOptions } from '../src/lib/server/auth-options.js';

const name = env.CBP_USER_NAME?.trim();
const email = env.CBP_USER_EMAIL?.trim().toLowerCase();
const username = env.CBP_USER_USERNAME?.trim();
const password = env.CBP_USER_PASSWORD;
if (!name || !email || !username || !password) {
  throw new Error('Set CBP_USER_NAME, CBP_USER_EMAIL, CBP_USER_USERNAME and CBP_USER_PASSWORD before running this command');
}

const { database, options } = authOptions(false);
try {
  const auth = betterAuth(options);
  await auth.api.signUpEmail({ body: { name, email, username, password } });
  console.log('Local user created.');
} finally {
  await database.$client.close();
}
