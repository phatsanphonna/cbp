import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  getTableColumns,
  gt,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { openDatabase } from "./index.js";
import {
  alerts,
  certificates,
  channels,
  deploymentJobs,
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

export function listCertificateOptions(db: Database) {
  return db
    .select({
      id: certificates.id,
      domain: certificates.domain,
      sans: certificates.sans,
      serial: certificates.serial,
    })
    .from(certificates)
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
      .select({ id: certificates.id })
      .from(certificates)
      .where(eq(certificates.id, values.certificateId))
      .for("key share");
    if (!certificate) return "missing";

    const [linked] = await tx
      .insert(deployments)
      .values(values)
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
    }
    await tx.delete(deployments).where(scope);
    return "removed";
  });
}

export function registerHost(
  db: Database,
  values: Pick<
    typeof hosts.$inferInsert,
    "name" | "agentManaged" | "ansibleManaged"
  >,
) {
  return db
    .insert(hosts)
    .values(values)
    .onConflictDoNothing({ target: hosts.name })
    .returning({ id: hosts.id });
}

type HostReport = Pick<
  typeof hosts.$inferSelect,
  "hostname" | "fqdn" | "operatingSystem" | "architecture" | "httpsListeners"
> & { lastProbedAt: Date };

export async function saveHostReport(
  db: Database,
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
    .set(ping)
    .where(
      and(
        eq(hosts.id, id),
        or(isNull(hosts.lastPingAt), lte(hosts.lastPingAt, ping.lastPingAt)),
      ),
    );
}

export async function removeHost(db: Database, id: string) {
  if (!inventoryId.test(id)) return false;
  const [removed] = await db
    .delete(hosts)
    .where(eq(hosts.id, id))
    .returning({ id: hosts.id });
  return Boolean(removed);
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
  return { ...host, deployments: endpoints };
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
          .set({ status: "Pending" })
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
  const [removed] = await db
    .delete(certificates)
    .where(eq(certificates.id, id))
    .returning({ id: certificates.id });
  return Boolean(removed);
}

export function listAlerts(db: Database, openOnly = false) {
  return db
    .select()
    .from(alerts)
    .where(openOnly ? isNull(alerts.resolvedAt) : undefined)
    .orderBy(desc(alerts.detectedAt));
}

export function listChannels(db: Database) {
  return db.select().from(channels).orderBy(asc(channels.id));
}

export function addChannel(
  db: Database,
  values: Pick<
    typeof channels.$inferInsert,
    "provider" | "destination" | "severity"
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
