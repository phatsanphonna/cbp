import { appendDeploymentLog } from "@cbp/database/deployment-jobs";
import {
  controllerPost,
  digest,
  validAgentToken,
  validHostId,
} from "../request.js";

export const POST = controllerPost(
  async (db, { hostId, token, jobId, message }) => {
    if (
      !validHostId(hostId) ||
      !validAgentToken(token) ||
      !validHostId(jobId) ||
      typeof message !== "string" ||
      !message.trim() ||
      Buffer.byteLength(message) > 1024 ||
      /\p{Cc}/u.test(message)
    )
      return 400;
    const result = await appendDeploymentLog(
      db,
      hostId,
      digest(token).toString("hex"),
      jobId,
      message,
    );
    return result === "denied" ? 403 : result === "ok" ? 204 : 404;
  },
);
