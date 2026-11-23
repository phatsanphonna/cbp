const textFields = {
  hostname: 253,
  fqdn: 253,
  operatingSystem: 256,
  architecture: 80,
  httpsListeners: 8192
};

export function parseHostReport(text: FormDataEntryValue | null) {
  if (typeof text !== 'string' || !text.trim() || text.length > 24_576) return null;

  let values: unknown;
  try {
    values = JSON.parse(text);
  } catch {
    return null;
  }
  return validateHostReport(values);
}

export function validateHostReport(values: unknown) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;

  const report = values as Record<string, unknown>;
  for (const [field, maxLength] of Object.entries(textFields)) {
    const value = report[field];
    if (value != null && (typeof value !== 'string' || value.length > maxLength || value.includes('\0'))) return null;
  }
  if (typeof report.hostname !== 'string' || !report.hostname.trim()) return null;
  if (typeof report.collectedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(report.collectedAt)) return null;

  const lastProbedAt = new Date(report.collectedAt);
  const collected = lastProbedAt.getTime();
  if (!Number.isFinite(collected) || collected < 0 || collected > Date.now() + 300_000) return null;

  const read = (field: string) => typeof report[field] === 'string' ? report[field].trim() : null;
  return {
    hostname: report.hostname.trim(),
    fqdn: read('fqdn') || null,
    operatingSystem: read('operatingSystem') || null,
    architecture: read('architecture') || null,
    httpsListeners: read('httpsListeners'),
    lastProbedAt
  };
}
