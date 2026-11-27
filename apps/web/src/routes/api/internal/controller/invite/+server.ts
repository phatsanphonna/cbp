import { inviteHostAgent } from '@cbp/database/host-agents';
import { controllerPost, digest, validAgentToken, validHostId } from '../request.js';

export const POST = controllerPost(async (db, { hostId, code }) => {
  if (!validHostId(hostId) || !validAgentToken(code)) return 400;
  const result = await inviteHostAgent(db, hostId, digest(code).toString('hex'));
  return result === 'ok' ? 204 : result === 'conflict' || result === 'unsupported' ? 409 : 404;
});
