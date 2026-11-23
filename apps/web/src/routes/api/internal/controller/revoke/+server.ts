import { revokeHostAgent } from "@cbp/database/host-agents";
import { controllerPost, validHostId } from "../request.js";

export const POST = controllerPost(async (db, { hostId }) => {
  if (!validHostId(hostId)) return 400;
  const result = await revokeHostAgent(db, hostId);
  return result === "ok" ? 204 : 404;
});
