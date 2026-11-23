import { resolve } from '$app/paths';
import { listAuthUsers, removeAuthUser } from '@cbp/database/auth-schema';
import { error, fail, redirect } from '@sveltejs/kit';
import { isAdminEmail } from '#lib/server/auth.js';
import { getDatabase } from '#lib/server/database.js';
import { hasTrustedTransport } from '#lib/server/trusted-transport.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const users = await listAuthUsers(getDatabase());
  return {
    users: users.map(({ id, name, email, username, displayUsername }) => ({
      id,
      name,
      email,
      username: displayUsername ?? username,
      isAdmin: isAdminEmail(email),
      isCurrentUser: id === locals.auditActor?.id
    })),
    created: url.searchParams.get('created') === '1',
    removed: url.searchParams.get('removed') === '1'
  };
};

export const actions: Actions = {
  remove: async (event) => {
    const { request, locals } = event;
    const actorId = locals.auditActor?.id;
    if (!locals.user?.isAdmin || !actorId) error(403, 'An administrator account is required to remove users.');
    if (!hasTrustedTransport(event)) return fail(403, { message: 'Use the trusted HTTPS address to remove a user.' });
    const id = (await request.formData()).get('userId');
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      return fail(400, { message: 'Choose a valid user account.' });
    }
    locals.auditTargetId = id;
    const result = await removeAuthUser(getDatabase(), actorId, id);
    if (result === 'self') return fail(400, { message: 'You cannot remove your own account.' });
    if (result === 'missing') return fail(404, { message: 'That user account has already been removed.' });
    if (result === 'forbidden') error(403, 'Your account is no longer active.');
    redirect(303, `${resolve('/users')}?removed=1`);
  }
};
