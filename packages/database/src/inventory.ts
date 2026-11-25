import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { openDatabase } from "./index.js";
import {
  alerts,
  certificates,
  channels,
  deploymentJobs,
  deploymentRuns,
  deployments,
  hostAgents,
  hosts,
} from "./inventory-schema.js";

type Database = ReturnType<typeof openDatabase>;
const inventoryId = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const {
  fullchain: _fullchain,
  previousFullchain: _previousFullchain,
  owner: _legacyOwner,
  groupId: _legacyGroup,
  ...certificateMetadata
} = getTableColumns(certificates);
const previousChainRevision = sql<
  string | null
>`md5(${certificates.previousFullchain})`;

export function listHosts(db: Database) {
  return db
    .select({
      ...getTableColumns(hosts),
      certificates: countDistinct(deployments.certificateId),
    })
    .from(hosts)
    .leftJoin(deployments, eq(hosts.id, deployments.hostId))
    .groupBy(hosts.id)
    .orderBy(asc(hosts.name));
}

export function listHostOptions(db: Database) {
  return db
    .select({ id: hosts.id, name: hosts.name, hostname: hosts.hostname })
    .from(hosts)
    .orderBy(asc(hosts.name));
}

export function listProbeHosts(db: Database, after: string | null) {
  return db
    .select({ id: hosts.id, name: hosts.name })
    .from(hosts)
    .where(after ? gt(hosts.id, after) : undefined)
    .orderBy(asc(hosts.id))
    .limit(200);
}

export function listCertificateOptions(db: Database, ids?: string[]) {
  return db
    .select({
      id: certificates.id,
      domain: certificates.domain,
      sans: certificates.sans,
      serial: certificates.serial,
    })
    .from(certificates)
    .where(ids ? inArray(certificates.id, ids) : undefined)
    .orderBy(
      asc(certificates.domain),
      asc(certificates.validUntil),
      asc(certificates.id),
    );
}

type DeploymentLink = Pick<
  typeof deployments.$inferSelect,
  "certificateId" | "endpoint" | "method" | "engine"
> & { hostId: string };

export async function linkDeployment(db: Database, values: DeploymentLink) {
  if (
    !inventoryId.test(values.hostId) ||
    !inventoryId.test(values.certificateId)
  )
    return "missing";

  return db.transaction(async (tx) => {
    const [host] = await tx
      .select({ id: hosts.id })
      .from(hosts)
      .where(eq(hosts.id, values.hostId))
      .for("key share");
    if (!host) return "missing";
    const [certificate] = await tx
      .select({ id: certificates.id, fingerprint: certificates.fingerprint })
      .from(certificates)
      .where(eq(certificates.id, values.certificateId))
      .for("key share");
    if (!certificate) return "missing";

    const [linked] = await tx
      .insert(deployments)
      .values({ ...values, expectedFingerprint: certificate.fingerprint })
      .onConflictDoUpdate({
        target: [deployments.certificateId, deployments.endpoint],
        set: {
          hostId: values.hostId,
          method: values.method,
          status: "Pending",
          engine: values.engine,
          listenerStatus: null,
          listenerAddress: null,
          listenerCheckedAt: null,
          listenerFingerprint: null,
          servedCertificateExpiresAt: null,
          servedCertificateObservedAt: null,
          expectedFingerprint: certificate.fingerprint,
        },
        setWhere: isNull(deployments.hostId),
      })
      .returning({ id: deployments.id });
    return linked ? "linked" : "duplicate";
  });
}

type DeploymentOwner = { hostId: string } | { certificateId: string };

