import { revokeHostAgent } from '@cbp/database/host-agents';
import { controllerPost, digest, validAgentToken, validHostId } from '../request.js';

export const POST = controllerPost(async (db, { hostId, token }) => {
  if (!validHostId(hostId) || !validAgentToken(token)) return 400;
  const result = await revokeHostAgent(db, hostId, digest(token).toString('hex'));
  return result === 'denied' ? 403 : 204;
});
