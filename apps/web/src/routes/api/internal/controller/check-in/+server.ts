import { saveAgentCheckIn } from '@cbp/database/host-agents';
import { validateHostReport } from '#lib/server/host-report.js';
import { controllerPost, digest, validAgentToken, validHostId } from '../request.js';

export const POST = controllerPost(async (db, { hostId, token, report }) => {
  if (!validHostId(hostId) || !validAgentToken(token)) return 400;
  const parsed = validateHostReport(report);
  if (!parsed?.operatingSystem || !parsed.architecture) return 400;
  const { hostname, operatingSystem, architecture, lastProbedAt } = parsed;
  const result = await saveAgentCheckIn(db, hostId, digest(token).toString('hex'), {
    hostname, operatingSystem, architecture, lastProbedAt
  });
  return result === 'ok' ? 204 : 403;
});
