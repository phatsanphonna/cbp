import { env } from 'node:process';
import { openDatabase } from '@cbp/database';
import * as schema from '@cbp/database/auth-schema';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { username } from 'better-auth/plugins';

export function authOptions(
  disableSignUp = true,
  settings: { BETTER_AUTH_SECRET?: string; BETTER_AUTH_URL?: string } = env,
  database?: ReturnType<typeof openDatabase>,
) {
  const secret = settings.BETTER_AUTH_SECRET;
  const baseURL = settings.BETTER_AUTH_URL;
  if (!secret || secret.length < 32 || !baseURL) {
    throw new Error('Set BETTER_AUTH_URL and a BETTER_AUTH_SECRET of at least 32 characters');
  }

  database ??= openDatabase();
  return {
    database,
    options: {
      secret,
      baseURL,
      database: drizzleAdapter(database, {
        provider: 'pg',
        schema,
        transaction: true,
      }),
      emailAndPassword: { enabled: true, disableSignUp },
      // Sessions can download private keys, so expire after 12 hours instead of the 7-day default.
      session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
      plugins: [username()],
    },
  };
}
