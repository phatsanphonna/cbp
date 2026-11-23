import { resolve } from '$app/paths';
import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { createUser } from '#lib/server/auth.js';
import type { Actions } from './$types';

function textField(fields: FormData, name: string) {
  const value = fields.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export const actions: Actions = {
  default: async ({ request }) => {
    const fields = await request.formData();
    const name = textField(fields, 'name');
    const email = textField(fields, 'email').toLowerCase();
    const username = textField(fields, 'username');
    const password = fields.get('password');
    const values = { name: name.slice(0, 120), email: email.slice(0, 254), username: username.slice(0, 30) };

    if (!name || name.length > 120) {
      return fail(400, { message: 'Enter a name between 1 and 120 characters.', values });
    }
    if (!email || email.length > 254) {
      return fail(400, { message: 'Enter a valid email address.', values });
    }
    if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username)) {
      return fail(400, { message: 'Use 3 to 30 letters, numbers, underscores, or periods for the username.', values });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return fail(400, { message: 'Use a password between 8 and 128 characters.', values });
    }

    try {
      if (!await createUser({ name, email, username, password })) {
        return fail(409, { message: 'This email address is already in use.', values });
      }
    } catch (error) {
      if (error instanceof APIError) {
        if (error.body?.code === 'USERNAME_IS_ALREADY_TAKEN') {
          return fail(409, { message: 'This username is already in use.', values });
        }
        if (error.statusCode === 400) {
          return fail(400, { message: 'Check the email address, username, and password.', values });
        }
      }
      throw error;
    }

    redirect(303, `${resolve('/users')}?created=1`);
  }
};