export async function updateDeploymentEndpoint(
  db: Database,
  owner: DeploymentOwner,
  id: string,
  endpoint: string,
  engine?: string | null,
  method?: typeof deployments.$inferSelect.method,
) {
  const ownerId = "hostId" in owner ? owner.hostId : owner.certificateId;
  if (!inventoryId.test(id) || !inventoryId.test(ownerId)) return "missing";

  const ownerColumn =
    "hostId" in owner ? deployments.hostId : deployments.certificateId;
  const targetChanged = or(
    sql`${deployments.endpoint} <> ${endpoint}`,
    engine === undefined
      ? undefined
      : sql`${deployments.engine} is distinct from ${engine}`,
    method === undefined ? undefined : sql`${deployments.method} <> ${method}`,
  );
  try {
    const [updated] = await db
      .update(deployments)
      .set({
        endpoint,
        engine,
        method,
        status: sql`case when ${deployments.endpoint} <> ${endpoint} then 'Pending' else ${deployments.status} end`,
        listenerStatus: sql`case when ${targetChanged} then null else ${deployments.listenerStatus} end`,
        listenerAddress: sql`case when ${targetChanged} then null else ${deployments.listenerAddress} end`,
        listenerCheckedAt: sql`case when ${targetChanged} then null else ${deployments.listenerCheckedAt} end`,
        listenerFingerprint: sql`case when ${targetChanged} then null else ${deployments.listenerFingerprint} end`,
        servedCertificateExpiresAt: sql`case when ${targetChanged} then null else ${deployments.servedCertificateExpiresAt} end`,
        servedCertificateObservedAt: sql`case when ${targetChanged} then null else ${deployments.servedCertificateObservedAt} end`,
      })
      .where(and(eq(deployments.id, id), eq(ownerColumn, ownerId)))
      .returning({ id: deployments.id });
    return updated ? "updated" : "missing";
  } catch (error) {
    if (
      violatesConstraint(
        error,
        "cbp_deployments_certificate_id_endpoint_unique",
      )
    )
      return "duplicate";
    throw error;
  }
}

export async function removeDeployment(
  db: Database,
  owner: DeploymentOwner,
  id: string,
) {
  const ownerId = "hostId" in owner ? owner.hostId : owner.certificateId;
  if (!inventoryId.test(id) || !inventoryId.test(ownerId)) return "missing";
  const ownerColumn =
    "hostId" in owner ? deployments.hostId : deployments.certificateId;
  const scope = and(eq(deployments.id, id), eq(ownerColumn, ownerId));

  return db.transaction(async (tx) => {
    const [deployment] = await tx
      .select({ hostId: deployments.hostId })
      .from(deployments)
      .where(scope);
    if (!deployment) return "missing";
    if (deployment.hostId) {
      // Claims and results take this lock before changing a job.
      await tx
        .select({ id: hosts.id })
        .from(hosts)
        .where(eq(hosts.id, deployment.hostId))
        .for("update");
    }
    const sameHost = deployment.hostId
      ? eq(deployments.hostId, deployment.hostId)
      : isNull(deployments.hostId);
    const [current] = await tx
      .select({ id: deployments.id })
      .from(deployments)
      .where(and(scope, sameHost))
      .for("update");
    if (!current) return "changed";

    const [schema] = await tx.execute<{ has_jobs: boolean }>(
      sql`select to_regclass('cbp_deployment_jobs') is not null as has_jobs`,
    );
    if (schema.has_jobs) {
      const [running] = await tx
        .select({ id: deploymentJobs.id })
        .from(deploymentJobs)
        .where(
          and(
            eq(deploymentJobs.deploymentId, id),
            eq(deploymentJobs.status, "Running"),
            gt(deploymentJobs.expiresAt, sql`now()`),
          ),
        );
      if (running) return "busy";
      await tx
        .update(deploymentJobs)
        .set({
          status: "Failed",
          detail: "The linked deployment was removed.",
          finishedAt: sql`now()`,
        })
        .where(
          and(
            eq(deploymentJobs.deploymentId, id),
            inArray(deploymentJobs.status, ["Queued", "Running"]),
          ),
        );
    }
    await tx.delete(deployments).where(scope);
    return "removed";
  });
}

export function registerHost(
  db: Database,
  values: Pick<
    typeof hosts.$inferInsert,
    "name" | "agentManaged" | "ansibleManaged" | "applianceType"
  >,
) {
  return db
    .insert(hosts)
    .values(values)
    .onConflictDoNothing({ target: hosts.name })
    .returning({ id: hosts.id });
}

