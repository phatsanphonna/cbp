import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { withAgentHost } from './host-agents.js';
import type { openDatabase } from './index.js';
import { type HostReport, saveHostReport } from './inventory.js';
import {
  certificates,
  deploymentJobs,
  deploymentRuns,
  deployments,
  hostAgents,
  hosts,
} from './inventory-schema.js';

type Database = ReturnType<typeof openDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Owner = { hostId: string } | { certificateId: string };
type Job = typeof deploymentJobs.$inferSelect;
type Worker = { method: 'Agent'; hash: string } | { method: 'Ansible'; endpoint: string };
const inventoryId = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
// Job rows keep history after a host or deployment is deleted; new jobs always have both.
type DeploymentPayload = Pick<Job, 'id' | 'engine' | 'endpoint' | 'fullchain'> & {
  deploymentId: string;
  hostId: string;
  method?: Job['method'];
};
const active = inArray(deploymentJobs.status, ['Queued', 'Running']);
const unexpired = gt(deploymentJobs.expiresAt, sql`now()`);
const expired = lte(deploymentJobs.expiresAt, sql`now()`);
const expiryDetail = sql<string>`case
  when ${deploymentJobs.method} = 'Ansible' and ${deploymentJobs.status} = 'Queued'
    then 'The job expired before the Ansible runner claimed it.'
  when ${deploymentJobs.method} = 'Ansible'
    then 'The job expired while waiting for the Ansible runner to report a result.'
  when ${deploymentJobs.status} = 'Queued'
  then 'The job expired before the controller claimed it for the agent.'
  else 'The job expired while waiting for the agent to report a result.' end`;
const jobStatus = {
  status: sql<
    Job['status']
  >`case when ${active} and ${expired} then 'Expired' else ${deploymentJobs.status} end`,
  detail: sql<
    string | null
  >`case when ${active} and ${expired} then ${expiryDetail} else ${deploymentJobs.detail} end`,
  expiresIn: sql<number>`extract(epoch from (${deploymentJobs.expiresAt} - now())) * 1000`.mapWith(
    Number,
  ),
};
const runOrder = sql`${deploymentRuns.submittedAt} desc nulls last`;
const adjectives =
  'bold bright calm clever crisp gentle grand lively lucky merry nimble quiet steady swift wild'.split(
    ' ',
  );
const animals =
  'badger bear crane dolphin eagle falcon finch fox gecko hare heron koala otter owl panda raven tiger wolf'.split(
    ' ',
  );
const slugCharacters = 'abcdefghjkmnpqrstuvwxyz23456789';

function deploymentSlug() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const adjective = adjectives[randomInt(adjectives.length)];
  const animal = animals[randomInt(animals.length)];
  const suffix = Array.from(
    { length: 4 },
    () => slugCharacters[randomInt(slugCharacters.length)],
  ).join('');
  return ['deploy', date, adjective, animal, suffix].join('-');
}

export async function expireDeploymentJobs(db: Database) {
  await db
    .update(deploymentJobs)
    .set({ status: 'Expired', detail: expiryDetail, finishedAt: sql`now()` })
    .where(and(active, expired));
}

export function deploymentJobStatuses(db: Database, ids: string[]) {
  if (!ids.length) return [];
  return db
    .selectDistinctOn([deploymentJobs.deploymentId], {
      jobId: deploymentJobs.id,
      deploymentId: deploymentJobs.deploymentId,
      runSlug: deploymentRuns.slug,
      startedAt: deploymentJobs.startedAt,
      finishedAt: deploymentJobs.finishedAt,
      ...jobStatus,
    })
    .from(deploymentJobs)
    .innerJoin(deploymentRuns, eq(deploymentRuns.id, deploymentJobs.runId))
    .where(inArray(deploymentJobs.deploymentId, ids))
    .orderBy(deploymentJobs.deploymentId, runOrder, desc(deploymentRuns.id));
}

const runFields = {
  id: deploymentRuns.id,
  slug: deploymentRuns.slug,
  submittedAt: deploymentRuns.submittedAt,
  certificateId: deploymentRuns.certificateId,
  domain: deploymentRuns.certificateName,
  sans: deploymentRuns.certificateSans,
  fingerprint: deploymentRuns.certificateFingerprint,
};

