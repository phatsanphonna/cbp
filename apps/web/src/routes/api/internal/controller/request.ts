import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from '@sveltejs/kit';
import { getControllerToken } from '#lib/server/controller-config.js';
import { getDatabase } from '#lib/server/database.js';

const hostIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/;
export const digest = (value: string) => createHash('sha256').update(value).digest();

export function controllerPost(
  handle: (db: ReturnType<typeof getDatabase>, body: Record<string, unknown>) => Promise<number>
): RequestHandler {
  return async ({ request, route }) => {
    const controllerToken = getControllerToken();
    if (!controllerToken) return response(503);
    const supplied = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
    if (!supplied || !timingSafeEqual(digest(supplied), digest(controllerToken))) return response(401);

    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return response(415);
    }
    const body = await readBody(request);
    if (!body) return response(400);

    try {
      return response(await handle(getDatabase(), body));
    } catch {
      console.error('Controller API database operation failed', { route: route.id });
      return response(503);
    }
  };
}

export function validHostId(value: unknown): value is string {
  return typeof value === 'string' && hostIdPattern.test(value);
}

export function validAgentToken(value: unknown): value is string {
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