export type HostReport = Pick<
  typeof hosts.$inferSelect,
  "hostname" | "fqdn" | "operatingSystem" | "architecture"
> & { lastProbedAt: Date; httpsListeners?: string | null };

export async function saveHostReport(
  db: Pick<Database, "update">,
  id: string,
  report: HostReport,
) {
  if (!inventoryId.test(id)) return false;
  const [updated] = await db
    .update(hosts)
    .set(report)
    .where(
      and(
        eq(hosts.id, id),
        or(
          isNull(hosts.lastProbedAt),
          lte(hosts.lastProbedAt, report.lastProbedAt),
        ),
      ),
    )
    .returning({ id: hosts.id });
  return Boolean(updated);
}

type HostPing = Pick<typeof hosts.$inferSelect, "lastPingAddress"> & {
  lastPingAt: Date;
  lastPingStatus: NonNullable<typeof hosts.$inferSelect.lastPingStatus>;
};

export function saveHostPing(db: Database, id: string, ping: HostPing) {
  return db
    .update(hosts)
    .set({
      ...ping,
      consecutivePingFailures:
        ping.lastPingStatus === "no-reply"
          ? sql`${hosts.consecutivePingFailures} + 1`
          : 0,
    })
    .where(
      and(
        eq(hosts.id, id),
        or(isNull(hosts.lastPingAt), lt(hosts.lastPingAt, ping.lastPingAt)),
      ),
    );
}

export async function removeHost(db: Database, id: string) {
  if (!inventoryId.test(id)) return false;
  return db.transaction(async (tx) => {
    const [host] = await tx
      .select({ id: hosts.id })
      .from(hosts)
      .where(eq(hosts.id, id))
      .for("update");
    if (!host) return false;
    const runIds = await tx
      .selectDistinct({ runId: deploymentJobs.runId })
      .from(deploymentJobs)
      .where(eq(deploymentJobs.hostId, id));
    await tx.delete(deploymentJobs).where(eq(deploymentJobs.hostId, id));
    for (const { runId } of runIds) {
      await tx
        .delete(deploymentRuns)
        .where(
          and(
            eq(deploymentRuns.id, runId),
            notExists(
              tx
                .select({ id: deploymentJobs.id })
                .from(deploymentJobs)
                .where(eq(deploymentJobs.runId, runId)),
            ),
          ),
        );
    }
    await tx.delete(hosts).where(eq(hosts.id, id));
    return true;
  });
}

export async function findHostAddress(db: Database, id: string) {
  if (!inventoryId.test(id)) return null;
  const [host] = await db
    .select({ name: hosts.name })
    .from(hosts)
    .where(eq(hosts.id, id));
  return host?.name ?? null;
}

export async function findHost(db: Database, id: string) {
  if (!inventoryId.test(id)) return null;
  const [host] = await db.select().from(hosts).where(eq(hosts.id, id));
  if (!host) return null;

  const endpoints = await db
    .select({
      id: deployments.id,
      endpoint: deployments.endpoint,
      engine: deployments.engine,
      method: deployments.method,
      status: deployments.status,
      listenerStatus: deployments.listenerStatus,
      listenerAddress: deployments.listenerAddress,
      listenerCheckedAt: deployments.listenerCheckedAt,
      listenerFingerprint: deployments.listenerFingerprint,
      servedCertificateExpiresAt: deployments.servedCertificateExpiresAt,
      servedCertificateObservedAt: deployments.servedCertificateObservedAt,
      certificateFingerprint: certificates.fingerprint,
      expectedFingerprint: deployments.expectedFingerprint,
      certificateId: certificates.id,
      domain: certificates.domain,
    })
    .from(deployments)
    .innerJoin(certificates, eq(deployments.certificateId, certificates.id))
    .where(eq(deployments.hostId, id))
    .orderBy(
      asc(deployments.endpoint),
      asc(certificates.domain),
      asc(deployments.id),
    );
  return {
    ...host,
    deployments: endpoints.map((deployment) =>
      deployment.method === "Ansible"
        ? {
            ...deployment,
            listenerStatus: null,
            listenerAddress: null,
            listenerCheckedAt: null,
            listenerFingerprint: null,
          }
        : deployment,
    ),
  };
}

