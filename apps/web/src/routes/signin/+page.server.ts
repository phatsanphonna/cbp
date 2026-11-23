import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { APIError } from 'better-auth/api';
import { getAuth } from '#lib/server/auth.js';
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

export const load: PageServerLoad = ({ cookies }) => {
  const previous = Number(cookies.get('cbp-greeting'));
  const index = Number.isInteger(previous) && previous >= 0 && previous < greetings.length
    ? (previous + 1) % greetings.length
    : 0;

  cookies.set('cbp-greeting', String(index), { path: '/', httpOnly: true, sameSite: 'lax' });
  return { greeting: greetings[index] };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const fields = await request.formData();
    const identifier = fields.get('identifier');
    const password = fields.get('password');
    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
      return fail(400, { message: 'Enter your username or email and your password.' });
    }

    try {
      const login = identifier.trim().toLowerCase();
      const { api } = getAuth();
      const { user } = login.includes('@')
        ? await api.signInEmail({ headers: request.headers, body: { email: login, password } })
        : await api.signInUsername({ headers: request.headers, body: { username: login, password } });
      locals.auditActor = { id: user.id, name: user.name };
    } catch (error) {
      if (error instanceof APIError && [400, 401, 403].includes(error.statusCode)) {
        return fail(400, { message: 'Username, email, or password is incorrect.' });
      }
      if (error instanceof APIError && error.statusCode === 429) {
        return fail(429, { message: 'Too many sign-in attempts. Try again later.' });
      }
      throw error;
    }
    redirect(303, resolve('/'));
  }
};
