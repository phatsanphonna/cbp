import { claimDeployment } from "@cbp/database/deployment-jobs";
import { json } from "@sveltejs/kit";
import { deploymentEncryptionKey } from "#lib/server/controller-config.js";
import { openDeploymentKey } from "#lib/server/deployment-key.js";
import {
  controllerPost,
  digest,
  validAgentToken,
  validHostId,
} from "../request.js";

export const POST = controllerPost(async (db, { hostId, token }) => {
  if (!validHostId(hostId) || !validAgentToken(token)) return 400;
  const key = deploymentEncryptionKey();
  if (!key) return 204;
  const job = await claimDeployment(
    db,
    hostId,
    digest(token).toString("hex"),
    (row) => ({
      id: row.id,
      engine: row.engine,
      endpoint: row.endpoint,
      fullchain: row.fullchain,
      privateKey: openDeploymentKey(key, row.id, row.sealedKey ?? ""),
    }),
  );
  if (job === "missing" || job === "denied") return 403;
  return job ? json(job, { headers: { "cache-control": "no-store" } }) : 204;
});