export function listDeploymentRuns(db: Database, offset: number, limit: number) {
  return db
    .selectDistinct({
      ...runFields,
      targets: sql<number>`count(${deploymentJobs.id})`.mapWith(Number),
      deployed: sql<number>`count(*) filter (where ${deploymentJobs.status} = 'Deployed')`.mapWith(
        Number,
      ),
      active: sql<number>`count(*) filter (where ${active} and ${unexpired})`.mapWith(Number),
      nextExpiryIn: sql<
        number | null
      >`extract(epoch from (min(${deploymentJobs.expiresAt}) filter (where ${active} and ${unexpired}) - now())) * 1000`.mapWith(
        (value): number | null => Number(value),
      ),
    })
    .from(deploymentRuns)
    .leftJoin(deploymentJobs, eq(deploymentJobs.runId, deploymentRuns.id))
    .groupBy(deploymentRuns.id)
    .orderBy(runOrder, desc(deploymentRuns.id))
    .offset(offset)
    .limit(limit);
}

export async function findDeploymentRun(db: Database, identity: { id: string } | { slug: string }) {
  const [run] = await db
    .select(runFields)
    .from(deploymentRuns)
    .where(
      'id' in identity
        ? eq(deploymentRuns.id, identity.id)
        : eq(deploymentRuns.slug, identity.slug),
    );
  return run ?? null;
}

export function listDeploymentTargets(
  db: Database,
  filter: { runId: string } | { jobIds: string[] },
) {
  return db
    .select({
      id: deploymentJobs.id,
      runSlug: deploymentRuns.slug,
      endpoint: deploymentJobs.endpoint,
      engine: deploymentJobs.engine,
      method: deploymentJobs.method,
      hostId: deploymentJobs.hostId,
      hostName: deploymentJobs.hostName,
      agentSeenAt: hosts.agentSeenAt,
      certificateId: deployments.certificateId,
      domain: deploymentRuns.certificateName,
      sans: deploymentRuns.certificateSans,
      startedAt: deploymentJobs.startedAt,
      finishedAt: deploymentJobs.finishedAt,
      log: deploymentJobs.log,
      recoverable: sql<boolean>`${deploymentJobs.status} in ('Deployed', 'Failed') and ${deploymentJobs.hostId} is not null and ${deploymentJobs.deploymentId} is not null`,
      ...jobStatus,
    })
    .from(deploymentJobs)
    .innerJoin(deploymentRuns, eq(deploymentRuns.id, deploymentJobs.runId))
    .leftJoin(deployments, eq(deployments.id, deploymentJobs.deploymentId))
    .leftJoin(hosts, eq(hosts.id, deploymentJobs.hostId))
    .where(
      'runId' in filter
        ? eq(deploymentJobs.runId, filter.runId)
        : inArray(deploymentJobs.id, filter.jobIds),
    )
    .orderBy(deploymentJobs.hostName, deploymentJobs.endpoint, deploymentJobs.id);
}

export function listAnsibleDeploymentTargets(db: Database) {
  return db
    .selectDistinct({
      hostId: hosts.id,
      hostName: hosts.name,
      hostname: hosts.hostname,
      fqdn: hosts.fqdn,
      lastPingAddress: hosts.lastPingAddress,
      endpoint: deployments.endpoint,
    })
    .from(deployments)
    .innerJoin(hosts, eq(hosts.id, deployments.hostId))
    .where(
      and(
        eq(deployments.method, 'Ansible'),
        eq(deployments.engine, 'Nginx'),
        eq(hosts.ansibleManaged, true),
      ),
    )
    .orderBy(asc(hosts.name), asc(deployments.endpoint));
}

export function deploymentSources(db: Pick<Database, 'select'>, owner: Owner, ids: string[]) {
  const scope =
    'hostId' in owner
      ? eq(deployments.hostId, owner.hostId)
      : eq(deployments.certificateId, owner.certificateId);
  return db
    .select({
      deploymentId: deployments.id,
      hostId: deployments.hostId,
      engine: deployments.engine,
      endpoint: deployments.endpoint,
      method: deployments.method,
      fullchain: certificates.fullchain,
      certificateName: certificates.domain,
      certificateSans: certificates.sans,
      certificateFingerprint: certificates.fingerprint,
      expectedFingerprint: deployments.expectedFingerprint,
    })
    .from(deployments)
    .innerJoin(certificates, eq(certificates.id, deployments.certificateId))
    .where(and(inArray(deployments.id, ids), scope));
}

