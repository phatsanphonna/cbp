import { findDeploymentRun, listDeploymentTargets } from '@cbp/database/deployment-jobs';
import {
  cancelQueuedDeploymentAction,
  recoverDeploymentAction,
} from '#lib/server/agent-deployment.js';
import { getAnsibleToken, getControllerToken } from '#lib/server/controller-config.js';
import { hasTrustedTransport } from '#lib/server/trusted-transport.js';
import { resolve } from '$app/paths';
import { error, redirect } from '@sveltejs/kit';
import { dateFormatter } from '#lib/server/date-formatter.js';
import { getDatabase } from '#lib/server/database.js';
import { displayCertificateDomain } from '../../certificates/display-domain.js';
import { formatDeploymentTargets, jobIdPattern } from '../deployment-view.server.js';
import type { Actions, PageServerLoad } from './$types';
import { assetViewer, hasPermission } from '#lib/server/access-control.js';

export const load: PageServerLoad = async (event) => {
  const { params, cookies, depends } = event;
  depends('cbp:agent-deployments');
  const id = params.id.toLowerCase();
  if (id.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(id))
    error(404, 'Deployment job not found');

  const database = getDatabase();
  const viewer = assetViewer(event.locals.user);
  const run = await findDeploymentRun(
    database,
    jobIdPattern.test(id) ? { id } : { slug: id },
    viewer,
  );
  if (!run) error(404, 'Deployment job not found');
  if (params.id !== run.slug) redirect(307, resolve('/deployments/[id]', { id: run.slug }));

  const targets = await listDeploymentTargets(database, { runId: run.id }, viewer);
  const timeZone = cookies.get('cbp-time-zone');
  return {
    id: run.slug,
    certificateName: displayCertificateDomain(run.domain, run.sans),
    certificateFingerprint: run.fingerprint,
    submittedAt: run.submittedAt?.toISOString(),
    submittedLabel: run.submittedAt ? dateFormatter(timeZone).format(run.submittedAt) : undefined,
    jobs: formatDeploymentTargets(targets, timeZone),
    canCancel: hasPermission(event.locals.user, 'deployments.manage'),
    canRecover: {
      Agent: Boolean(getControllerToken() && hasTrustedTransport(event)),
      Ansible: Boolean(getAnsibleToken() && hasTrustedTransport(event)),
    },
  };
};

export const actions: Actions = {
  recover: (event) => recoverDeploymentAction(event),
  cancel: (event) => cancelQueuedDeploymentAction(event),
};
