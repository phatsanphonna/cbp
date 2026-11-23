import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { env } from 'node:process';
import type { RequestEvent } from '@sveltejs/kit';

export type Connection = Pick<RequestEvent, 'url' | 'request' | 'platform' | 'getClientAddress'>;
const loopbackHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
const loopbackPeers = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

export function isDirectHttps({ platform }: Connection) {
  return platform?.server?.url?.protocol === 'https:';
}

function trustedProxy({ url, request }: Connection) {
  const token = env.CBP_TRUSTED_PROXY_TOKEN ?? '';
  const supplied = request.headers.get('x-cbp-proxy-token') ?? '';
  return url.protocol === 'https:' && request.headers.get('x-forwarded-proto') === 'https' &&
    /^[A-Za-z0-9_-]{43,128}$/.test(token) && /^[A-Za-z0-9_-]{43,128}$/.test(supplied) &&
    token.length === supplied.length && timingSafeEqual(Buffer.from(token), Buffer.from(supplied));
}

export function hasTrustedTransport(connection: Connection) {
  const { url, request, platform, getClientAddress } = connection;
  if (url.protocol === 'https:') return !platform?.server || isDirectHttps(connection) || trustedProxy(connection);
  const host = platform?.server ? request.headers.get('host') ?? '' : url.host;
  return url.protocol === 'http:' && loopbackHost.test(host) && loopbackPeers.includes(getClientAddress());
}

export function getTrustedClientAddress(connection: Connection) {
  const forwarded = connection.request.headers.get('x-cbp-client-ip') ?? '';
  return connection.platform?.server && !isDirectHttps(connection) && isIP(forwarded) && trustedProxy(connection)
    ? forwarded
    : connection.getClientAddress() || '';
}
