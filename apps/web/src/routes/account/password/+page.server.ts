import { error, fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { getAuth } from '#lib/server/auth.js';
import { readCredentialForm } from '#lib/server/credential-form.js';
import { allowSignIn, reserveCredentialCheck } from '#lib/server/signin-limit.js';
import { getTrustedClientAddress, hasTrustedTransport } from '#lib/server/trusted-transport.js';
import type { Actions, PageServerLoad } from './$types';

const transportError = 'Use the trusted HTTPS address to change your password.';

export const load: PageServerLoad = (event) => {
  if (!hasTrustedTransport(event)) error(403, transportError);
};

export const actions: Actions = {
  default: async (event) => {
    const { request, locals, setHeaders } = event;
    const actorId = locals.auditActor?.id;
    if (!actorId) error(403, 'Sign in to change your password.');
    if (!hasTrustedTransport(event)) return fail(403, { message: transportError });
    const allowAttempt = allowSignIn(getTrustedClientAddress(event));
    if (!allowAttempt?.(`password:${actorId}`)) {
      setHeaders({ 'retry-after': '60' });
      return fail(429, { message: 'Too many attempts. Try again later.' });
    }
    const form = await readCredentialForm(request);
    if ('status' in form) return fail(form.status, { message: 'Invalid password change request.' });
    const currentPassword = form.fields.get('currentPassword');
    const newPassword = form.fields.get('newPassword');
    if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 128) {
      return fail(400, { message: 'Enter your current password.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
      return fail(400, {
        message: 'Use a new password between 12 and 128 characters.',
      });
    }
    if (newPassword !== form.fields.get('confirmPassword')) {
      return fail(400, { message: 'The new passwords do not match.' });
    }
    if (newPassword === currentPassword)
      return fail(400, { message: 'Choose a different password.' });

    const release = reserveCredentialCheck();
    if (!release) {
      setHeaders({ 'retry-after': '1' });
      return fail(429, { message: 'Too many attempts. Try again later.' });
    }
    try {
      await getAuth().api.changePassword({
        headers: request.headers,
        body: { currentPassword, newPassword, revokeOtherSessions: true },
      });
    } catch (cause) {
      if (cause instanceof APIError && cause.body?.code === 'INVALID_PASSWORD') {
        return fail(400, { message: 'The current password is incorrect.' });
      }
      if (cause instanceof APIError && cause.statusCode === 401) {
        return fail(401, {
          message: 'Your session expired. Sign in again and retry.',
        });
      }
      throw cause;
    } finally {
      release();
    }
    return {
      success: 'Password changed. Other sessions have been signed out.',
    };
  },
};
