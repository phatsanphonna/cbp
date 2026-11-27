import { error } from '@sveltejs/kit';
import { readAgentDownload } from '#lib/server/agent-download.js';
import { hasTrustedTransport } from '#lib/server/trusted-transport.js';
import { hasPermission } from '#lib/server/access-control.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  if (!hasPermission(event.locals.user, 'agents.manage') || !hasTrustedTransport(event))
    error(403, 'Administrator access over a trusted connection is required.');
  const binary = await readAgentDownload(event.params.arch);
  if (!binary) error(404, 'The Linux agent download is unavailable.');
  return new Response(binary, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="cbp-agent-linux"',
      'content-length': String(binary.byteLength),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};