export function listCertificates(
  db: Database,
  expiry?: { before: Date; after?: Date },
) {
  return db
    .select({
      ...certificateMetadata,
      total: sql<number>`count(${deployments.id})`.mapWith(Number),
      verified:
        sql<number>`count(*) filter (where ${deployments.status} = 'Verified')`.mapWith(
          Number,
        ),
    })
    .from(certificates)
    .leftJoin(deployments, eq(certificates.id, deployments.certificateId))
    .where(
      expiry
        ? and(
            lte(certificates.validUntil, expiry.before),
            expiry.after
              ? gt(certificates.validUntil, expiry.after)
              : undefined,
          )
        : undefined,
    )
    .groupBy(certificates.id)
    .orderBy(asc(certificates.validUntil), asc(certificates.domain));
}

export async function findCertificate(db: Database, id: string) {
  if (!inventoryId.test(id)) return null;
  const [certificate] = await db
    .select({ ...certificateMetadata, previousChainRevision })
    .from(certificates)
    .where(eq(certificates.id, id));
  if (!certificate) return null;
  const endpoints = await db
    .select({
      ...getTableColumns(deployments),
      hostName: hosts.name,
      agentEnrolled: sql<boolean>`${hostAgents.tokenHash} is not null`,
      ansibleManaged: hosts.ansibleManaged,
    })
    .from(deployments)
    .leftJoin(hosts, eq(deployments.hostId, hosts.id))
    .leftJoin(hostAgents, eq(deployments.hostId, hostAgents.hostId))
    .where(eq(deployments.certificateId, id))
    .orderBy(asc(deployments.endpoint));
  return { ...certificate, deployments: endpoints };
}

export async function findCertificateDomain(db: Database, id: string) {
  if (!inventoryId.test(id)) return null;
  const [certificate] = await db
    .select({ domain: certificates.domain })
    .from(certificates)
    .where(eq(certificates.id, id));
  return certificate?.domain ?? null;
}

export async function findPreviousCertificateChain(db: Database, id: string) {
  if (!inventoryId.test(id)) return null;
  const [certificate] = await db
    .select({
      domain: certificates.domain,
      fullchain: certificates.previousFullchain,
      revision: previousChainRevision,
    })
    .from(certificates)
    .where(eq(certificates.id, id));
  return certificate ?? null;
}

export function registerCertificate(
  db: Database,
  values: typeof certificates.$inferInsert,
) {
  return db
    .insert(certificates)
    .values(values)
    .onConflictDoNothing({ target: certificates.fingerprint })
    .returning({ id: certificates.id });
}

type CertificateReplacement = Pick<
  typeof certificates.$inferSelect,
  "issuer" | "serial" | "validFrom" | "validUntil" | "sans"
> & { fingerprint: string; fullchain: string };

export async function updateCertificateChain(
  db: Database,
  id: string,
  replacement: CertificateReplacement,
  expectedPrevious?: string,
) {
  if (!inventoryId.test(id)) return false;

  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          fingerprint: certificates.fingerprint,
          fullchain: certificates.fullchain,
          previousFullchain: certificates.previousFullchain,
        })
        .from(certificates)
        .where(eq(certificates.id, id))
        .for("update");
      if (!current) return false;
      if (
        expectedPrevious !== undefined &&
        current.previousFullchain !== expectedPrevious
      )
        return "changed" as const;

      const chainChanged = current.fullchain !== replacement.fullchain;
      await tx
        .update(certificates)
        .set({
          ...replacement,
          previousFullchain:
            chainChanged && current.fullchain
              ? current.fullchain
              : current.previousFullchain,
        })
        .where(eq(certificates.id, id));
      if (chainChanged || current.fingerprint !== replacement.fingerprint) {
        await tx
          .update(deployments)
          .set({
            status: "Pending",
            listenerStatus: null,
            listenerAddress: null,
            listenerCheckedAt: null,
            listenerFingerprint: null,
            expectedFingerprint: replacement.fingerprint,
          })
          .where(eq(deployments.certificateId, id));
      }
      return true;
    });
  } catch (error) {
    if (violatesConstraint(error, "cbp_certificates_fingerprint_unique")) {
      return "duplicate" as const;
    }
    throw error;
  }
}

