import { isIP } from 'node:net';

const dnsName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function hostIpAddress({
  name,
  lastPingAddress,
}: {
  name: string;
  lastPingAddress: string | null;
}) {
  if (lastPingAddress && isIP(lastPingAddress)) return lastPingAddress;
  return isIP(name) ? name : null;
}

export function normalizeHostAddress(value: string) {
  const name = value.trim().toLowerCase().replace(/\.$/, '');
  const ip = isIP(name);
  if (!name || name.length > 253 || name.includes('%') || (!ip && !dnsName.test(name))) return null;
  return ip === 6 ? new URL(`http://[${name}]/`).hostname.slice(1, -1) : name;
}
