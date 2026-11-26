import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';

const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function http01Names(domain: string, sans: string[]) {
  const names = [
    ...new Set(
      (sans.length ? sans : [domain]).map((name) => name.toLowerCase()),
    ),
  ];
  return names.includes(domain.toLowerCase()) &&
    names.every(
      (name) =>
        name.length <= 253 &&
        !isIP(name) &&
        name.includes('.') &&
        name.split('.').every((label) => dnsLabel.test(label)),
    )
    ? names.sort()
    : null;
}

export function letsEncryptNames(domain: string, fullchain: string | null) {
  if (!fullchain) return null;
  try {
    const leaf = new X509Certificate(fullchain);
    if (!leaf.issuer.split('\n').includes("O=Let's Encrypt")) return null;
    const sans = leaf.subjectAltName?.split(', ') ?? [];
    if (sans.some((name) => !name.startsWith('DNS:'))) return null;
    return http01Names(
      domain,
      sans.map((name) => name.slice(4)),
    );
  } catch {
    return null;
  }
}

export function readIssuanceNames(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || value.length > 25_400) return null;
  const entries = value
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  const domain = entries[0]?.toLowerCase();
  if (!domain || entries.length > 100) return null;
  const names = http01Names(domain, entries);
  return names && { domain, names };
}