async function agentHash(db: Transaction, hostId: string) {
  const [agent] = await db
    .select({ hash: hostAgents.tokenHash })
    .from(hostAgents)
    .where(eq(hostAgents.hostId, hostId));
  return agent?.hash;
}

async function createDeploymentRun(
  tx: Transaction,
  certificateId: string,
  certificate: { name: string; sans: string[]; fingerprint: string | null },
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [run] = await tx
      .insert(deploymentRuns)
      .values({
        certificateId,
        certificateName: certificate.name,
        certificateSans: certificate.sans,
        certificateFingerprint: certificate.fingerprint,
        slug: deploymentSlug(),
        submittedAt: sql`clock_timestamp()`,
      })
      .onConflictDoNothing({ target: deploymentRuns.slug })
      .returning({ id: deploymentRuns.id, slug: deploymentRuns.slug });
    if (run) return run;
  }
  throw new Error('Could not allocate a unique deployment job ID');
}

export async function queueDeployments(
  db: Database,
  owner: { certificateId: string },
  payloads: DeploymentPayload[],
  defaultMethod: Job['method'] = 'Agent',
) {
  const hostIds = [...new Set(payloads.map(({ hostId }) => hostId))];
  if (!hostIds.length || hostIds.length !== payloads.length) return { status: 'invalid' } as const;
  const methodFor = (payload: DeploymentPayload) => payload.method ?? defaultMethod;

  return db.transaction(async (tx) => {
    // Use the same host locks as claim, completion and deletion, in a consistent order for batches.
    const eligible = await tx
      .select({ id: hosts.id, name: hosts.name })
      .from(hosts)
      .where(
        or(
          ...payloads.map((payload) =>
            and(
              eq(hosts.id, payload.hostId),
              eq(methodFor(payload) === 'Agent' ? hosts.agentManaged : hosts.ansibleManaged, true),
            ),
          ),
        ),
      )
      .orderBy(asc(hosts.id))
      .for('update');
    const eligibleIds = new Set(eligible.map(({ id }) => id));
    const hostNames = new Map(eligible.map(({ id, name }) => [id, name]));
    const agentHostIds = payloads
      .filter((payload) => methodFor(payload) === 'Agent')
      .map(({ hostId }) => hostId);
    const agents = agentHostIds.length
      ? await tx
          .select({ hostId: hostAgents.hostId, hash: hostAgents.tokenHash })
          .from(hostAgents)
          .where(and(inArray(hostAgents.hostId, agentHostIds), isNotNull(hostAgents.tokenHash)))
      : [];
    const hashes = new Map(agents.map(({ hostId, hash }) => [hostId, hash]));
    const busy = await tx
      .select({ hostId: deploymentJobs.hostId })
      .from(deploymentJobs)
      .where(and(inArray(deploymentJobs.hostId, hostIds), active, unexpired));
    const busyHosts = new Set(busy.map(({ hostId }) => hostId));
    const ids = payloads.map(({ deploymentId }) => deploymentId);
    const sources = await deploymentSources(tx, owner, ids).for('share', {
      of: deployments,
    });
    const current = new Map(sources.map((source) => [source.deploymentId, source]));
    const expiresAt = sql`now() + interval '10 minutes'`;
    const rows: (DeploymentPayload & {
      hostName: string;
      agentHash: string | null;
      method: Job['method'];
      status: 'Queued';
      expiresAt: typeof expiresAt;
    })[] = [];
    for (const payload of payloads) {
      const { deploymentId, hostId, endpoint, engine, fullchain } = payload;
      const method = methodFor(payload);
      const hash = hashes.get(hostId) ?? null;
      if (!eligibleIds.has(hostId) || (method === 'Agent' && !hash))
        return { status: 'unenrolled', endpoint, method } as const;
      if (busyHosts.has(hostId)) return { status: 'busy', endpoint } as const;
      const source = current.get(deploymentId);
      if (
        !source ||
        source.method !== method ||
        source.hostId !== hostId ||
        source.endpoint !== endpoint ||
        source.engine !== engine ||
        source.fullchain !== fullchain
      ) {
        return { status: 'changed', endpoint } as const;
      }
      rows.push({
        ...payload,
        hostName: hostNames.get(hostId)!,
        agentHash: hash,
        method,
        status: 'Queued',
        expiresAt,
      });
    }
    await tx
      .update(deploymentJobs)
      .set({ status: 'Expired', detail: expiryDetail, finishedAt: sql`now()` })
      .where(and(inArray(deploymentJobs.hostId, hostIds), active, expired));
    const firstSource = current.get(payloads[0].deploymentId)!;
    const run = await createDeploymentRun(tx, owner.certificateId, {
      name: firstSource.certificateName,
      sans: firstSource.certificateSans,
      fingerprint: firstSource.certificateFingerprint,
    });
    await tx.insert(deploymentJobs).values(rows.map((row) => ({ ...row, runId: run.id })));
    return { status: 'queued', ...run } as const;
  });
}

