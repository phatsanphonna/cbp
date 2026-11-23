import { saveAgentCheckIn } from "@cbp/database/host-agents";
import { json } from "@sveltejs/kit";
import { parseAgentReadiness } from "#lib/server/agent-readiness.js";
import { validateHostReport } from "#lib/server/host-report.js";
import {
  controllerPost,
  digest,
  validAgentToken,
  validHostId,
} from "../request.js";

export const POST = controllerPost(async (db, { hostId, token, report }) => {
  if (!validHostId(hostId) || !validAgentToken(token)) return 400;
  const parsed = validateHostReport(report);
  if (!parsed?.operatingSystem || !parsed.architecture) return 400;
  const readiness = parseAgentReadiness(report as Record<string, unknown>);
  if (readiness === null) return 400;
  const { hostname, operatingSystem, architecture, lastProbedAt } = parsed;
  const result = await saveAgentCheckIn(
    db,
    hostId,
    digest(token).toString("hex"),
    {
      hostname,
      operatingSystem,
      architecture,
      lastProbedAt,
    },
    readiness,
  );
  if (result === "ok") return 204;
  if (typeof result === "string") return 403;
  return json(result, { headers: { "cache-control": "no-store" } });
}, 16 * 1024);
