import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { openDatabase } from './index.js';
import { deploymentJobs, deployments, hostAgents, hosts } from './inventory-schema.js';

type Database = ReturnType<typeof openDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const hostIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

// Lock the host first so revocation, check-ins and host deletion serialize.
export async function withAgentHost<T>(
  db: Database,
  hostId: string,
  work: (tx: Transaction, name: string, applianceType: string | null) => Promise<T>,
  allowUnmanaged = false,
) {
  if (!hostIdPattern.test(hostId)) return 'missing' as const;
  return db.transaction(async (tx) => {
    const [host] = await tx
      .select({
        agentManaged: hosts.agentManaged,
        name: hosts.name,
        applianceType: hosts.applianceType,
      })
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .for('update');
    return host && (host.agentManaged || allowUnmanaged)
      ? work(tx, host.name, host.applianceType)
      : ('missing' as const);
  });
}

export async function hostAgentEnrollment(db: Database, hostId: string) {
  const [agent] = await db
    .select({
      enrolled: sql<boolean>`${hostAgents.tokenHash} is not null`,
      inviteExpiresAt: hostAgents.inviteExpiresAt,
    })
    .from(hostAgents)
    .where(eq(hostAgents.hostId, hostId));
  if (agent?.enrolled) return { status: 'enrolled', expiresAt: null } as const;
  if (agent?.inviteExpiresAt && agent.inviteExpiresAt.getTime() > Date.now()) {
    return { status: 'pending', expiresAt: agent.inviteExpiresAt } as const;
  }
  return { status: 'not-enrolled', expiresAt: null } as const;
}

export function inviteHostAgent(
  db: Database,
  hostId: string,
  inviteHash: string,
  { enableAgent = false } = {},
) {
  return withAgentHost(
    db,
    hostId,
    async (tx, _name, applianceType) => {
      if (applianceType !== 'Linux') return 'unsupported';
      const now = new Date();
      const invite = {
        inviteHash,
        inviteExpiresAt: new Date(now.getTime() + 15 * 60_000),
      };
      const [saved] = await tx
        .insert(hostAgents)
        .values({ hostId, ...invite })
        .onConflictDoUpdate({
          target: hostAgents.hostId,
          set: invite,
          setWhere: and(isNull(hostAgents.tokenHash), lte(hostAgents.inviteExpiresAt, now)),
        })
        .returning({ hostId: hostAgents.hostId });
      if (!saved) return 'conflict';
      if (enableAgent) {
        await tx
          .update(hosts)
          .set({ agentManaged: true })
          .where(and(eq(hosts.id, hostId), eq(hosts.agentManaged, false)));
      }
      return 'ok';
    },
    enableAgent,
  );
}

export function enrollHostAgent(
  db: Database,
  hostId: string,
  inviteHash: string,
  tokenHash: string,
  address?: string,
) {
  return withAgentHost(db, hostId, async (tx, name, applianceType) => {
    if (applianceType !== 'Linux') return 'unsupported';
    const pendingInvite = and(
      eq(hostAgents.hostId, hostId),
      eq(hostAgents.inviteHash, inviteHash),
      isNull(hostAgents.tokenHash),
      gt(hostAgents.inviteExpiresAt, new Date()),
    );
    const expected = enrollmentIP(name);
    if (expected && expected !== enrollmentIP(address ?? '')) {
      const [invite] = await tx
        .select({ hostId: hostAgents.hostId })
        .from(hostAgents)
        .where(pendingInvite);
      return invite ? 'address-mismatch' : 'denied';
    }
    const [saved] = await tx
      .update(hostAgents)
      .set({ tokenHash, inviteHash: null, inviteExpiresAt: null })
      .where(pendingInvite)
      .returning({ hostId: hostAgents.hostId });
    return saved ? 'ok' : 'denied';
  });
}

function enrollmentIP(value: string) {
  if (value.includes('%')) return null;
  const version = isIP(value);
  if (version !== 6) return version === 4 ? value : null;
  const ip = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(ip);
  if (!mapped) return ip;
  const upper = parseInt(mapped[1], 16);
  const lower = parseInt(mapped[2], 16);
  return [upper >> 8, upper & 255, lower >> 8, lower & 255].join('.');
}

type AgentReport = Pick<
  typeof hosts.$inferSelect,
  'hostname' | 'operatingSystem' | 'architecture'
> & { lastProbedAt: Date };

export const listenerBatchSize = 12;
export type AgentReadiness = {
  allowedServices: string[];
  serviceVersions: Record<string, string>;
  cursor?: string;
  results: {
    id: string;
    endpoint: string;
    engine: string;
    status: 'ready' | 'unreachable' | 'tls-error' | 'not-allowed';
    address: string | null;
    fingerprint: string | null;
    expiresAt?: Date;
  }[];
};

