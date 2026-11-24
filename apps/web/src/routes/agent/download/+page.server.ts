import { error } from '@sveltejs/kit';
import { agentDownloadOptions } from '#lib/server/agent-download.js';
import { hasTrustedTransport } from '#lib/server/trusted-transport.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user?.isAdmin || !hasTrustedTransport(event))
    error(403, 'Administrator access over a trusted connection is required.');
  return { downloads: await agentDownloadOptions() };
};
