export function parseServedCertificateExpiry(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ||
      value.startsWith('0000-')) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().replace('.000Z', 'Z') !== value) {
    return null;
  }
  return date;
}
