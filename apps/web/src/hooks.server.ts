import { building, dev } from '$app/env';
import { resolve as resolvePath } from '$app/paths';
import { reconcileAlerts } from '@cbp/database/alerts';
import { expireDeploymentJobs } from '@cbp/database/deployment-jobs';
import { error, redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { auditUserAction } from '#lib/server/audit-action.js';
import { deliverAlertNotifications } from '#lib/server/alert-notifications.js';
import { getAuth, isAdminEmail } from '#lib/server/auth.js';
import { getDatabase } from '#lib/server/database.js';
import { cleanupDeploymentSecrets } from '#lib/server/deployment-secrets.js';
import { canWriteRouteAction, hasPermission } from '#lib/server/access-control.js';
import { listUserPermissions } from '@cbp/database/access-control';
import {
  renewalAvailable,
  renewDueCertificate,
  selfSignedRenewalAvailable,
} from '#lib/server/lets-encrypt.js';
import { isDirectHttps } from '#lib/server/trusted-transport.js';

const controllerRoutes = [
  '/api/internal/controller/check-in',
  '/api/internal/controller/deployment-claim',
  '/api/internal/controller/deployment-log',
  '/api/internal/controller/deployment-result',
  '/api/internal/controller/enroll',
  '/api/internal/controller/heartbeat',
  '/api/internal/controller/invite',
  '/api/internal/controller/probe-hosts',
  '/api/internal/controller/probe-results',
  '/api/internal/controller/revoke',
  '/api/internal/controller/unregister',
];

const live = globalThis as typeof globalThis & {
  cbpTimers?: Record<string, ReturnType<typeof setInterval>>;
};
const timers = new Map<string, ReturnType<typeof setInterval>>();
const logCause = (message: string) => (failure: unknown) =>
  console.error(message, failure instanceof Error ? (failure.cause ?? failure) : failure);
const log = (message: string) => () => console.error(message);

// Runs a task now and every ms, skipping a tick while the previous run is still going.
function every(name: string, ms: number, task: () => Promise<unknown>) {
  // Vite can replace the hooks module while the previous interval is still running.
  clearInterval(live.cbpTimers?.[name]);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch {
      console.error(`Background task ${name} failed`);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, ms);
  timer.unref();
  timers.set(name, timer);
  (live.cbpTimers ??= {})[name] = timer;
}

export function init() {
  if (building || timers.size) return;
  every('expiry', 10_000, () =>
    expireDeploymentJobs(getDatabase()).catch(
      logCause('Could not clear expired certificate deployment jobs'),
    ),
  );
  every('alerts', 60_000, async () => {
    await reconcileAlerts(getDatabase()).catch(logCause('Could not reconcile alerts'));
    await deliverAlertNotifications(getDatabase()).catch(
      log('Could not process alert notifications'),
    );
    await cleanupDeploymentSecrets().catch(log('Could not clean up Vault deployment secrets'));
  });
  if (renewalAvailable || selfSignedRenewalAvailable)
    every('renewal', 60_000, () =>
      renewDueCertificate().catch(log('Could not process the certificate renewal queue')),
    );
}

import.meta.hot?.dispose(() => {
  for (const [name, timer] of timers) {
    clearInterval(timer);
    if (live.cbpTimers?.[name] === timer) delete live.cbpTimers[name];
  }
  timers.clear();
});

// Block framing (clickjacking) and sniffing on every response, including API routes.
const securityHeaders = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};

export const handle: Handle = async (input) => {
  const response = await handleRequest(input);
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  // Pages get the full policy from kit.csp in vite.config.ts; keep frame blocking on the rest.
  if (!response.headers.has('content-security-policy'))
    response.headers.set('content-security-policy', "frame-ancestors 'none'");
  if (input.event.url.protocol === 'https:')
    response.headers.set('strict-transport-security', 'max-age=31536000');
  return response;
};

const handleRequest: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  const { id } = event.route;
  if (building || !id) return resolve(event);
  if (controllerRoutes.includes(id)) {
    if (isDirectHttps(event)) error(404, 'Not found');
    return resolve(event);
  }
  if (id === '/api/internal/ansible') return resolve(event);
  if (id === '/[x+2e]well-known/acme-challenge/[token]') return resolve(event);

  const session = await getAuth().api.getSession({
    headers: event.request.headers,
  });
  const user = session?.user;
  if (user) event.locals.auditActor = { id: user.id, name: user.name };
  const isAdmin = user ? isAdminEmail(user.email) : false;
  event.locals.user = user
    ? {
        name: user.name,
        email: user.email,
        username: user.displayUsername ?? user.username,
        image: user.image,
        isAdmin,
        permissions: isAdmin ? [] : await listUserPermissions(getDatabase(), user.id),
      }
    : null;

  if (id === '/signin') {
    if (user) redirect(303, resolvePath('/'));
  } else if (!user) {
    redirect(303, resolvePath('/signin'));
  }
  return auditUserAction(event, () => {
    if (id === '/users') {
      if (
        !hasPermission(event.locals.user, 'users.manage') &&
        !hasPermission(event.locals.user, 'groups.manage') &&
        !hasPermission(event.locals.user, 'permissions.manage')
      )
        error(403, 'User, group, or permission management access is required.');
    } else if (id.startsWith('/users/')) {
      if (!hasPermission(event.locals.user, 'users.manage'))
        error(403, 'User management permission is required.');
    }
    if (
      id === '/groups' &&
      !hasPermission(event.locals.user, 'groups.manage') &&
      !hasPermission(event.locals.user, 'permissions.manage')
    ) {
      error(403, 'Group or permission management access is required.');
    }
    if (id === '/hosts/new' && !hasPermission(event.locals.user, 'hosts.manage')) {
      error(403, 'Host management permission is required.');
    }
    if (id === '/certificates/new' && !hasPermission(event.locals.user, 'certificates.manage')) {
      error(403, 'Certificate management permission is required.');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
      const action =
        [...event.url.searchParams.keys()].find((key) => key.startsWith('/'))?.slice(1) ??
        'default';
      if (!canWriteRouteAction(event.locals.user, id, action) && event.locals.user) {
        error(403, 'Your account does not have permission to make this change.');
      }
      if (!event.locals.user && !['/signin'].includes(id)) {
        error(403, 'Sign in to make this change.');
      }
    }
    return resolve(event);
  });
};

export const handleError: HandleServerError = ({ error: cause, event, kind }) => {
  if (!event.route.id?.startsWith('/deployments')) return;

  const status = kind === 'unknown' ? 500 : cause.status;
  console.error(`Deployment page failed with HTTP ${status}`, cause);
  if (dev && kind === 'unknown' && cause instanceof Error) {
    return { message: cause.message };
  }
};
