import { loadOverview } from '@cbp/database/overview';
import { getDatabase } from '#lib/server/database.js';
import { dateFormatter } from '#lib/server/date-formatter.js';
import { pingLabels } from '#lib/server/ping-host.js';
import { displayCertificateDomain } from './certificates/display-domain.js';
import { dayInMilliseconds, expiryFilters } from './certificates/expiry.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
  const now = Date.now();
  const nextWeek = new Date(now + expiryFilters['7d'].days * dayInMilliseconds);
  const nextMonth = new Date(now + expiryFilters['30d'].days * dayInMilliseconds);
  const recentPingCutoff = new Date(now - dayInMilliseconds);
  const format = dateFormatter(cookies.get('cbp-time-zone'));
  const overview = await loadOverview(getDatabase(), { now: new Date(now), nextWeek, nextMonth, recentPingCutoff });

  return {
    counts: overview.counts,
    reachability: overview.reachability,
    attention: overview.attention.map(({ id, domain, sans, groupName, validUntil, failedDeployments }) => ({
      id,
      domain: displayCertificateDomain(domain, sans),
      groupName: groupName ?? 'Unassigned',
      expiry: { iso: validUntil.toISOString(), label: format.format(validUntil) },
      expired: validUntil.getTime() <= now,
      expiring: validUntil.getTime() > now && validUntil <= nextMonth,
      failedDeployments
    })),
    recentPings: overview.recentPings.flatMap(({ id, name, hostname, checkedAt, status }) =>
      checkedAt && status ? [{
        id, name: hostname ?? name, status: pingLabels[status],
        stale: checkedAt < recentPingCutoff,
        checked: { iso: checkedAt.toISOString(), label: format.format(checkedAt) }
      }] : []),
    openAlerts: overview.openAlerts.map(({ detectedAt, ...alert }) => ({
      ...alert, detected: { iso: detectedAt.toISOString(), label: format.format(detectedAt) }
    }))
  };
};
