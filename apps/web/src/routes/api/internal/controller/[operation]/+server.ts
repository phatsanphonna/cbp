import { createHash, timingSafeEqual } from 'node:crypto';
import { saveControllerHeartbeat } from '@cbp/database/controller-status';
import { enrollHostAgent, inviteHostAgent, revokeHostAgent, saveAgentCheckIn } from '@cbp/database/host-agents';
import { getControllerToken } from '#lib/server/controller-config.js';
import { getDatabase } from '#lib/server/database.js';
import { validateHostReport } from '#lib/server/host-report.js';
import type { RequestHandler } from './$types';

const hostIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/;
const digest = (value: string) => createHash('sha256').update(value).digest();

export const POST: RequestHandler = async ({ params, request }) => {
  const controllerToken = getControllerToken();
  if (!controllerToken) return response(503);
  const supplied = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
  if (!supplied || !timingSafeEqual(digest(supplied), digest(controllerToken))) return response(401);

  const operation = params.operation;
  if (operation !== 'heartbeat' && operation !== 'invite' && operation !== 'enroll' && operation !== 'check-in' && operation !== 'revoke') {
    return response(404);
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return response(415);
  }
  const body = await readBody(request);
  if (!body) return response(400);

  try {
    const db = getDatabase();
    if (operation === 'heartbeat') {
      await saveControllerHeartbeat(db);
      return response(204);
    }
    const { hostId, code, token, report } = body;
    if (typeof hostId !== 'string' || !hostIdPattern.test(hostId)) return response(400);
    switch (operation) {
      case 'invite': {
        if (!validAgentToken(code)) return response(400);
        const result = await inviteHostAgent(db, hostId, digest(code).toString('hex'));
        return response(result === 'ok' ? 204 : result === 'conflict' ? 409 : 404);
      }
      case 'enroll': {
        if (!validAgentToken(code) || !validAgentToken(token)) return response(400);
        const result = await enrollHostAgent(db, hostId, digest(code).toString('hex'), digest(token).toString('hex'));
        return response(result === 'ok' ? 204 : 403);
      }
      case 'check-in': {
        if (!validAgentToken(token)) return response(400);
        const parsed = validateHostReport(report);
        if (!parsed?.operatingSystem || !parsed.architecture) return response(400);
        const { hostname, operatingSystem, architecture, lastProbedAt } = parsed;
        const result = await saveAgentCheckIn(db, hostId, digest(token).toString('hex'), {
          hostname, operatingSystem, architecture, lastProbedAt
        });
        return response(result === 'ok' ? 204 : 403);
      }
      case 'revoke': {
        const result = await revokeHostAgent(db, hostId);
        return response(result === 'ok' ? 204 : 404);
      }
    }
  } catch {
    console.error('Controller API database operation failed', { operation });
    return response(503);
  }
};

function validAgentToken(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 43) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === value;
}

function response(status: number) {
  return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.body) return null;
  let bytes = 0;
  const limited = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > 4096) controller.error(new Error('Request too large'));
      else controller.enqueue(chunk);
    }
  }));
  try {
    const parsed: unknown = await new Response(limited).json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
