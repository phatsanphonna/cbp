import { claimDeployment, finishDeployment } from "@cbp/database/deployment-jobs";
import { json } from "@sveltejs/kit";
import { takeDeploymentSecret } from "#lib/server/deployment-secrets.js";
import {
  controllerPost,
  digest,
  validAgentToken,
  validHostId,
} from "../request.js";

export const POST = controllerPost(async (db, { hostId, token }) => {
  if (!validHostId(hostId) || !validAgentToken(token)) return 400;
  const job = await claimDeployment(
    db,
    hostId,
    digest(token).toString("hex"),
    (row) => ({
      id: row.id,
      engine: row.engine,
      endpoint: row.endpoint,
      fullchain: row.fullchain,
    }),
  );
  if (job === "missing" || job === "denied") return 403;
  if (!job) return 204;
  const privateKey = takeDeploymentSecret(job.id);
  if (!privateKey) {
    await finishDeployment(db, hostId, digest(token).toString("hex"), job.id,
      "The deployment key is no longer available in memory. Upload the private key and queue the deployment again.");
    return 204;
  }
  return json({ ...job, privateKey }, { headers: { "cache-control": "no-store" } });
});
