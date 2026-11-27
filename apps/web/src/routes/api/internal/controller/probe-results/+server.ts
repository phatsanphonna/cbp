import { isIP } from 'node:net';
import { saveHostPing } from '@cbp/database/inventory';
import { controllerPost, validHostId } from '../request.js';

export const POST = controllerPost(async (db, { probes }) => {
  if (!Array.isArray(probes) || !probes.length || probes.length > 12) return 400;
  const parsed = [];
  for (const probe of probes) {
    if (!probe || typeof probe !== 'object') return 400;
    const { hostId, status, address, checkedAt } = probe as Record<string, unknown>;
    if (
      !validHostId(hostId) ||
      (status !== 'reachable' && status !== 'no-reply' && status !== 'unavailable') ||
      (address !== null && (typeof address !== 'string' || !isIP(address))) ||
      (status !== 'unavailable' && address === null) ||
      typeof checkedAt !== 'string'
    )
      return 400;
    const lastPingAt = new Date(checkedAt);
    if (!Number.isFinite(lastPingAt.getTime()) || lastPingAt.getTime() > Date.now() + 60_000)
      return 400;
    parsed.push({
      hostId,
      ping: { lastPingAt, lastPingStatus: status, lastPingAddress: address },
    } as const);
  }
  await Promise.all(parsed.map(({ hostId, ping }) => saveHostPing(db, hostId, ping)));
  return 204;
});
