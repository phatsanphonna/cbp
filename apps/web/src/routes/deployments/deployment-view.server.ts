import type { listDeploymentTargets } from "@cbp/database/deployment-jobs";
import { dateFormatter } from "#lib/server/date-formatter.js";
import { displayCertificateDomain } from "../certificates/display-domain.js";

export const jobIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export function formatDeploymentTargets(
  rows: Awaited<ReturnType<typeof listDeploymentTargets>>,
  timeZone: string | undefined,
) {
  const format = dateFormatter(timeZone);
  return rows.map(({ domain, sans, agentSeenAt, startedAt, finishedAt, ...job }) => ({
    ...job,
    certificateName: displayCertificateDomain(domain, sans),
    agentSeenAt: agentSeenAt?.toISOString(),
    agentSeenLabel: agentSeenAt ? format.format(agentSeenAt) : undefined,
    startedAt: startedAt?.toISOString(),
    finishedAt: finishedAt?.toISOString(),
    finishedAtLabel: finishedAt ? format.format(finishedAt) : undefined,
  }));
}
