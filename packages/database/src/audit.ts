import { and, desc, eq, gte, ilike, inArray, lt, notInArray } from 'drizzle-orm';
import { user } from './auth-schema.js';
import type { openDatabase } from './index.js';
import {
  auditEvents,
  certificates,
  channels,
  deploymentRuns,
  hosts,
  userGroups,
} from './inventory-schema.js';

type Database = ReturnType<typeof openDatabase>;
type AuditEvent = Omit<typeof auditEvents.$inferInsert, 'id' | 'occurredAt'>;

export const auditResults = ['succeeded', 'failed', 'denied', 'rejected', 'error'] as const;
export type AuditResult = (typeof auditResults)[number];
export type AuditFilters = {
  actor?: string;
  action?: string;
  result?: AuditResult;
  from?: Date;
  to?: Date;
};

const deniedStatuses = [401, 403];

/** Human bucket for a stored HTTP status; `listAuditEvents` filters with the same thresholds. */
export function auditResult(status: number): Exclude<AuditResult, 'failed'> {
  if (status < 400) return 'succeeded';
  if (deniedStatuses.includes(status)) return 'denied';
  return status < 500 ? 'rejected' : 'error';
}

export async function recordAuditEvent(db: Database, event: AuditEvent) {
  await db.insert(auditEvents).values(event);
}

export function listAuditEvents(
  db: Database,
  offset: number,
  limit: number,
  filters: AuditFilters = {},
) {
  const { status } = auditEvents;
  const results = {
    succeeded: lt(status, 400),
    failed: gte(status, 400),
    denied: inArray(status, deniedStatuses),
    rejected: and(gte(status, 400), lt(status, 500), notInArray(status, deniedStatuses)),
    error: gte(status, 500),
  };
  return db
    .select()
    .from(auditEvents)
    .where(
      and(
        filters.actor
          ? ilike(auditEvents.actorName, `%${filters.actor.replace(/[\\%_]/g, '\\$&')}%`)
          : undefined,
        filters.action ? eq(auditEvents.action, filters.action) : undefined,
        filters.result ? results[filters.result] : undefined,
        filters.from ? gte(auditEvents.occurredAt, filters.from) : undefined,
        filters.to ? lt(auditEvents.occurredAt, filters.to) : undefined,
      ),
    )
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .offset(offset)
    .limit(limit);
}

export type AuditTargetIds = {
  certificate: string[];
  run: string[];
  host: string[];
  user: string[];
  group: number[];
  channel: number[];
};

/** Current display names for audit targets, keyed `${kind}:${id}`; missing keys were removed. */
export async function findAuditTargetNames(db: Database, ids: AuditTargetIds) {
  const lookup = <T extends string | number>(
    kind: keyof AuditTargetIds,
    list: T[],
    query: () => Promise<{ id: T; name: string }[]>,
  ) =>
    list.length
      ? query().then((rows) => rows.map(({ id, name }) => [`${kind}:${id}`, name] as const))
      : [];
  const groups = await Promise.all([
    lookup('certificate', ids.certificate, () =>
      db
        .select({ id: certificates.id, name: certificates.domain })
        .from(certificates)
        .where(inArray(certificates.id, ids.certificate)),
    ),
    lookup('run', ids.run, () =>
      db
        .select({ id: deploymentRuns.id, name: deploymentRuns.slug })
        .from(deploymentRuns)
        .where(inArray(deploymentRuns.id, ids.run)),
    ),
    lookup('host', ids.host, () =>
      db
        .select({ id: hosts.id, name: hosts.name })
        .from(hosts)
        .where(inArray(hosts.id, ids.host)),
    ),
    lookup('user', ids.user, () =>
      db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids.user)),
    ),
    lookup('group', ids.group, () =>
      db
        .select({ id: userGroups.id, name: userGroups.name })
        .from(userGroups)
        .where(inArray(userGroups.id, ids.group)),
    ),
    lookup('channel', ids.channel, () =>
      db
        .select({ id: channels.id, name: channels.provider })
        .from(channels)
        .where(inArray(channels.id, ids.channel)),
    ),
  ]);
  return new Map<string, string>(groups.flat());
}
