import {
  listenerBatchSize,
  type AgentReadiness,
} from "@cbp/database/host-agents";
import { deploymentServices } from "#lib/deployment-services.js";

const idPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const states = ["ready", "unreachable", "tls-error", "not-allowed"] as const;
const fingerprintPattern = /^[\da-f]{64}$/i;

export function parseAgentReadiness(
  report: Record<string, unknown>,
): AgentReadiness | null | undefined {
  const { allowedServices, listenerResults, listenerCursor } = report;
  if (
    allowedServices === undefined &&
    listenerResults === undefined &&
    listenerCursor === undefined
  )
    return undefined;
  if (
    !Array.isArray(allowedServices) ||
    allowedServices.length > deploymentServices.length ||
    allowedServices.some(
      (service) => !deploymentServices.some((name) => name === service),
    ) ||
    !Array.isArray(listenerResults) ||
    listenerResults.length > listenerBatchSize ||
    (listenerCursor !== undefined &&
      (typeof listenerCursor !== "string" || !idPattern.test(listenerCursor)))
  )
    return null;

  const results: AgentReadiness["results"] = [];
  const seen = new Set<string>();
  for (const result of listenerResults) {
    if (!result || typeof result !== "object") return null;
    const { id, endpoint, engine, status, address, fingerprint } = result as Record<
      string,
      unknown
    >;
    const state = states.find((value) => value === status);
    const service = deploymentServices.find((value) => value === engine);
    if (
      typeof id !== "string" ||
      !idPattern.test(id) ||
      seen.has(id.toLowerCase()) ||
      typeof endpoint !== "string" ||
      !endpoint.length ||
      endpoint.length > 261 ||
      !service ||
      !state ||
      (fingerprint !== undefined && fingerprint !== null &&
        (typeof fingerprint !== "string" || !fingerprintPattern.test(fingerprint))) ||
      (state === "not-allowed"
        ? address != null
        : typeof address !== "string" ||
          !address.length ||
          address.length > 300 ||
          /[\s\x00-\x1f\x7f]/.test(address))
    )
      return null;
    seen.add(id.toLowerCase());
    results.push({
      id,
      endpoint,
      engine: service,
      status: state,
      address: typeof address === "string" ? address : null,
      fingerprint: typeof fingerprint === "string" ? fingerprint.toLowerCase() : null,
    });
  }
  return {
    allowedServices: [...new Set<string>(allowedServices)],
    results,
    cursor: listenerCursor as string | undefined,
  };
}
