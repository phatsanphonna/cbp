import { getRequestEvent } from '$app/server';
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL, CBP_ADMIN_EMAILS } from '$app/env/private';
import { hasAuthUser } from '@cbp/database/auth-schema';
import { betterAuth } from 'better-auth';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { authOptions } from './auth-options.js';
import { getDatabase } from './database.js';

const adminEmails = new Set((CBP_ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));

export function isAdminEmail(email: string) {
  return adminEmails.has(email.toLowerCase());
}

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

function createProvisioningAuth() {
  const { options } = authOptions(false, { BETTER_AUTH_SECRET, BETTER_AUTH_URL }, getDatabase());
  return betterAuth({ ...options, emailAndPassword: { ...options.emailAndPassword, autoSignIn: false } });
}

let provisioningAuth: ReturnType<typeof createProvisioningAuth> | undefined;

export async function createUser(body: { name: string; email: string; username: string; password: string }) {
  const { api } = (provisioningAuth ??= createProvisioningAuth());
  const { user } = await api.signUpEmail({ body });
  // Better Auth can return a synthetic user for a duplicate email when autoSignIn is disabled.
  return hasAuthUser(getDatabase(), user.id);
}
