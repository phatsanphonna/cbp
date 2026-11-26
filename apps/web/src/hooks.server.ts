import { building, dev } from "$app/env";
import { resolve as resolvePath } from "$app/paths";
import { reconcileAlerts } from "@cbp/database/alerts";
import { expireDeploymentJobs } from "@cbp/database/deployment-jobs";
import {
  error,
  redirect,
  type Handle,
  type HandleServerError,
} from "@sveltejs/kit";
import { auditUserAction } from "#lib/server/audit-action.js";
import { deliverAlertNotifications } from "#lib/server/alert-notifications.js";
import { getAuth, isAdminEmail } from "#lib/server/auth.js";
import { getDatabase } from "#lib/server/database.js";
import { cleanupDeploymentSecrets } from "#lib/server/deployment-secrets.js";
import { renewalAvailable, renewDueCertificate } from '#lib/server/lets-encrypt.js';
import { isDirectHttps } from "#lib/server/trusted-transport.js";

const controllerRoutes = [
  "/api/internal/controller/check-in",
  "/api/internal/controller/deployment-claim",
  "/api/internal/controller/deployment-log",
  "/api/internal/controller/deployment-result",
  "/api/internal/controller/enroll",
  "/api/internal/controller/heartbeat",
  "/api/internal/controller/invite",
  "/api/internal/controller/probe-hosts",
  "/api/internal/controller/probe-results",
  "/api/internal/controller/revoke",
  "/api/internal/controller/unregister",
];

type ExpiryTimer = ReturnType<typeof setInterval>;
type AlertTimer = ReturnType<typeof setInterval>;
const cleanup = globalThis as typeof globalThis & {
  cbpDeploymentExpiryTimer?: ExpiryTimer;
  cbpAlertReconcileTimer?: AlertTimer;
  cbpRenewalTimer?: ReturnType<typeof setInterval>;
};
let expiryTimer: ExpiryTimer | undefined;
let alertTimer: AlertTimer | undefined;
let renewalTimer: ReturnType<typeof setInterval> | undefined;
let expiringJobs = false;
let reconcilingAlerts = false;

export function init() {
  if (building || expiryTimer) return;
  // Vite can replace the hooks module while the previous interval is still running.
  clearInterval(cleanup.cbpDeploymentExpiryTimer);
  const expire = async () => {
    if (expiringJobs) return;
    expiringJobs = true;
    try {
      await expireDeploymentJobs(getDatabase());
    } catch (failure) {
      const cause =
        failure instanceof Error ? (failure.cause ?? failure) : failure;
      console.error(
        "Could not clear expired certificate deployment jobs",
        cause,
      );
    } finally {
      expiringJobs = false;
    }
  };
  void expire();
  expiryTimer = setInterval(expire, 10_000);
  cleanup.cbpDeploymentExpiryTimer = expiryTimer;
  expiryTimer.unref();

  void cleanupDeploymentSecrets().catch(() => console.error('Could not clean up Vault deployment secrets'));

  clearInterval(cleanup.cbpAlertReconcileTimer);
  const reconcile = async () => {
    if (reconcilingAlerts) return;
    reconcilingAlerts = true;
    try {
      await reconcileAlerts(getDatabase());
    } catch (failure) {
      const cause =
        failure instanceof Error ? (failure.cause ?? failure) : failure;
      console.error("Could not reconcile alerts", cause);
    }
    try {
      await deliverAlertNotifications(getDatabase());
    } catch {
      console.error("Could not process alert notifications");
    } finally {
      reconcilingAlerts = false;
    }
    try {
      await cleanupDeploymentSecrets();
    } catch {
      console.error('Could not clean up Vault deployment secrets');
    }
  };
  void reconcile();
  alertTimer = setInterval(reconcile, 60_000);
  cleanup.cbpAlertReconcileTimer = alertTimer;
  alertTimer.unref();

  if (renewalAvailable) {
    clearInterval(cleanup.cbpRenewalTimer);
    let renewing = false;
    const renew = async () => {
      if (renewing) return;
      renewing = true;
      try {
        await renewDueCertificate();
      } catch {
        console.error('Could not process the certificate renewal queue');
      } finally {
        renewing = false;
      }
    };
    void renew();
    renewalTimer = setInterval(renew, 60_000);
    cleanup.cbpRenewalTimer = renewalTimer;
    renewalTimer.unref();
  }
}

import.meta.hot?.dispose(() => {
  clearInterval(expiryTimer);
  clearInterval(alertTimer);
  clearInterval(renewalTimer);
  if (cleanup.cbpRenewalTimer === renewalTimer) delete cleanup.cbpRenewalTimer;
  if (cleanup.cbpDeploymentExpiryTimer === expiryTimer) {
    delete cleanup.cbpDeploymentExpiryTimer;
  }
  if (cleanup.cbpAlertReconcileTimer === alertTimer) {
    delete cleanup.cbpAlertReconcileTimer;
  }
  expiryTimer = undefined;
  alertTimer = undefined;
  renewalTimer = undefined;
});

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  const { id } = event.route;
  if (building || !id) return resolve(event);
  if (controllerRoutes.includes(id)) {
    if (isDirectHttps(event)) error(404, "Not found");
    return resolve(event);
  }
  if (id === "/api/internal/ansible") return resolve(event);
  if (id === '/[x+2e]well-known/acme-challenge/[token]') return resolve(event);

  const session = await getAuth().api.getSession({
    headers: event.request.headers,
  });
  const user = session?.user;
  if (user) event.locals.auditActor = { id: user.id, name: user.name };
  event.locals.user = user
    ? {
        name: user.name,
        email: user.email,
        username: user.displayUsername ?? user.username,
        image: user.image,
        isAdmin: isAdminEmail(user.email),
      }
    : null;

  if (id === "/signin") {
    if (user) redirect(303, resolvePath("/"));
  } else if (!user) {
    redirect(303, resolvePath("/signin"));
  }
  return auditUserAction(event, () => {
    if (
      (id === "/users" || id.startsWith("/users/")) &&
      !event.locals.user?.isAdmin
    ) {
      error(403, "An administrator account is required to access users.");
    }
    const ownAccountAction = id === "/signout" || id === "/account/password";
    if (
      event.locals.user &&
      !event.locals.user.isAdmin &&
      !ownAccountAction &&
      !["GET", "HEAD", "OPTIONS"].includes(event.request.method)
    ) {
      error(403, "An administrator account is required to make changes.");
    }
    return resolve(event);
  });
};

export const handleError: HandleServerError = ({
  error: cause,
  event,
  kind,
}) => {
  if (!event.route.id?.startsWith("/deployments")) return;

  const status = kind === "unknown" ? 500 : cause.status;
  console.error(`Deployment page failed with HTTP ${status}`, cause);
  if (dev && kind === "unknown" && cause instanceof Error) {
    return { message: cause.message };
  }
};
