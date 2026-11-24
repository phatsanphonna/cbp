import { randomUUID } from "node:crypto";
import { resolve } from "$app/paths";
import {
  deploymentJobStatuses,
  deploymentSources,
  queueDeployments,
} from "@cbp/database/deployment-jobs";
import { fail, redirect, type RequestEvent } from "@sveltejs/kit";
import { deploymentServices } from "#lib/deployment-services.js";
import {
  deploymentEncryptionKey,
  getControllerToken,
} from "./controller-config.js";
import { getDatabase } from "./database.js";
import { readDeploymentKey, sealDeploymentKey } from "./deployment-key.js";
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
  const enabled = Boolean(deploymentEncryptionKey() && getControllerToken());
  const statuses = enabled
    ? await deploymentJobStatuses(getDatabase(), ids)
    : [];
  const httpsRequired = enabled && !hasTrustedTransport(connection);
  return {
    blocked: !enabled || httpsRequired,
    httpsRequired,
    statuses: Object.fromEntries(
      statuses.map(({ deploymentId, ...job }) => [deploymentId, job]),
    ),
  };
}

export async function deployCertificateAction(
  event: Pick<RequestEvent, "request" | "setHeaders" | "locals"> & Connection,
  certificateId: string,
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
  if (!encryptionKey || !getControllerToken())
    return reject(503, "Agent deployment is unavailable.");
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
    const { hostId, endpoint, engine, method, fullchain } = source;
    if (method !== "Agent")
      return reject(
        400,
        "Set the deployment method to Agent before deploying from CBP.",
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

  let runId: string;
  let runSlug: string;
  try {
    const jobs = targets.map((target) => {
      const id = randomUUID();
      return {
        ...target,
        id,
        sealedKey: sealDeploymentKey(encryptionKey, id, key.pem),
      };
    });
    const result = await queueDeployments(database, owner, jobs);
    if (result.status === "busy")
      return reject(
        409,
        `The host for ${result.endpoint} already has an active deployment.`,
      );
    if (result.status === "unenrolled")
      return reject(
        409,
        `Enroll an agent for ${result.endpoint} before deploying.`,
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
