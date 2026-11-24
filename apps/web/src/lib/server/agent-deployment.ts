import { randomUUID } from "node:crypto";
import { resolve } from "$app/paths";
import {
  deploymentJobStatuses,
  deploymentSources,
  findRecoverableDeployment,
  queueDeploymentRecovery,
  queueDeployments,
} from "@cbp/database/deployment-jobs";
import { fail, redirect, type RequestEvent } from "@sveltejs/kit";
import { deploymentServices } from "#lib/deployment-services.js";
import { packAnsibleDeployment, readAnsibleCredentials } from './ansible-deployment-payload.js';
import {
  deploymentEncryptionKey,
  getAnsibleToken,
  getControllerToken,
} from "./controller-config.js";
import { getDatabase } from "./database.js";
import { openDeploymentKey, readDeploymentKey, sealDeploymentKey } from "./deployment-key.js";
import { hasTrustedTransport, type Connection } from "./trusted-transport.js";

const idPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
type DeploymentSelection = {
  id: string;
  endpoint: string;
  hostId: string;
  engine: string;
};

export async function loadAgentDeployments(
  ids: string[],
  connection: Connection,
) {
  const encryption = deploymentEncryptionKey();
  const agentEnabled = Boolean(encryption && getControllerToken());
  const ansibleEnabled = Boolean(encryption && getAnsibleToken());
  const statuses = await deploymentJobStatuses(getDatabase(), ids);
  const httpsRequired = (agentEnabled || ansibleEnabled) && !hasTrustedTransport(connection);
  return {
    blocked: !agentEnabled || httpsRequired,
    ansibleEnabled,
    httpsRequired,
    statuses: Object.fromEntries(
      statuses.map(({ deploymentId, ...job }) => [deploymentId, job]),
    ),
  };
}

export async function deployCertificateAction(
  event: Pick<RequestEvent, "request" | "setHeaders" | "locals"> & Connection,
  certificateId: string,
  method: 'Agent' | 'Ansible' = 'Agent',
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
  const encryptionKey = deploymentEncryptionKey();
  if (!encryptionKey || !(method === 'Agent' ? getControllerToken() : getAnsibleToken()))
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
    if (source.method !== method)
      return reject(
        400,
        `Set the deployment method to ${method} before deploying from CBP.`,
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
    if (method === 'Ansible' && engine !== 'Nginx')
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
    });
  }
  const key = await readDeploymentKey(fields, targets[0].fullchain);
  if ("message" in key) return reject(400, key.message);
  const ansible = method === 'Ansible' ? readAnsibleCredentials(fields) : undefined;
  if (ansible?.message) return reject(400, ansible.message);
  const payload = packAnsibleDeployment(key.pem, ansible?.credentials);

  let runId: string;
  let runSlug: string;
  try {
    const jobs = targets.map((target) => {
      const id = randomUUID();
      return {
        ...target,
        id,
        sealedKey: sealDeploymentKey(encryptionKey, id, payload),
      };
    });
    const result = await queueDeployments(database, owner, jobs, method);
    if (result.status === "busy")
      return reject(
        409,
        `The host for ${result.endpoint} already has an active deployment.`,
      );
    if (result.status === "unenrolled")
      return reject(
        409,
        method === 'Agent'
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
  const form = await request.formData().catch(() => null);
  const sourceId = form?.get("jobId");
  if (typeof sourceId !== "string" || !idPattern.test(sourceId))
    return reject(400, "Choose a deployment to recover.");
  const encryptionKey = deploymentEncryptionKey();
  if (!encryptionKey) return reject(503, "Deployment recovery is unavailable.");
  const database = getDatabase();
  const source = await findRecoverableDeployment(database, sourceId);
  if (!source?.sealedKey) return reject(409, "Encrypted recovery data is unavailable for this deployment.");
  if (!(source.method === "Agent" ? getControllerToken() : getAnsibleToken()))
    return reject(503, `${source.method} deployment is unavailable.`);

  const id = randomUUID();
  let sealedKey: string;
  try {
    const payload = openDeploymentKey(encryptionKey, source.id, source.sealedKey);
    sealedKey = sealDeploymentKey(encryptionKey, id, payload);
  } catch {
    return reject(409, "Recovery data cannot be opened. Check the deployment encryption key.");
  }
  const result = await queueDeploymentRecovery(database, source.id, id, sealedKey);
  if (result.status === "busy") return reject(409, "This host already has an active deployment.");
  if (result.status !== "queued") return reject(409, "The host or deployment is no longer available for recovery.");
  locals.auditTargetId = result.id;
  redirect(303, resolve("/deployments/[id]", { id: result.slug }));
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
    if (!Array.isArray(target) || target.length !== 4) return null;
    const [id, endpoint, hostId, engine] = target;
    if (
      typeof id !== "string" ||
      typeof endpoint !== "string" ||
      typeof hostId !== "string" ||
      typeof engine !== "string" ||
      !idPattern.test(hostId)
    )
      return null;
    selected.push({ id, endpoint, hostId, engine });
  }
  return selected;
}
