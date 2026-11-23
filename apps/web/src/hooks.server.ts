import { building } from '$app/env';
import { resolve as resolvePath } from '$app/paths';
import { redirect, type Handle } from '@sveltejs/kit';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { getAuth } from '#lib/server/auth.js';

const controllerRoutes = [
  '/api/internal/controller/check-in',
  '/api/internal/controller/enroll',
  '/api/internal/controller/heartbeat',
  '/api/internal/controller/invite',
  '/api/internal/controller/revoke'
];

export const handle: Handle = ({ event, resolve }) => {
  event.locals.user = null;
  if (building || (event.route.id && controllerRoutes.includes(event.route.id))) return resolve(event);

  const auth = getAuth();
  return svelteKitHandler({
    event,
    auth,
    building,
    resolve: async (event) => {
      const { id } = event.route;
      if (!id) return resolve(event);

      const session = await auth.api.getSession({ headers: event.request.headers });
      const user = session?.user;
      event.locals.user = user
        ? { name: user.name, email: user.email, username: user.displayUsername ?? user.username, image: user.image }
        : null;

      if (id === '/signin') {
        if (user) redirect(303, resolvePath('/'));
      } else if (!user) {
        redirect(303, resolvePath('/signin'));
      }
      return resolve(event);
    }
  });
};