export async function findRecoverableDeployment(db: Database, jobId: string) {
  if (!inventoryId.test(jobId)) return null;
  const [job] = await db
    .select({
      id: deploymentJobs.id,
      deploymentId: deploymentJobs.deploymentId,
      hostId: deploymentJobs.hostId,
      method: deploymentJobs.method,
      endpoint: deploymentJobs.endpoint,
      engine: deploymentJobs.engine,
      fullchain: deploymentJobs.fullchain,
    })
    .from(deploymentJobs)
    .where(
      and(
        eq(deploymentJobs.id, jobId),
        inArray(deploymentJobs.status, ['Deployed', 'Failed']),
        isNotNull(deploymentJobs.deploymentId),
        isNotNull(deploymentJobs.hostId),
      ),
    );
  return job ?? null;
}

export async function queueDeploymentRecovery(db: Database, sourceId: string, id: string) {
  const source = await findRecoverableDeployment(db, sourceId);
  if (!source?.hostId || !source.deploymentId) return { status: 'missing' } as const;
  const { hostId, deploymentId } = source;

  return db.transaction(async (tx) => {
    const [host] = await tx
      .select({
        id: hosts.id,
        name: hosts.name,
        agentManaged: hosts.agentManaged,
        ansibleManaged: hosts.ansibleManaged,
      })
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .for('update');
    if (!host || (source.method === 'Agent' ? !host.agentManaged : !host.ansibleManaged))
      return { status: 'missing' } as const;

    const [deployment] = await tx
      .select({
        id: deployments.id,
        certificateId: deployments.certificateId,
        endpoint: deployments.endpoint,
        engine: deployments.engine,
        method: deployments.method,
        hostId: deployments.hostId,
        certificateName: certificates.domain,
        certificateSans: certificates.sans,
        certificateFingerprint: certificates.fingerprint,
      })
      .from(deployments)
      .innerJoin(certificates, eq(certificates.id, deployments.certificateId))
      .where(and(eq(deployments.id, deploymentId), eq(deployments.hostId, host.id)))
      .for('share', { of: deployments });
    if (
      !deployment ||
      deployment.endpoint !== source.endpoint ||
      deployment.engine !== source.engine ||
      deployment.method !== source.method
    )
      return { status: 'missing' } as const;

    const [busy] = await tx
      .select({ id: deploymentJobs.id })
      .from(deploymentJobs)
      .where(and(eq(deploymentJobs.hostId, host.id), active, unexpired));
    if (busy) return { status: 'busy' } as const;

    const currentAgentHash = source.method === 'Agent' ? await agentHash(tx, host.id) : null;
    if (source.method === 'Agent' && !currentAgentHash) return { status: 'missing' } as const;

    const [oldRun] = await tx
      .select({
        certificateName: deploymentRuns.certificateName,
        certificateSans: deploymentRuns.certificateSans,
        certificateFingerprint: deploymentRuns.certificateFingerprint,
      })
      .from(deploymentJobs)
      .innerJoin(deploymentRuns, eq(deploymentRuns.id, deploymentJobs.runId))
      .where(eq(deploymentJobs.id, source.id));
    if (!oldRun) return { status: 'missing' } as const;

    const run = await createDeploymentRun(tx, deployment.certificateId, {
      name: oldRun.certificateName,
      sans: oldRun.certificateSans,
      fingerprint: oldRun.certificateFingerprint,
    });
    await tx.insert(deploymentJobs).values({
      id,
      runId: run.id,
      deploymentId: deployment.id,
      hostId: host.id,
      hostName: host.name,
      agentHash: currentAgentHash,
      method: source.method,
      endpoint: source.endpoint,
      engine: source.engine,
      fullchain: source.fullchain,
      status: 'Queued',
      recovery: true,
      expiresAt: sql`now() + interval '10 minutes'`,
    });
    return { status: 'queued', ...run } as const;
  });
}

