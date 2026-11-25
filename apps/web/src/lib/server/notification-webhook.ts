import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';

export function parseWebhookUrl(value: string) {
  const url = URL.parse(value);
  if (
    !url || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
    isIP(url.hostname) || !url.hostname.includes('.') || url.hostname.startsWith('[')
  ) return null;
  return url;
}

export function notificationProxy(url: URL) {
  const proxy = URL.parse(Bun.env.HTTPS_PROXY || '');
  if (proxy?.protocol !== 'http:' && proxy?.protocol !== 'https:') return false;

  const host = url.hostname.replace(/\.$/, '');
  const rules = (Bun.env.NO_PROXY || Bun.env.no_proxy || '').toLowerCase().split(',');
  const bypass = rules.some((rule) => {
    const [domain, port] = rule.trim().split(':');
    if (!domain || (port && port !== (url.port || '443'))) return false;
    if (domain === '*') return true;
    const suffix = domain.replace(/^\*?\./, '');
    return host === suffix || host.endsWith(`.${suffix}`);
  });
  return bypass ? false : proxy.href;
}

function isTeamsWorkflowHost(url: URL) {
  return url.hostname.endsWith('.api.powerplatform.com') || url.hostname.endsWith('.logic.azure.com');
}

function isPublicAddress(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

async function publicWebhookAddress(url: URL) {
  const { address } = await lookup(url.hostname, { family: 4 });
  return isPublicAddress(address) ? address : null;
}

export async function isPublicWebhook(value: string, useTeamsProxy = false) {
  const url = parseWebhookUrl(value);
  if (!url) return false;
  if (useTeamsProxy && isTeamsWorkflowHost(url) && notificationProxy(url)) return true;
  return Boolean(await publicWebhookAddress(url).catch(() => null));
}

export async function postPublicWebhook(
  url: URL,
  payload: object,
  deliveryId: string,
  useTeamsProxy = false,
) {
  const body = JSON.stringify(payload);
  const headers = {
    'content-type': 'application/json',
    'idempotency-key': deliveryId,
  };
  const proxy = notificationProxy(url);
  if (proxy) {
    const destination = new URL(url);
    if (!useTeamsProxy || !isTeamsWorkflowHost(url)) {
      const address = await publicWebhookAddress(url);
      if (!address) return false;
      destination.hostname = address;
    }
    const response = await fetch(destination, {
      method: 'POST',
      headers: { ...headers, host: url.host },
      body,
      // NO_PROXY was already checked against the original hostname.
      proxy: { url: proxy, respectNoProxy: false },
      tls: {
        serverName: url.hostname,
        rejectUnauthorized: true,
        checkServerIdentity: (_, cert) => checkServerIdentity(url.hostname, cert),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel().catch(() => {});
    return response.ok;
  }

  const address = await publicWebhookAddress(url);
  if (!address) return false;

  // Connect to the checked address and validate TLS for the original hostname.
  return new Promise<boolean>((resolve, reject) => {
    const outgoing = request({
      hostname: address,
      servername: url.hostname,
      rejectUnauthorized: true,
      checkServerIdentity: (_, cert) => checkServerIdentity(url.hostname, cert),
      path: url.pathname + url.search,
      method: 'POST',
      agent: false,
      signal: AbortSignal.timeout(10_000),
      headers: {
        ...headers,
        host: url.host,
        'content-length': Buffer.byteLength(body),
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      resolve(status >= 200 && status < 300);
      response.destroy();
    });
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}
