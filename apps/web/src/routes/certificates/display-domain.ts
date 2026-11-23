export function displayCertificateDomain(domain: string, alternativeNames: readonly string[]) {
  if (domain.startsWith('*.')) return domain;

  const name = domain.toLowerCase();
  const dot = name.indexOf('.');
  const candidates = [`*.${name}`];
  if (dot >= 0) candidates.push(`*.${name.slice(dot + 1)}`);

  for (const candidate of candidates) {
    const wildcard = alternativeNames.find((entry) => entry.toLowerCase() === candidate);
    if (wildcard) return wildcard;
  }
  return domain;
}
