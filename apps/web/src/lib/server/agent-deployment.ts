import { randomUUID } from "node:crypto";
import { dev } from '$app/env';
import { resolve } from "$app/paths";
import {
  deploymentJobStatuses,
  deploymentSources,
  cancelQueuedDeployment,
  findRecoverableDeployment,
  queueDeploymentRecovery,
  queueDeployments,
} from "@cbp/database/deployment-jobs";
import { fail, redirect, type RequestEvent } from "@sveltejs/kit";
import { deploymentServices } from "#lib/deployment-services.js";
import { packAnsibleDeployment, readAnsibleCredentials } from './ansible-deployment-payload.js';
import {
  getAnsibleToken,
  getControllerToken,
} from "./controller-config.js";
import { getDatabase } from "./database.js";
import { readDeploymentKey } from "./deployment-key.js";
import { discardDeploymentSecret, keepDeploymentSecret } from "./deployment-secrets.js";
import { hasTrustedTransport, type Connection } from "./trusted-transport.js";

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
  const httpsRequired = (agentEnabled || ansibleEnabled) && !hasTrustedTransport(connection);
  return {
    blocked: !agentEnabled || httpsRequired,
    ansibleEnabled,
    httpsRequired,
    statuses: Object.fromEntries(
      statuses.map(({ deploymentId, ...job }) => [deploymentId, {
        ...job,
        startedAt: job.startedAt?.toISOString(),
        finishedAt: job.finishedAt?.toISOString(),
      }]),
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
  if (method && !(method === "Agent" ? getControllerToken() : getAnsibleToken()))
    return reject(503, `${method} deployment is unavailable.`);
  const fields = await request.formData().catch(() => null);
  const selected = fields && readDeploymentTargets(fields);
  if (!fields || !selected?.length || !idPattern.test(certificateId)) {
    return reject(400, "Select linked hosts to deploy to.");
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
      return reject(400, 'Ansible deployment currently supports Nginx.');
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
  const key = await readDeploymentKey(fields, targets[0].fullchain);
  if ("message" in key) return reject(400, key.message);
  const ansible = targets.some(({ method }) => method === "Ansible")
    ? readAnsibleCredentials(fields)
    : undefined;
  if (ansible?.message) return reject(400, ansible.message);
  let runId: string;
  let runSlug: string;
  let secretIds: string[] = [];
  try {
    const jobs = targets.map((target) => {
      const id = randomUUID();
      keepDeploymentSecret(
        id,
        target.method === "Ansible"
          ? packAnsibleDeployment(key.pem, ansible!.credentials)
          : key.pem,
      );
      secretIds.push(id);
      return {
        ...target,
        id,
      };
    });
    const result = await queueDeployments(database, owner, jobs);
    if (result.status !== "queued") jobs.forEach(({ id }) => discardDeploymentSecret(id));
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
  } catch {
    secretIds.forEach(discardDeploymentSecret);
    console.error("Could not queue certificate deployment");
    return reject(503, "Could not queue the deployment.");
  }
  locals.auditTargetId = runId;
  redirect(303, resolve("/deployments/[id]", { id: runSlug }));
}

export async function recoverDeploymentAction(
  event: Pick<RequestEvent, "request" | "setHeaders" | "locals"> & Connection,
) {
  const { request, setHeaders, locals } = event;
  setHeaders({ "cache-control": "no-store" });
  const reject = (status: number, message: string) => fail(status, { recoverError: message });
  if (!hasTrustedTransport(event)) return reject(400, "A trusted HTTPS connection is required to submit a private key.");
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
    const reason = error instanceof Error ? error.message : "Unknown database error";
    return reject(
      503,
      dev
        ? `Could not load this deployment for recovery: ${reason}`
        : "Could not load this deployment for recovery.",
    );
  }
  if (!source) return reject(409, "This deployment is no longer available for recovery.");
  if (!(source.method === "Agent" ? getControllerToken() : getAnsibleToken()))
    return reject(503, `${source.method} deployment is unavailable.`);
  let key: Awaited<ReturnType<typeof readDeploymentKey>>;
  try {
    key = await readDeploymentKey(form!, source.fullchain);
  } catch (error) {
    console.error("Could not read private key for deployment recovery", error);
    return reject(400, "Could not read the uploaded private key. Choose the file again and retry.");
  }
  if ("message" in key) return reject(400, key.message);
  const ansible = source.method === "Ansible" ? readAnsibleCredentials(form!) : undefined;
  if (ansible?.message) return reject(400, ansible.message);
  const id = randomUUID();
  keepDeploymentSecret(id, packAnsibleDeployment(key.pem, ansible?.credentials));
  let result;
  try {
    result = await queueDeploymentRecovery(database, source.id, id);
  } catch (error) {
    discardDeploymentSecret(id);
    console.error("Could not queue certificate deployment recovery", error);
    return reject(503, "Could not queue the redeployment.");
  }
  if (result.status !== "queued") discardDeploymentSecret(id);
  if (result.status === "busy") return reject(409, "This host already has an active deployment.");
  if (result.status !== "queued") return reject(409, "The host or deployment is no longer available for recovery.");
  locals.auditTargetId = result.id;
  redirect(303, resolve("/deployments/[id]", { id: result.slug }));
}

export async function cancelQueuedDeploymentAction(
  event: Pick<RequestEvent, "request" | "setHeaders" | "locals" | "params">,
) {
  const { request, setHeaders, locals } = event;
  setHeaders({ "cache-control": "no-store" });
  if (!locals.user?.isAdmin)
    return fail(403, { cancelError: "An administrator account is required." });
  const form = await request.formData().catch(() => null);
  const id = form?.get("jobId");
  if (typeof id !== "string" || !idPattern.test(id))
    return fail(400, { cancelError: "Choose a queued deployment to cancel." });
  const result = await cancelQueuedDeployment(getDatabase(), id, event.params.id);
  if (result === "missing")
    return fail(404, { cancelError: "This deployment could not be found." });
  if (result === "not-queued")
    return fail(409, { cancelError: "This deployment is no longer queued and cannot be canceled." });
  discardDeploymentSecret(id);
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
