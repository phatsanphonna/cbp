import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { openDatabase } from './index.js';
import { hostAgents, hosts } from './inventory-schema.js';

type Database = ReturnType<typeof openDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const hostIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

// Lock the host first so revocation, check-ins and host deletion serialize.
export async function withAgentHost<T>(db: Database, hostId: string, work: (tx: Transaction) => Promise<T>, allowUnmanaged = false) {
  if (!hostIdPattern.test(hostId)) return 'missing' as const;
  return db.transaction(async (tx) => {
    const [host] = await tx.select({ agentManaged: hosts.agentManaged })
      .from(hosts).where(eq(hosts.id, hostId)).for('update');
    return host && (host.agentManaged || allowUnmanaged) ? work(tx) : 'missing' as const;
  });
}

export async function hostAgentEnrollment(db: Database, hostId: string) {
  const [agent] = await db.select({
    enrolled: sql<boolean>`${hostAgents.tokenHash} is not null`,
    inviteExpiresAt: hostAgents.inviteExpiresAt
  }).from(hostAgents).where(eq(hostAgents.hostId, hostId));
  if (agent?.enrolled) return { status: 'enrolled', expiresAt: null } as const;
  if (agent?.inviteExpiresAt && agent.inviteExpiresAt.getTime() > Date.now()) {
    return { status: 'pending', expiresAt: agent.inviteExpiresAt } as const;
  }
  return { status: 'not-enrolled', expiresAt: null } as const;
}

export function inviteHostAgent(db: Database, hostId: string, inviteHash: string, { enableAgent = false } = {}) {
  return withAgentHost(db, hostId, async (tx) => {
    const now = new Date();
    const invite = { inviteHash, inviteExpiresAt: new Date(now.getTime() + 15 * 60_000) };
    const [saved] = await tx.insert(hostAgents).values({ hostId, ...invite })
      .onConflictDoUpdate({
        target: hostAgents.hostId,
        set: invite,
        setWhere: and(isNull(hostAgents.tokenHash), lte(hostAgents.inviteExpiresAt, now))
      }).returning({ hostId: hostAgents.hostId });
    if (!saved) return 'conflict';
    if (enableAgent) {
      await tx.update(hosts).set({ agentManaged: true }).where(and(eq(hosts.id, hostId), eq(hosts.agentManaged, false)));
    }
    return 'ok';
  }, enableAgent);
}

export function enrollHostAgent(db: Database, hostId: string, inviteHash: string, tokenHash: string) {
  return withAgentHost(db, hostId, async (tx) => {
    const [saved] = await tx.update(hostAgents).set({ tokenHash, inviteHash: null, inviteExpiresAt: null })
      .where(and(eq(hostAgents.hostId, hostId), eq(hostAgents.inviteHash, inviteHash),
        isNull(hostAgents.tokenHash), gt(hostAgents.inviteExpiresAt, new Date())))
      .returning({ hostId: hostAgents.hostId });
    return saved ? 'ok' : 'denied';
  });
}

type AgentReport = Pick<typeof hosts.$inferSelect, 'hostname' | 'operatingSystem' | 'architecture'>
  & { lastProbedAt: Date };

export function saveAgentCheckIn(db: Database, hostId: string, tokenHash: string, report: AgentReport) {
  return withAgentHost(db, hostId, async (tx) => {
    const [agent] = await tx.select({ hostId: hostAgents.hostId }).from(hostAgents)
      .where(and(eq(hostAgents.hostId, hostId), eq(hostAgents.tokenHash, tokenHash)));
    if (!agent) return 'denied';

    await tx.update(hosts).set({ agentSeenAt: sql`greatest(${hosts.agentSeenAt}, now())` }).where(eq(hosts.id, hostId));
    await tx.update(hosts).set(report).where(and(eq(hosts.id, hostId),
      or(isNull(hosts.lastProbedAt), lte(hosts.lastProbedAt, report.lastProbedAt))));
    return 'ok';
  });
}

export function revokeHostAgent(db: Database, hostId: string) {
  return withAgentHost(db, hostId, async (tx) => {
    await tx.delete(hostAgents).where(eq(hostAgents.hostId, hostId));
    return 'ok';
  }, true);
}
