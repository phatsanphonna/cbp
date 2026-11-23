import { asc, count, desc, eq, gt, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { openDatabase } from './index.js';
import { alerts, certificates, deployments, hosts, userGroups } from './inventory-schema.js';

type Database = ReturnType<typeof openDatabase>;
type OverviewWindow = { now: Date; nextWeek: Date; nextMonth: Date; recentPingCutoff: Date };

export async function loadOverview(db: Database, { now, nextWeek, nextMonth, recentPingCutoff }: OverviewWindow) {
  const failedDeployments = sql<number>`(
    select count(*) from ${deployments}
    where ${deployments.certificateId} = ${certificates.id} and ${deployments.status} = 'Failed'
  )`.mapWith(Number);

  const [[counts], attention, [reachability], recentPings, openAlerts] = await Promise.all([
    db.select({
      total: count(),
      expired: sql<number>`count(*) filter (where ${lte(certificates.validUntil, now)})`.mapWith(Number),
      week: sql<number>`count(*) filter (where ${gt(certificates.validUntil, now)} and ${lte(certificates.validUntil, nextWeek)})`.mapWith(Number),
      month: sql<number>`count(*) filter (where ${gt(certificates.validUntil, now)} and ${lte(certificates.validUntil, nextMonth)})`.mapWith(Number)
    }).from(certificates),
    db.select({
      id: certificates.id, domain: certificates.domain, sans: certificates.sans,
      groupName: userGroups.name, validUntil: certificates.validUntil, failedDeployments
    }).from(certificates)
      .leftJoin(userGroups, eq(certificates.groupId, userGroups.id))
      .where(or(lte(certificates.validUntil, nextMonth), sql`${failedDeployments} > 0`))
      .orderBy(sql`case when ${lte(certificates.validUntil, now)} then 0
        when ${failedDeployments} > 0 then 1 when ${lte(certificates.validUntil, nextWeek)} then 2 else 3 end`,
        asc(certificates.validUntil), asc(certificates.domain), asc(certificates.id)).limit(8),
    db.select({
      reachable: sql<number>`count(*) filter (where ${gte(hosts.lastPingAt, recentPingCutoff)} and ${hosts.lastPingStatus} = 'reachable')`.mapWith(Number),
      noReply: sql<number>`count(*) filter (where ${gte(hosts.lastPingAt, recentPingCutoff)} and ${hosts.lastPingStatus} = 'no-reply')`.mapWith(Number),
      unavailable: sql<number>`count(*) filter (where ${gte(hosts.lastPingAt, recentPingCutoff)} and ${hosts.lastPingStatus} = 'unavailable')`.mapWith(Number),
      stale: sql<number>`count(*) filter (where ${lt(hosts.lastPingAt, recentPingCutoff)} and ${isNotNull(hosts.lastPingStatus)})`.mapWith(Number),
      unchecked: sql<number>`count(*) filter (where ${isNull(hosts.lastPingAt)} or ${isNull(hosts.lastPingStatus)})`.mapWith(Number)
    }).from(hosts),
    db.select({ id: hosts.id, name: hosts.name, hostname: hosts.hostname, checkedAt: hosts.lastPingAt, status: hosts.lastPingStatus })
      .from(hosts).where(isNotNull(hosts.lastPingAt)).orderBy(desc(hosts.lastPingAt), asc(hosts.id)).limit(4),
    db.select({ id: alerts.id, severity: alerts.severity, message: alerts.message, target: alerts.target, detectedAt: alerts.detectedAt })
      .from(alerts).where(isNull(alerts.resolvedAt))
      .orderBy(sql`case ${alerts.severity} when 'Critical' then 0 when 'High' then 1 when 'Warning' then 2 else 3 end`,
        desc(alerts.detectedAt), asc(alerts.id)).limit(5)
  ]);

  return { counts, attention, reachability, recentPings, openAlerts };
}
