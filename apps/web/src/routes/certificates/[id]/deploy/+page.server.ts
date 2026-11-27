import { error } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { deployCertificateAction } from "#lib/server/agent-deployment.js";
import { hasPermission } from "#lib/server/access-control.js";
import { load as loadCertificate } from "../+page.server";

export const load: PageServerLoad = async (event) => {
  if (!hasPermission(event.locals.user, "deployments.manage"))
    error(403, "Deployment management permission is required.");
  return loadCertificate(event);
};

export const actions: Actions = {
  deployMixed: (event) =>
    deployCertificateAction(event, event.params.id, null),
};
