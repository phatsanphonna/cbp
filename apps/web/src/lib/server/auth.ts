import { getRequestEvent } from '$app/server';
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL } from '$app/env/private';
import { betterAuth } from 'better-auth';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { authOptions } from './auth-options.js';
import { getDatabase } from './database.js';

function createAuth() {
  const { options } = authOptions(true, { BETTER_AUTH_SECRET, BETTER_AUTH_URL }, getDatabase());
  return betterAuth({
    ...options,
    plugins: [...options.plugins, sveltekitCookies(getRequestEvent)]
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  return (auth ??= createAuth());
}