function violatesConstraint(error: unknown, name: string) {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "constraint" in cause &&
    cause.constraint === name
  );
}

export async function removeCertificate(db: Database, id: string) {
  if (!inventoryId.test(id)) return false;
  return db.transaction(async (tx) => {
    const [certificate] = await tx
      .select({ id: certificates.id })
      .from(certificates)
      .where(eq(certificates.id, id))
      .for("update");
    if (!certificate) return false;
    const linked = await tx
      .select({ id: deployments.id })
      .from(deployments)
      .where(eq(deployments.certificateId, id));
    if (linked.length) {
      await tx
        .update(deploymentJobs)
        .set({
          status: "Failed",
          detail: "The certificate was removed.",
          finishedAt: sql`now()`,
        })
        .where(
          and(
            inArray(
              deploymentJobs.deploymentId,
              linked.map(({ id: deploymentId }) => deploymentId),
            ),
            inArray(deploymentJobs.status, ["Queued", "Running"]),
          ),
        );
    }
    await tx.delete(deploymentRuns).where(eq(deploymentRuns.certificateId, id));
    await tx.delete(certificates).where(eq(certificates.id, id));
    return true;
  });
}

export async function countOpenAlerts(db: Database) {
  const [row] = await db
    .select({ total: count() })
    .from(alerts)
    .where(and(isNull(alerts.resolvedAt), isNull(alerts.clearedAt)));
  return row?.total ?? 0;
}

export function listAlerts(db: Database, openOnly = false) {
  return db
    .select()
    .from(alerts)
    .where(
      openOnly
        ? and(isNull(alerts.resolvedAt), isNull(alerts.clearedAt))
        : undefined,
    )
    .orderBy(desc(alerts.detectedAt));
}

export function listChannels(db: Database) {
  return db.select().from(channels).orderBy(asc(channels.id));
}

export async function findChannel(db: Database, id: number) {
  const [channel] = await db.select().from(channels).where(eq(channels.id, id));
  return channel;
}

export function addChannel(
  db: Database,
  values: Pick<
    typeof channels.$inferInsert,
    | "provider"
    | "destination"
    | "severity"
    | "encryptedSettings"
    | "certificateIds"
  >,
) {
  return db
    .insert(channels)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: channels.id });
}

export function setChannelEnabled(db: Database, id: number, enabled: boolean) {
  return db
    .update(channels)
    .set({ enabled })
    .where(eq(channels.id, id))
    .returning({ id: channels.id });
}

export function updateChannel(
  db: Database,
  id: number,
  values: Pick<
    typeof channels.$inferInsert,
    "destination" | "severity" | "encryptedSettings" | "certificateIds"
  >,
) {
  return db
    .update(channels)
    .set(values)
    .where(eq(channels.id, id))
    .returning({ id: channels.id });
}

export async function bindChannelToCertificate(
  db: Database,
  id: number,
  certificateId: string,
) {
  if (!inventoryId.test(certificateId)) return false;
  const selected = sql`${certificateId}::uuid`;
  const [updated] = await db
    .update(channels)
    .set({
      certificateIds: sql`case when ${selected} = any(${channels.certificateIds})
      then ${channels.certificateIds}
      else array_append(coalesce(${channels.certificateIds}, '{}'::uuid[]), ${selected})
      end`,
    })
    .where(
      and(
        eq(channels.id, id),
        exists(
          db
            .select({ id: certificates.id })
            .from(certificates)
            .where(eq(certificates.id, certificateId)),
        ),
      ),
    )
    .returning({ id: channels.id });
  return Boolean(updated);
}

export function removeChannel(db: Database, id: number) {
  return db
    .delete(channels)
    .where(eq(channels.id, id))
    .returning({ id: channels.id });
}