export function saveAgentCheckIn(
  db: Database,
  hostId: string,
  tokenHash: string,
  report: AgentReport,
  readiness?: AgentReadiness,
) {
  return withAgentHost(db, hostId, async (tx) => {
    const [agent] = await tx
      .select({ hostId: hostAgents.hostId })
      .from(hostAgents)
      .where(and(eq(hostAgents.hostId, hostId), eq(hostAgents.tokenHash, tokenHash)));
    if (!agent) return 'denied';

    await tx
      .update(hosts)
      .set({ agentSeenAt: sql`greatest(${hosts.agentSeenAt}, now())` })
      .where(eq(hosts.id, hostId));
    await tx
      .update(hosts)
      .set({
        ...report,
        allowedDeploymentServices: readiness?.allowedServices,
        deploymentServiceVersions: readiness?.serviceVersions,
      })
      .where(
        and(
          eq(hosts.id, hostId),
          or(isNull(hosts.lastProbedAt), lte(hosts.lastProbedAt, report.lastProbedAt)),
        ),
      );
    if (!readiness) return 'ok';

    for (const result of readiness.results) {
      const [deployment] = await tx
        .select({ fingerprint: deployments.expectedFingerprint })
        .from(deployments)
        .where(and(eq(deployments.id, result.id), eq(deployments.hostId, hostId)));
      const expectedFingerprint = deployment?.fingerprint
        ?.replace(/^sha256:/i, '')
        .replaceAll(':', '')
        .toLowerCase();
      const listenerStatus =
        result.status === 'ready' &&
        result.fingerprint &&
        expectedFingerprint &&
        result.fingerprint.toLowerCase() !== expectedFingerprint
          ? 'drifted'
          : result.status;
      const observedAt = sql`${report.lastProbedAt.toISOString()}::timestamptz`;
      const latestObservation = sql`${deployments.servedCertificateObservedAt} is null or
        ${deployments.servedCertificateObservedAt} <= ${observedAt}`;
      await tx
        .update(deployments)
        .set({
          listenerStatus,
          listenerAddress: result.address,
          listenerCheckedAt: report.lastProbedAt,
          listenerFingerprint: result.fingerprint,
          servedCertificateExpiresAt: result.expiresAt
            ? sql`case when ${latestObservation} then ${result.expiresAt.toISOString()}::timestamptz
                else ${deployments.servedCertificateExpiresAt} end`
            : undefined,
          servedCertificateObservedAt: result.expiresAt
            ? sql`case when ${latestObservation} then ${observedAt}
                else ${deployments.servedCertificateObservedAt} end`
            : undefined,
        })
        .where(
          and(
            eq(deployments.id, result.id),
            eq(deployments.hostId, hostId),
            eq(deployments.method, 'Agent'),
            eq(deployments.endpoint, result.endpoint),
            eq(deployments.engine, result.engine),
            or(
              isNull(deployments.listenerCheckedAt),
              lte(deployments.listenerCheckedAt, report.lastProbedAt),
            ),
          ),
        );
    }

    const targets = await tx
      .select({
        id: deployments.id,
        endpoint: deployments.endpoint,
        engine: deployments.engine,
      })
      .from(deployments)
      .where(
        and(
          eq(deployments.hostId, hostId),
          eq(deployments.method, 'Agent'),
          inArray(deployments.engine, ['Apache2', 'Nginx', 'HAProxy']),
          readiness.cursor ? gt(deployments.id, readiness.cursor) : undefined,
        ),
      )
      .orderBy(deployments.id)
      .limit(listenerBatchSize + 1);
    return {
      listenerTargets: targets.slice(0, listenerBatchSize),
      nextListenerCursor:
        targets.length > listenerBatchSize ? targets[listenerBatchSize - 1].id : '',
    };
  });
}

export function revokeHostAgent(db: Database, hostId: string, tokenHash?: string) {
  return withAgentHost(
    db,
    hostId,
    async (tx) => {
      if (tokenHash !== undefined) {
        const [agent] = await tx
          .select({ tokenHash: hostAgents.tokenHash })
          .from(hostAgents)
          .where(eq(hostAgents.hostId, hostId));
        if (!agent?.tokenHash) return 'ok';
        if (agent.tokenHash !== tokenHash) return 'denied';
      }
      await tx.delete(hostAgents).where(eq(hostAgents.hostId, hostId));
      await tx
        .update(deploymentJobs)
        .set({
          status: sql`case when ${deploymentJobs.expiresAt} <= now() then 'Expired' else 'Failed' end`,
          detail: 'Agent enrollment was revoked before the deployment could be confirmed.',
          finishedAt: sql`now()`,
        })
        .where(
          and(
            eq(deploymentJobs.hostId, hostId),
            eq(deploymentJobs.method, 'Agent'),
            inArray(deploymentJobs.status, ['Queued', 'Running']),
          ),
        );
      await tx
        .update(hosts)
        .set({
          allowedDeploymentServices: null,
          deploymentServiceVersions: null,
        })
        .where(eq(hosts.id, hostId));
      await tx
        .update(deployments)
        .set({
          listenerStatus: null,
          listenerAddress: null,
          listenerCheckedAt: null,
          listenerFingerprint: null,
        })
        .where(and(eq(deployments.hostId, hostId), eq(deployments.method, 'Agent')));
      return 'ok';
    },
    true,
  );
}
import { isIP } from 'node:net';
