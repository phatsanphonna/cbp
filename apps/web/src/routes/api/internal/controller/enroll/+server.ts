import { enrollHostAgent } from '@cbp/database/host-agents';
import { controllerPost, digest, validAgentToken, validHostId } from '../request.js';

export const POST = controllerPost(async (db, { hostId, code, token }) => {
  if (!validHostId(hostId) || !validAgentToken(code) || !validAgentToken(token)) return 400;
  const result = await enrollHostAgent(db, hostId, digest(code).toString('hex'), digest(token).toString('hex'));
  return result === 'ok' ? 204 : 403;
});