function withDeploymentHost<T>(
  db: Database,
  hostId: string,
  worker: Worker,
  work: (tx: Transaction) => Promise<T>,
) {
  if (worker.method === 'Agent') {
    return withAgentHost(db, hostId, async (tx) =>
      (await agentHash(tx, hostId)) === worker.hash ? work(tx) : ('denied' as const),
    );
  }
  return db.transaction(async (tx) => {
    const [host] = await tx
      .select({ id: hosts.id })
      .from(hosts)
      .where(and(eq(hosts.id, hostId), eq(hosts.ansibleManaged, true)))
      .for('update');
    return host ? work(tx) : ('missing' as const);
  });
}

function workerJobs(hostId: string, worker: Worker) {
  return and(
    eq(deploymentJobs.hostId, hostId),
    eq(deploymentJobs.method, worker.method),
    worker.method === 'Agent'
      ? eq(deploymentJobs.agentHash, worker.hash)
      : eq(deploymentJobs.endpoint, worker.endpoint),
  );
}

export function appendDeploymentLog(
  db: Database,
  hostId: string,
  identity: string | Worker,
  jobId: string,
  message: string,
) {
  const worker =
    typeof identity === 'string' ? ({ method: 'Agent', hash: identity } as const) : identity;
  return withDeploymentHost(db, hostId, worker, async (tx) => {
    const [job] = await tx
      .update(deploymentJobs)
      .set({
        log: sql`right(${deploymentJobs.log} || to_char(now(), 'YYYY-MM-DD HH24:MI:SS') || ' ' || ${message} || E'\\n', 65536)`,
      })
      .where(
        and(
          workerJobs(hostId, worker),
          eq(deploymentJobs.id, jobId),
          eq(deploymentJobs.status, 'Running'),
          unexpired,
        ),
      )
      .returning({ id: deploymentJobs.id });
    return job ? 'ok' : 'missing';
  });
}

export function cancelQueuedDeployment(db: Database, id: string, runSlug: string) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({ hostId: deploymentJobs.hostId, runId: deploymentJobs.runId })
      .from(deploymentJobs)
      .innerJoin(deploymentRuns, eq(deploymentRuns.id, deploymentJobs.runId))
      .where(and(eq(deploymentJobs.id, id), eq(deploymentRuns.slug, runSlug)));
    if (!job) return 'missing' as const;
    if (job.hostId) {
      await tx.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, job.hostId)).for('update');
    }
    const [cancelled] = await tx
      .update(deploymentJobs)
      .set({
        status: 'Failed',
        detail: 'Canceled by an administrator before a worker claimed the deployment.',
        finishedAt: sql`now()`,
        log: sql`right(${deploymentJobs.log} || to_char(now(), 'YYYY-MM-DD HH24:MI:SS') || ' Deployment canceled before worker claim.' || E'\\n', 65536)`,
      })
      .where(
        and(
          eq(deploymentJobs.id, id),
          eq(deploymentJobs.runId, job.runId),
          eq(deploymentJobs.status, 'Queued'),
        ),
      )
      .returning({ id: deploymentJobs.id });
    return cancelled ? ('cancelled' as const) : ('not-queued' as const);
  });
}

