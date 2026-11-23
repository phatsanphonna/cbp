import { enrollHostAgent } from "@cbp/database/host-agents";
import { isIP } from "node:net";
import {
  controllerPost,
  digest,
  validAgentToken,
  validHostId,
} from "../request.js";

export const POST = controllerPost(
  async (db, { hostId, code, token, address }) => {
    if (
      !validHostId(hostId) ||
      !validAgentToken(code) ||
      !validAgentToken(token)
    )
      return 400;
    if (
      address !== undefined &&
      (typeof address !== "string" || !isIP(address) || address.includes("%"))
    )
      return 400;
    const result = await enrollHostAgent(
      db,
      hostId,
      digest(code).toString("hex"),
      digest(token).toString("hex"),
      address,
    );
    return result === "ok" ? 204 : result === "address-mismatch" ? 412 : 403;
  },
);
