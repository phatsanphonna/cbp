import { randomUUID } from "node:crypto";
import { dev } from "$app/env";
import { resolve } from "$app/paths";
import {
  deploymentJobStatuses,
  deploymentSources,
  cancelQueuedDeployment,
  findRecoverableDeployment,
  queueDeploymentRecovery,
  queueDeployments,
} from "@cbp/database/deployment-jobs";
import { findRenewalKey } from '@cbp/database/renewals';
import { fail, redirect, type RequestEvent } from "@sveltejs/kit";
import { deploymentServices } from "#lib/deployment-services.js";
import {
  packAnsibleDeployment,
  readAnsibleCredentials,
} from "./ansible-deployment-payload.js";
import { getAnsibleToken, getControllerToken } from "./controller-config.js";
import { getDatabase } from "./database.js";
import { readDeploymentKey } from "./deployment-key.js";
import { boundAnsibleCredential } from './ansible-credentials.js';
import { decryptSecret } from './encrypted-secret.js';
import { renewalKeyContext } from './lets-encrypt.js';
import { selfSignedKeyContext } from './self-signed-certificate.js';
import {
  discardDeploymentSecret,
  keepDeploymentSecret,
  readSavedCredential,
  saveCredential,
  savedCredentialsAvailable,
} from "./deployment-secrets.js";
import { hasTrustedTransport, type Connection } from "./trusted-transport.js";
import { hasPermission } from "./access-control.js";

const idPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
type DeploymentSelection = {
  id: string;
  endpoint: string;
  hostId: string;
  engine: string;
  method: "Agent" | "Ansible";
};

export async function loadAgentDeployments(
  ids: string[],
  connection: Connection,
) {
  const agentEnabled = Boolean(getControllerToken());
  const ansibleEnabled = Boolean(getAnsibleToken());
  const statuses = await deploymentJobStatuses(getDatabase(), ids);
  const httpsRequired =
    (agentEnabled || ansibleEnabled) && !hasTrustedTransport(connection);
  return {
    blocked: !agentEnabled || httpsRequired,
    ansibleEnabled,
    httpsRequired,
    statuses: Object.fromEntries(
      statuses.map(({ deploymentId, ...job }) => [
        deploymentId,
        {
          ...job,
          startedAt: job.startedAt?.toISOString(),
          finishedAt: job.finishedAt?.toISOString(),
        },
      ]),
    ),
  };
}