export function claimDeployment<T>(
  db: Database,
  hostId: string,
  identity: string | Worker,
  materialize: (job: Job, collectHostFacts: boolean) => T,
) {
  const worker =
    typeof identity === 'string' ? ({ method: 'Agent', hash: identity } as const) : identity;
  return withDeploymentHost(db, hostId, worker, async (tx) => {
    const [job] = await tx
      .select()
      .from(deploymentJobs)
      .where(and(workerJobs(hostId, worker), eq(deploymentJobs.status, 'Queued'), unexpired))
      .limit(1)
      .for('update');
    if (!job) return null;
    const [source] = job.deploymentId
      ? await deploymentSources(tx, { hostId }, [job.deploymentId]).for('share', {
          of: deployments,
        })
      : [];
    if (
      !job.deploymentId ||
      !source ||
      source.method !== worker.method ||
      source.endpoint !== job.endpoint ||
      source.engine !== job.engine ||
      (!job.recovery && source.fullchain !== job.fullchain)
    ) {
      await tx
        .update(deploymentJobs)
        .set({
          status: 'Failed',
          detail: 'The linked deployment or certificate changed before the job was claimed.',
          finishedAt: sql`now()`,
        })
        .where(eq(deploymentJobs.id, job.id));
      return null;
    }
    const collectHostFacts = worker.method === 'Ansible' && !(await agentHash(tx, hostId));
    const payload = materialize(job, collectHostFacts);
    await tx
      .update(deploymentJobs)
      .set({
        status: 'Running',
        startedAt: sql`now()`,
        expiresAt: sql`now() + interval '5 minutes'`,
      })
      .where(eq(deploymentJobs.id, job.id));
    return payload;
  });
}

export function saveAnsibleHostReport(
  db: Database,
  hostId: string,
  endpoint: string,
  jobId: string,
  report: Omit<HostReport, 'httpsListeners'>,
) {
  const worker = { method: 'Ansible', endpoint } as const;
  return withDeploymentHost(db, hostId, worker, async (tx) => {
    const [job] = await tx
      .select({ id: deploymentJobs.id })
      .from(deploymentJobs)
      .where(
        and(
          workerJobs(hostId, worker),
          eq(deploymentJobs.id, jobId),
          eq(deploymentJobs.status, 'Running'),
          unexpired,
        ),
      );
    if (!job) return 'missing';
    if (!(await agentHash(tx, hostId))) await saveHostReport(tx, hostId, report);
    return 'ok';
  });
}

export function finishDeployment(
  db: Database,
  hostId: string,
  identity: string | Worker,
  id: string,
  detail: string | null,
  servedExpiry?: Date,
) {
  const worker =
    typeof identity === 'string' ? ({ method: 'Agent', hash: identity } as const) : identity;
  return withDeploymentHost(db, hostId, worker, async (tx) => {
    const owned = and(eq(deploymentJobs.id, id), workerJobs(hostId, worker));
    const status = detail ? 'Failed' : 'Deployed';
    const [job] = await tx
      .update(deploymentJobs)
      .set({
        status,
        detail,
        finishedAt: sql`now()`,
      })
      .where(and(owned, eq(deploymentJobs.status, 'Running'), unexpired))
      .returning({
        deploymentId: deploymentJobs.deploymentId,
        hostId: deploymentJobs.hostId,
        runId: deploymentJobs.runId,
        endpoint: deploymentJobs.endpoint,
        engine: deploymentJobs.engine,
        fullchain: deploymentJobs.fullchain,
      });
    if (!job) {
      const [completed] = await tx
        .select({ id: deploymentJobs.id })
        .from(deploymentJobs)
        .where(and(owned, eq(deploymentJobs.status, status)));
      return completed ? 'ok' : 'missing';
    }
    if (!job.deploymentId || !job.hostId) return 'missing';
    if (worker.method === 'Ansible') {
      await tx
        .update(hosts)
        .set({ ansibleRunAt: sql`now()`, ansibleSucceeded: !detail })
        .where(eq(hosts.id, hostId));
    }
    if (status === 'Deployed') {
      const [run] = await tx
        .select({ fingerprint: deploymentRuns.certificateFingerprint })
        .from(deploymentRuns)
        .where(eq(deploymentRuns.id, job.runId));
      await tx
        .update(deployments)
        .set({
          status: 'Verified',
          expectedFingerprint: run?.fingerprint ?? null,
          listenerStatus: null,
          listenerAddress: null,
          listenerCheckedAt: null,
          listenerFingerprint: null,
          servedCertificateExpiresAt: worker.method === 'Ansible' ? servedExpiry : undefined,
          servedCertificateObservedAt:
            worker.method === 'Ansible' && servedExpiry ? sql`now()` : undefined,
        })
        .where(
          and(
            eq(deployments.id, job.deploymentId),
            eq(deployments.hostId, hostId),
            eq(deployments.endpoint, job.endpoint),
            eq(deployments.engine, job.engine),
            eq(deployments.method, worker.method),
          ),
        );
    }
    return 'ok';
  });
}
