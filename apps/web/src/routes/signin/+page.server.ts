import { error, fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { findAuthUserId } from '@cbp/database/auth-schema';
import { APIError } from 'better-auth/api';
import { getAuth } from '#lib/server/auth.js';
import { getDatabase } from '#lib/server/database.js';
import { allowAccountSignIn, allowSignIn, reserveCredentialCheck } from '#lib/server/signin-limit.js';
import { readCredentialForm } from '#lib/server/credential-form.js';
import { getTrustedClientAddress, hasTrustedTransport } from '#lib/server/trusted-transport.js';
import type { Actions, PageServerLoad } from './$types';

const greetings = [
  { lang: 'th', text: 'สวัสดี' },
  { lang: 'ja', text: 'こんにちは' },
  { lang: 'ar', text: 'مرحبًا' },
  { lang: 'ko', text: '안녕하세요' },
  { lang: 'hi', text: 'नमस्ते' },
  { lang: 'zh', text: '你好' },
  { lang: 'el', text: 'Γεια σου' },
  { lang: 'he', text: 'שלום' }
];

const transportError = 'Use the trusted HTTPS address to sign in.';

export const load: PageServerLoad = (event) => {
  if (!hasTrustedTransport(event)) error(403, transportError);
  const { cookies } = event;
  const previous = Number(cookies.get('cbp-greeting'));
  const index = Number.isInteger(previous) && previous >= 0 && previous < greetings.length
    ? (previous + 1) % greetings.length
    : 0;

  cookies.set('cbp-greeting', String(index), { path: '/', httpOnly: true, sameSite: 'lax' });
  return { greeting: greetings[index] };
};

export const actions: Actions = {
  default: async (event) => {
    const { request, locals, setHeaders } = event;
    if (!hasTrustedTransport(event)) return fail(403, { message: transportError });
    const throttled = (retryAfter = '60') => {
      setHeaders({ 'retry-after': retryAfter });
      return fail(429, { message: 'Too many sign-in attempts. Try again later.' });
    };
    const allowLogin = allowSignIn(getTrustedClientAddress(event));
    if (!allowLogin) return throttled();

    const form = await readCredentialForm(request);
    if ('status' in form) return fail(form.status, { message: 'Invalid sign-in request.' });
    const { fields } = form;
    const identifier = fields.get('identifier');
    const password = fields.get('password');
    if (typeof identifier !== 'string' || identifier.length > 254 || typeof password !== 'string' ||
        !identifier.trim() || !password || password.length > 128) {
      return fail(400, { message: 'Enter your username or email and your password.' });
    }

    const login = identifier.trim().toLowerCase();
    if (!allowLogin(login)) return throttled();
    const release = reserveCredentialCheck();
    if (!release) return throttled('1');

    try {
      const accountId = await findAuthUserId(getDatabase(), login);
      const clearAttempts = allowAccountSignIn(accountId, login);
      if (!clearAttempts) return throttled();
      const { api } = getAuth();
      const { user } = login.includes('@')
        ? await api.signInEmail({ headers: request.headers, body: { email: login, password } })
        : await api.signInUsername({ headers: request.headers, body: { username: login, password } });
      clearAttempts();
      locals.auditActor = { id: user.id, name: user.name };
    } catch (error) {
      if (error instanceof APIError && [400, 401, 403].includes(error.statusCode)) {
        return fail(400, { message: 'Username, email, or password is incorrect.' });
      }
      if (error instanceof APIError && error.statusCode === 429) {
        return fail(429, { message: 'Too many sign-in attempts. Try again later.' });
      }
      throw error;
    } finally {
      release();
    }
    redirect(303, resolve('/'));
  }
};