export async function deployCertificateAction(
  event: Pick<RequestEvent, "request" | "setHeaders" | "locals"> & Connection,
  certificateId: string,
  method: "Agent" | "Ansible" | null = "Agent",
) {
  const { request, setHeaders, locals } = event;
  setHeaders({ "cache-control": "no-store" });
  const reject = (status: number, message: string) =>
    fail(status, { deployError: message });
  if (!hasTrustedTransport(event)) {
    return reject(
      400,
      "A trusted HTTPS connection is required to submit a private key.",
    );
  }
  if (
    method &&
    !(method === "Agent" ? getControllerToken() : getAnsibleToken())
  )
    return reject(503, `${method} deployment is unavailable.`);
  const fields = await request.formData().catch(() => null);
  const selected = fields && readDeploymentTargets(fields);
  if (!fields || !selected?.length || !idPattern.test(certificateId)) {
    return reject(400, "Select linked hosts to deploy to.");
  }
  if (
    ["useSavedKey", "useSavedAnsible", "saveKey", "saveAnsible"].some(
      (name) => fields.get(name) === "yes",
    ) &&
    !hasPermission(locals.user, "credentials.manage")
  ) {
    return reject(403, "Credential management permission is required for saved credentials.");
  }
  const ids = selected.map(({ id }) => id);
  if (
    ids.some((id) => !idPattern.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    return reject(400, "Choose distinct linked deployments.");
  }

  const database = getDatabase();
  const owner = { certificateId };
  const sources = new Map(
    (await deploymentSources(database, owner, ids)).map((source) => [
      source.deploymentId,
      source,
    ]),
  );
  const targets = [];
  const hostIds = new Set<string>();
  for (const target of selected) {
    const source = sources.get(target.id);
    if (!source?.hostId)
      return reject(404, "A selected deployment has no linked host.");
    const { hostId, endpoint, engine, fullchain } = source;
    if (source.method !== target.method || (method && source.method !== method))
      return reject(
        400,
        "A selected deployment method changed. Refresh the page before deploying.",
      );
    if (
      endpoint !== target.endpoint ||
      hostId !== target.hostId ||
      engine !== target.engine
    ) {
      return reject(
        409,
        "A selected deployment changed. Refresh the page before deploying.",
      );
    }
    if (!engine || !deploymentServices.some((service) => service === engine)) {
      return reject(400, "Choose a supported web service for each deployment.");
    }
    if (source.method === "Ansible" && engine !== "Nginx")
      return reject(400, "Ansible deployment currently supports Nginx.");
    if (!fullchain)
      return reject(400, "Upload the public certificate chain first.");
    if (hostIds.has(hostId))
      return reject(400, "Select one endpoint per host.");
    hostIds.add(hostId);
    targets.push({
      deploymentId: source.deploymentId,
      hostId,
      endpoint,
      engine,
      fullchain,
      method: source.method,
    });
  }
  if (targets.some(({ method }) => method === "Agent") && !getControllerToken())
    return reject(503, "Agent deployment is unavailable.");
  if (targets.some(({ method }) => method === "Ansible") && !getAnsibleToken())
    return reject(503, "Ansible deployment is unavailable.");
  const nextChain = targets[0].fullchain;
  const upload = fields.get('privateKey');
  if (fields.get('useSavedKey') === 'yes') {
    if ((upload instanceof File && upload.size) || fields.get('privateKeyPem'))
      return reject(400, 'Choose either the saved private key or a new key.');
    try {
      fields.set('privateKeyPem', await readSavedCredential('certificate', certificateId));
    } catch {
      return reject(503, 'Could not read the saved private key from Vault.');
    }
  }
  if (
    fields.get('useRenewalKey') === 'yes' &&
    (upload === null || (upload instanceof File && upload.size === 0)) &&
    (fields.get('privateKeyPem') ?? '') === ''
  ) {
    const encrypted = await findRenewalKey(database, certificateId, nextChain);
    const pem = encrypted && (
      decryptSecret(encrypted, renewalKeyContext(certificateId)) ??
      decryptSecret(encrypted, selfSignedKeyContext(certificateId))
    );
    if (!pem) return reject(409, 'The stored renewal key is unavailable. Refresh and try again or supply a matching key.');
    fields.set('privateKeyPem', pem);
  }
  const key = await readDeploymentKey(fields, nextChain);
  if ("message" in key) return reject(400, key.message);
  const ansibleTargets = targets.filter(({ method }) => method === 'Ansible');
  const boundCredentials = new Map<string, Awaited<ReturnType<typeof boundAnsibleCredential>>>();
  if (savedCredentialsAvailable()) {
    try {
      for (const target of ansibleTargets) {
        if (fields.get(`ansibleOverride:${target.hostId}`) !== 'yes')
          boundCredentials.set(target.hostId, await boundAnsibleCredential(target.hostId));
      }
    } catch {
      return reject(503, 'Could not read a host’s bound credential from Vault.');
    }
  }
  const needsSharedAnsible = ansibleTargets.some(({ hostId }) => fields.get(`ansibleOverride:${hostId}`) !== 'yes' && !boundCredentials.get(hostId));
  if (fields.get('useSavedAnsible') === 'yes' && needsSharedAnsible) {
    try {
      const saved: unknown = JSON.parse(await readSavedCredential('ansible', certificateId));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid credential');
      for (const name of ['sshUsername', 'sshPassword', 'becomeMethod', 'suPassword']) {
        const value = (saved as Record<string, unknown>)[name];
        fields.delete(name);
        if (typeof value === 'string') fields.set(name, value);
      }
    } catch {
      return reject(503, 'Could not read the saved Ansible credentials from Vault.');
    }
  }
  const ansible = needsSharedAnsible
    ? readAnsibleCredentials(fields)
    : undefined;
  if (ansible?.message) return reject(400, ansible.message);
  const hostCredentials = new Map<string, NonNullable<typeof ansible>['credentials']>();
  for (const target of ansibleTargets) {
    if (fields.get(`ansibleOverride:${target.hostId}`) !== 'yes') continue;
    const credentials = readAnsibleCredentials(fields, target.hostId);
    if (credentials.message) return reject(400, `${target.endpoint}: ${credentials.message}`);
    hostCredentials.set(target.hostId, credentials.credentials);
  }
  let runId: string;
  let runSlug: string;
  let secretIds: string[] = [];
  let stage: 'save-key' | 'save-ansible' | 'store-job-secret' | 'queue' = 'save-key';
  try {
    if (fields.get('saveKey') === 'yes')
      await saveCredential('certificate', certificateId, key.pem);
    stage = 'save-ansible';
    if (fields.get('saveAnsible') === 'yes' && ansible?.credentials)
      await saveCredential('ansible', certificateId, JSON.stringify(ansible.credentials));
    stage = 'store-job-secret';
    const jobs = [];
    for (const target of targets) {
      const id = randomUUID();
      secretIds.push(id);
      await keepDeploymentSecret(
        id,
        target.method === "Ansible"
          ? packAnsibleDeployment(key.pem, hostCredentials.get(target.hostId) ?? boundCredentials.get(target.hostId)?.credentials ?? ansible?.credentials)
          : key.pem,
      );
      jobs.push({
        ...target,
        id,
      });
    }
    stage = 'queue';
    const result = await queueDeployments(database, owner, jobs);
    if (result.status !== "queued")
      await Promise.allSettled(jobs.map(({ id }) => discardDeploymentSecret(id)));
    if (result.status === "busy")
      return reject(
        409,
        `The host for ${result.endpoint} already has an active deployment.`,
      );
    if (result.status === "unenrolled")
      return reject(
        409,
        result.method === "Agent"
          ? `Enroll an agent for ${result.endpoint} before deploying.`
          : `Register an Ansible-managed host for ${result.endpoint} before deploying.`,
      );
    if (result.status === "changed")
      return reject(
        409,
        "A selected deployment changed. Refresh the page before deploying.",
      );
    if (result.status !== "queued")
      return reject(400, "Select one linked endpoint per host.");
    runId = result.id;
    runSlug = result.slug;
  } catch (error) {
    await Promise.allSettled(secretIds.map(discardDeploymentSecret));
    const failure = error as { code?: unknown; cause?: { code?: unknown }; response?: { statusCode?: unknown } };
    const code = failure?.response?.statusCode ?? failure?.code ?? failure?.cause?.code;
    console.error('Could not queue certificate deployment', { stage, code: typeof code === 'string' || typeof code === 'number' ? code : undefined });
    const message = stage === 'save-key'
      ? 'Could not save the private key in Vault.'
      : stage === 'save-ansible'
        ? 'Could not save the Ansible credentials in Vault.'
        : stage === 'store-job-secret'
          ? 'Could not store deployment credentials. Check Vault availability and permissions.'
          : 'Could not queue the deployment in the database.';
    return reject(503, message);
  }
  locals.auditTargetId = runId;
  redirect(303, resolve("/deployments/[id]", { id: runSlug }));
}

export async function recoverDeploymentAction(
  event: Pick<RequestEvent, "request" | "setHeaders" | "locals"> & Connection,
) {
  const { request, setHeaders, locals } = event;
  setHeaders({ "cache-control": "no-store" });
  const reject = (status: number, message: string) =>
    fail(status, { recoverError: message });
  if (!hasTrustedTransport(event))
    return reject(
      400,
      "A trusted HTTPS connection is required to submit a private key.",
    );
  const form = await request.formData().catch(() => null);
  const sourceId = form?.get("jobId");
  if (typeof sourceId !== "string" || !idPattern.test(sourceId))
    return reject(400, "Choose a deployment to recover.");
  let database: ReturnType<typeof getDatabase>;
  let source: Awaited<ReturnType<typeof findRecoverableDeployment>>;
  try {
    database = getDatabase();
    source = await findRecoverableDeployment(database, sourceId);
  } catch (error) {
    console.error("Could not load certificate deployment for recovery", error);
    const reason =
      error instanceof Error ? error.message : "Unknown database error";
    return reject(
      503,
      dev
        ? `Could not load this deployment for recovery: ${reason}`
        : "Could not load this deployment for recovery.",
    );
  }
  if (!source)
    return reject(409, "This deployment is no longer available for recovery.");
  if (!(source.method === "Agent" ? getControllerToken() : getAnsibleToken()))
    return reject(503, `${source.method} deployment is unavailable.`);
  let key: Awaited<ReturnType<typeof readDeploymentKey>>;
  try {
    key = await readDeploymentKey(form!, source.fullchain);
  } catch (error) {
    console.error("Could not read private key for deployment recovery", error);
    return reject(
      400,
      "Could not read the uploaded private key. Choose the file again and retry.",
    );
  }
  if ("message" in key) return reject(400, key.message);
  const ansible =
    source.method === "Ansible" ? readAnsibleCredentials(form!) : undefined;
  if (ansible?.message) return reject(400, ansible.message);
  const id = randomUUID();
  let result;
  try {
    await keepDeploymentSecret(
      id,
      packAnsibleDeployment(key.pem, ansible?.credentials),
    );
    result = await queueDeploymentRecovery(database, source.id, id);
  } catch (error) {
    await Promise.allSettled([discardDeploymentSecret(id)]);
    console.error("Could not queue certificate deployment recovery", error);
    return reject(503, "Could not queue the redeployment.");
  }
  if (result.status !== "queued") await Promise.allSettled([discardDeploymentSecret(id)]);
  if (result.status === "busy")
    return reject(409, "This host already has an active deployment.");
  if (result.status !== "queued")
    return reject(
      409,
      "The host or deployment is no longer available for recovery.",
    );
  locals.auditTargetId = result.id;
  redirect(303, resolve("/deployments/[id]", { id: result.slug }));
}

export async function cancelQueuedDeploymentAction(
  event: Pick<RequestEvent, "request" | "setHeaders" | "locals" | "params">,
) {
  const { request, setHeaders, locals } = event;
  setHeaders({ "cache-control": "no-store" });
  if (!hasPermission(locals.user, "deployments.manage"))
    return fail(403, { cancelError: "Deployment management permission is required." });
  const form = await request.formData().catch(() => null);
  const id = form?.get("jobId");
  if (typeof id !== "string" || !idPattern.test(id))
    return fail(400, { cancelError: "Choose a queued deployment to cancel." });
  const result = await cancelQueuedDeployment(
    getDatabase(),
    id,
    event.params.id ?? '',
  );
  if (result === "missing")
    return fail(404, { cancelError: "This deployment could not be found." });
  if (result === "not-queued")
    return fail(409, {
      cancelError:
        "This deployment is no longer queued and cannot be canceled.",
    });
  await Promise.allSettled([discardDeploymentSecret(id)]);
  locals.auditTargetId = id;
  return { cancelMessage: "Queued deployment canceled." };
}

function readDeploymentTargets(fields: FormData) {
  const selected: DeploymentSelection[] = [];
  for (const value of fields.getAll("deploymentTarget")) {
    if (typeof value !== "string") return null;
    let target: unknown;
    try {
      target = JSON.parse(value);
    } catch {
      return null;
    }
    if (!Array.isArray(target) || target.length !== 5) return null;
    const [id, endpoint, hostId, engine, method] = target;
    if (
      typeof id !== "string" ||
      typeof endpoint !== "string" ||
      typeof hostId !== "string" ||
      typeof engine !== "string" ||
      (method !== "Agent" && method !== "Ansible") ||
      !idPattern.test(hostId)
    )
      return null;
    selected.push({ id, endpoint, hostId, engine, method });
  }
  return selected;
}
