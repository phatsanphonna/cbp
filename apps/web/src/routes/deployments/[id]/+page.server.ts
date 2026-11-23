import {
  findDeploymentRun,
  listDeploymentTargets,
} from "@cbp/database/deployment-jobs";
import { resolve } from "$app/paths";
import { error, redirect } from "@sveltejs/kit";
import { dateFormatter } from "#lib/server/date-formatter.js";
import { getDatabase } from "#lib/server/database.js";
import { displayCertificateDomain } from "../../certificates/display-domain.js";
import {
  formatDeploymentTargets,
  jobIdPattern,
} from "../deployment-view.server.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies, depends }) => {
  depends("cbp:agent-deployments");
  const id = params.id.toLowerCase();
  if (id.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(id))
    error(404, "Deployment job not found");

  const database = getDatabase();
  const run = await findDeploymentRun(
    database,
    jobIdPattern.test(id) ? { id } : { slug: id },
  );
  if (!run) error(404, "Deployment job not found");
  if (params.id !== run.slug)
    redirect(307, resolve("/deployments/[id]", { id: run.slug }));

  const targets = await listDeploymentTargets(database, { runId: run.id });
  const timeZone = cookies.get("cbp-time-zone");
  return {
    id: run.slug,
    certificateName: displayCertificateDomain(run.domain, run.sans),
    submittedAt: run.submittedAt?.toISOString(),
    submittedLabel: run.submittedAt
      ? dateFormatter(timeZone).format(run.submittedAt)
      : undefined,
    jobs: formatDeploymentTargets(targets, timeZone),
  };
};
