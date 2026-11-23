import { normalizeHostAddress } from './host-address.js';

export function normalizeAgentControllerAddress(value: string | undefined) {
  const parts = /^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(value?.trim() ?? '');
  if (!parts) return null;
  const host = normalizeHostAddress(parts[1] ?? parts[2]);
  const port = Number(parts[3]);
  if (!host || port < 1 || port > 65535 || Boolean(parts[1]) !== host.includes(':')) return null;
  return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

export function linuxAgentEnrollmentCommand(hostId: string, code: string, address: string, caFile?: string) {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const args = [
    `CBP_AGENT_ENROLLMENT_CODE=${quote(code)}`,
    'cbp-agent',
    `-host ${quote(hostId)}`,
    `-controller ${quote(address)}`,
    `-credential-file ${quote('/var/lib/cbp/agent.credential')}`
  ];
  if (caFile) args.push(`-ca ${quote(caFile)}`);
  args.push('-install-service');
  return args.join(' ');
}
