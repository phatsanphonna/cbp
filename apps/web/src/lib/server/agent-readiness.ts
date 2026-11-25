import {
  listenerBatchSize,
  type AgentReadiness,
} from "@cbp/database/host-agents";
import { deploymentServices } from "#lib/deployment-services.js";
import { parseServedCertificateExpiry } from "./served-certificate.js";

const idPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const states = ["ready", "unreachable", "tls-error", "not-allowed"] as const;
const fingerprintPattern = /^[\da-f]{64}$/i;

export function parseAgentReadiness(
  report: Record<string, unknown>,
): AgentReadiness | null | undefined {
  const { allowedServices, serviceVersions, listenerResults, listenerCursor } =
    report;
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

  const versions: Record<string, string> = {};
  if (serviceVersions !== undefined) {
    if (
      !serviceVersions ||
      typeof serviceVersions !== "object" ||
      Array.isArray(serviceVersions)
    )
      return null;
    for (const [service, version] of Object.entries(serviceVersions)) {
      if (
        !allowedServices.includes(service) ||
        typeof version !== "string" ||
        !version.trim() ||
        version.length > 128 ||
        /[\x00-\x1f\x7f]/.test(version)
      )
        return null;
      versions[service] = version;
    }
  }

  const results: AgentReadiness["results"] = [];
  const seen = new Set<string>();
  for (const result of listenerResults) {
    if (!result || typeof result !== "object") return null;
    const { id, endpoint, engine, status, address, fingerprint, expiresAt } =
      result as Record<string, unknown>;
    const state = states.find((value) => value === status);
    const service = deploymentServices.find((value) => value === engine);
    const servedExpiry = parseServedCertificateExpiry(expiresAt);
    if (
      typeof id !== "string" ||
      !idPattern.test(id) ||
      seen.has(id.toLowerCase()) ||
      typeof endpoint !== "string" ||
      !endpoint.length ||
      endpoint.length > 261 ||
      !service ||
      !state ||
      (expiresAt !== undefined &&
        (!servedExpiry ||
          state !== "ready" ||
          typeof fingerprint !== "string")) ||
      (fingerprint !== undefined &&
        fingerprint !== null &&
        (typeof fingerprint !== "string" ||
          !fingerprintPattern.test(fingerprint))) ||
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
      fingerprint:
        typeof fingerprint === "string" ? fingerprint.toLowerCase() : null,
      expiresAt: servedExpiry ?? undefined,
    });
  }
  return {
    allowedServices: [...new Set<string>(allowedServices)],
    serviceVersions: versions,
    results,
    cursor: listenerCursor as string | undefined,
  };
}
