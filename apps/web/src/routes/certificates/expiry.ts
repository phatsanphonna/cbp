export const dayInMilliseconds = 86_400_000;

export const expiryFilters = {
  expired: { label: 'Expired', days: 0 },
  '7d': { label: 'Expiring in 7 days', days: 7 },
  '30d': { label: 'Expiring in 30 days', days: 30 },
} as const;

export function expiryFilter(value: string | null, now: Date) {
  if (value !== 'expired' && value !== '7d' && value !== '30d') return null;
  const { label, days } = expiryFilters[value];
  return {
    label,
    before: new Date(now.getTime() + days * dayInMilliseconds),
    after: days ? now : undefined,
  };
}

export function expiryStatus(validFrom: Date, validUntil: Date) {
  const now = Date.now();
  if (validUntil.getTime() <= now) return 'Expired';
  if (validFrom.getTime() > now) return 'Not yet valid';
  const days = Math.ceil((validUntil.getTime() - now) / dayInMilliseconds);
  return `${days <= 30 ? 'Expiring' : 'Valid'} · ${days} ${days === 1 ? 'day' : 'days'} left`;
}
