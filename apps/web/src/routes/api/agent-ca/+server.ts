import {
  CBP_AGENT_CA_DOWNLOAD_FILE,
  CBP_AGENT_CA_FILE,
} from "$app/env/private";
import { error } from "@sveltejs/kit";
import { readAgentCaPem } from "#lib/server/agent-ca.js";
import { agentCaPaths } from "#lib/server/agent-enrollment-command.js";
import { hasTrustedTransport } from "#lib/server/trusted-transport.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  if (!event.locals.user?.isAdmin || !hasTrustedTransport(event))
    error(403, "Administrator access over a trusted connection is required.");
  if (!CBP_AGENT_CA_FILE || !CBP_AGENT_CA_DOWNLOAD_FILE)
    error(404, "The controller CA download is unavailable.");
  const pem = await readAgentCaPem(CBP_AGENT_CA_DOWNLOAD_FILE);
  if (!pem) error(404, "The controller CA download is unavailable.");

  const { filename } = agentCaPaths(CBP_AGENT_CA_FILE);
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16)}`,
  );
  return new Response(pem, {
    headers: {
      "content-type": "application/x-pem-file",
      "content-disposition": `attachment; filename="controller-ca.pem"; filename*=UTF-8''${encoded}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
};
