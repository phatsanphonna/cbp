import { recordAuditEvent } from "@cbp/database/audit";
import { isHttpError, isRedirect, type RequestEvent } from "@sveltejs/kit";
import { getDatabase } from "./database.js";

const deploymentActions = {
  linkDeployment: "Link deployment",
  updateEndpoint: "Edit deployment",
  removeDeployment: "Delete endpoint",
};
const actionLabels: Record<string, Record<string, string>> = {
  "/signin": { default: "Sign in" },
  "/signout": { default: "Sign out" },
  "/account/password": { default: "Change password" },
  "/users": { remove: "Remove user" },
  "/users/new": { default: "Create user" },
  "/hosts/new": { default: "Add host" },
  "/hosts/[id]": {
    ...deploymentActions,
    inviteAgent: "Generate enrollment code",
    resetAgent: "Reset enrollment",
    importReport: "Import host report",
    ping: "Ping host",
    remove: "Remove host",
    bindCredential: 'Bind Ansible credential',
  },
  '/ansible-credentials': { create: 'Create Ansible credential', remove: 'Delete Ansible credential', bind: 'Bind Ansible credential', unbind: 'Unbind Ansible credential' },
  '/certificates/new': {
    default: 'Register certificate',
    letsencrypt: 'Issue Let’s Encrypt certificate',
  },
  "/certificates/[id]": {
    ...deploymentActions,
    deploy: "Deploy certificate",
    deployAnsible: "Deploy certificate via Ansible",
    deployMixed: "Deploy certificate",
    deleteCredential: "Delete saved deployment credential",
    updateChain: "Update fullchain",
    restoreChain: "Restore fullchain",
    remove: "Remove certificate",
  },
  "/deployments/[id]": { cancel: "Cancel queued deployment" },
  '/renewals': {
    enable: 'Enable Let’s Encrypt renewal',
    disable: 'Disable Let’s Encrypt renewal',
  },
  "/alerts": { clear: "Clear alert" },
  "/alerts/channels": {
    add: "Add notification channel",
    edit: "Edit notification channel",
    bindCertificate: "Bind notification channel to certificate",
    setEnabled: "Change notification channel status",
    remove: "Remove notification channel",
    test: "Send test notification",
  },
};

export async function auditUserAction(
  event: RequestEvent,
  resolve: () => Response | Promise<Response>,
) {
  const route = event.route.id;
  if (
    !route ||
    !["POST", "PUT", "PATCH", "DELETE"].includes(event.request.method)
  )
    return resolve();

  const key =
    [...event.url.searchParams.keys()]
      .find((key) => key.startsWith("/"))
      ?.slice(1) ??
    (route === '/certificates/new' && event.url.searchParams.get('method') === 'letsencrypt'
      ? 'letsencrypt'
      : 'default');
  const labels = actionLabels[route];
  const action =
    labels && Object.hasOwn(labels, key) ? labels[key] : "Submit form";
  const record = async (status: number) => {
    if (route === "/signin" && [403, 413, 429].includes(status)) return;
    const actor = event.locals.auditActor;
    const id = event.locals.auditTargetId ?? event.params.id;
    const targetPattern =
      route === "/users"
        ? /^[A-Za-z0-9_-]{1,128}$/
        : /^(?:[0-9]+|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i;
    const targetId = id && targetPattern.test(id) ? id : null;
    try {
      await recordAuditEvent(getDatabase(), {
        actorId: actor?.id,
        actorName: actor?.name,
        action,
        route,
        targetId,
        status,
      });
    } catch {
      console.error("Could not store web audit event", { action, route });
    }
  };

  try {
    const response = await resolve();
    await record(response.status);
    return response;
  } catch (error) {
    await record(isHttpError(error) || isRedirect(error) ? error.status : 500);
    throw error;
  }
}
