import { and, eq, gte, isNull, like, notInArray, or, sql } from 'drizzle-orm';
import type { openDatabase } from './index.js';
import { alertDeliveries, alerts, certificates, channels, hosts } from './inventory-schema.js';

type Database = ReturnType<typeof openDatabase>;
const day = 24 * 60 * 60 * 1000;
const certificateRule = 'certificate-expiry:%';
const hostRule = 'host-no-reply:%';

export type AlertDelivery = {
  alertId: string;
  channelId: number;
  severity: typeof alerts.$inferSelect.severity;
  message: string;
  target: string;
  attempts: number;
};

const severityOrder = sql`array['Info', 'Warning', 'High', 'Critical']`;
const maxAttempts = 5;

export async function claimAlertDeliveries(
  db: Database,
  channelIds: number[],
): Promise<AlertDelivery[]> {
  if (!channelIds.length) return [];
  // Raw SQL rows are untyped; the final select list matches AlertDelivery.
  const rows = await db.execute(sql`
    with candidates as (
      select a.id as alert_id, c.id as channel_id, a.severity, a.message, a.target
      from ${alerts} a
      cross join ${channels} c
      left join ${alertDeliveries} d
        on (d.alert_id, d.channel_id, d.severity) = (a.id, c.id, a.severity)
      where a.resolved_at is null and a.cleared_at is null and c.enabled
        and c.id in (${sql.join(
          channelIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        and (c.certificate_ids is null or (
          a.rule_key like ${certificateRule}
          and exists (
            select 1 from ${certificates} cert
            where cert.id = any(c.certificate_ids) and cert.id::text = a.target_id
          )
        ))
        and array_position(${severityOrder}, a.severity) >= array_position(${severityOrder}, c.severity)
        and (d.attempts is null or (
          d.delivered_at is null and d.attempts < ${maxAttempts} and d.next_attempt_at <= now()
        ))
      order by array_position(${severityOrder}, a.severity) desc, a.detected_at, a.id, c.id
      limit 10
    ), claimed as (
      insert into ${alertDeliveries} as d
        (alert_id, channel_id, severity, attempts, next_attempt_at)
      select alert_id, channel_id, severity, 1, now() + interval '5 minutes' from candidates
      on conflict (alert_id, channel_id, severity) do update
        set attempts = d.attempts + 1, next_attempt_at = excluded.next_attempt_at
        where d.delivered_at is null and d.attempts < ${maxAttempts} and d.next_attempt_at <= now()
      returning alert_id, channel_id, severity, attempts
    )
    select alert_id as "alertId", channel_id as "channelId", severity, attempts, message, target
    from claimed join candidates using (alert_id, channel_id, severity)
  `);
  return rows as unknown as AlertDelivery[];
}

export async function markAlertDelivered(db: Database, delivery: AlertDelivery) {
  await db
    .update(alertDeliveries)
    .set({ deliveredAt: sql`now()` })
    .where(
      and(
        eq(alertDeliveries.alertId, delivery.alertId),
        eq(alertDeliveries.channelId, delivery.channelId),
        eq(alertDeliveries.severity, delivery.severity),
        eq(alertDeliveries.attempts, delivery.attempts),
      ),
    );
}

export async function clearAlert(db: Database, id: string) {
  const [cleared] = await db
    .update(alerts)
    .set({ clearedAt: sql`now()` })
    .where(and(eq(alerts.id, id), isNull(alerts.resolvedAt), isNull(alerts.clearedAt)))
    .returning({ id: alerts.id });
  return Boolean(cleared);
}

export async function reconcileAlerts(db: Database, now = new Date()) {
  await db.transaction(async (tx) => {
    // Keep the periodic sweep safe when more than one web instance is running.
    await tx.execute(sql`select pg_advisory_xact_lock(1128353868, 1)`);

    const desired: Array<{
      ruleKey: string;
      targetId: string;
      severity: 'Warning' | 'High' | 'Critical';
      message: string;
      target: string;
    }> = [];

    for (const certificate of await tx
      .select({
        id: certificates.id,
        domain: certificates.domain,
        validUntil: certificates.validUntil,
      })
      .from(certificates)) {
      const remaining = certificate.validUntil.getTime() - now.getTime();
      const severity =
        remaining <= 0
          ? 'Critical'
          : remaining <= 7 * day
            ? 'High'
            : remaining <= 30 * day
              ? 'Warning'
              : null;
      if (!severity) continue;

      const condition =
        severity === 'Critical'
          ? 'has expired'
          : severity === 'High'
            ? 'expires within 7 days'
            : 'expires within 30 days';
      desired.push({
        ruleKey: `certificate-expiry:${certificate.id}`,
        targetId: certificate.id,
        severity,
        message: `Certificate for ${certificate.domain} ${condition}.`,
        target: certificate.domain,
      });
    }

    for (const host of await tx
      .select({
        id: hosts.id,
        name: hosts.name,
      })
      .from(hosts)
      .where(and(eq(hosts.lastPingStatus, 'no-reply'), gte(hosts.consecutivePingFailures, 3)))) {
      desired.push({
        ruleKey: `host-no-reply:${host.id}`,
        targetId: host.id,
        severity: 'High',
        message: `${host.name} has not replied to 3 consecutive probes.`,
        target: host.name,
      });
    }

    const activeKeys = desired.map(({ ruleKey }) => ruleKey);
    await tx
      .update(alerts)
      .set({ resolvedAt: now })
      .where(
        and(
          isNull(alerts.resolvedAt),
          or(like(alerts.ruleKey, certificateRule), like(alerts.ruleKey, hostRule)),
          activeKeys.length ? notInArray(alerts.ruleKey, activeKeys) : undefined,
        ),
      );

    for (const alert of desired) {
      await tx
        .insert(alerts)
        .values(alert)
        .onConflictDoUpdate({
          target: alerts.ruleKey,
          targetWhere: sql`${alerts.resolvedAt} is null`,
          set: {
            severity: alert.severity,
            clearedAt: sql`case
              when array_position(${severityOrder}, excluded.severity) >
                array_position(${severityOrder}, ${alerts.severity}) then null
              else ${alerts.clearedAt}
              end`,
            message: alert.message,
            target: alert.target,
            targetId: alert.targetId,
          },
        });
    }
  });
}
