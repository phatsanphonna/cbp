import { listDeploymentRuns, listDeploymentTargets } from '@cbp/database/deployment-jobs';
import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { dateFormatter } from '#lib/server/date-formatter.js';
import { getDatabase } from '#lib/server/database.js';
import { displayCertificateDomain } from '../certificates/display-domain.js';
import { jobIdPattern } from './deployment-view.server.js';
import type { PageServerLoad } from './$types';

const pageSize = 50;

export const load: PageServerLoad = async ({ url, cookies, depends }) => {
  depends('cbp:agent-deployments');
  const jobIds = [...new Set(url.searchParams.getAll('job').map((id) => id.toLowerCase()))];
  if (jobIds.some((id) => !jobIdPattern.test(id))) error(400, 'Invalid deployment job ID');
  const database = getDatabase();
  const timezone = cookies.get('cbp-time-zone');
  if (jobIds.length) {
    const rows = await listDeploymentTargets(database, { jobIds });
    const runSlugs = new Set(rows.map(({ runSlug }) => runSlug));
    if (runSlugs.size === 1) redirect(307, resolve('/deployments/[id]', { id: rows[0].runSlug }));
    redirect(307, resolve('/deployments'));
  }

  const requested = Number(url.searchParams.get('page'));
  const offset = (requested - 1) * pageSize;
  const page =
    Number.isSafeInteger(offset) && offset >= 0 && Number.isInteger(requested) ? requested : 1;
  const rows = await listDeploymentRuns(database, (page - 1) * pageSize, pageSize + 1);
  const format = dateFormatter(timezone);

  return {
    page,
    hasNext: rows.length > pageSize,
    runs: rows.slice(0, pageSize).map(({ domain, sans, submittedAt, ...run }) => ({
      ...run,
      certificateName: displayCertificateDomain(domain, sans),
      submittedAt: submittedAt?.toISOString(),
      submittedLabel: submittedAt ? format.format(submittedAt) : undefined,
    })),
  };
};
