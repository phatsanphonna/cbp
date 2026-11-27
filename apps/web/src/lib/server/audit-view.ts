import { auditResults, type AuditFilters, type AuditTargetIds } from '@cbp/database/audit';

const uuidPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/** Midnight of a `YYYY-MM-DD` day in `timeZone`, or undefined for invalid input. */
function zonedMidnight(day: string, timeZone: string, addDays = 0) {
  if (!datePattern.test(day)) return;
  const guess = Date.parse(`${day}T00:00:00Z`) + addDays * 86_400_000;
  if (Number.isNaN(guess)) return;
  // shortcut: uses the zone offset at UTC midnight, so a DST change that same night is off by an hour.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(guess)
      .map(({ type, value }) => [type, Number(value)]),
  );
  const local = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return new Date(guess - (local - guess));
}

export function parseAuditFilters(params: URLSearchParams, timeZone = 'Asia/Bangkok') {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    timeZone = 'Asia/Bangkok';
  }
  // 'any' is the "All …" choice the filter selects submit.
  const text = (name: string) => {
    const value = params.get(name)?.trim().slice(0, 200) ?? '';
    return value === 'any' ? '' : value;
  };
  const result = text('result');
  const values = {
    actor: text('actor'),
    action: text('action'),
    result: (auditResults as readonly string[]).includes(result) ? result : '',
    from: datePattern.test(text('from')) ? text('from') : '',
    to: datePattern.test(text('to')) ? text('to') : '',
  };
  const filters: AuditFilters = {
    actor: values.actor || undefined,
    action: values.action || undefined,
    result: (values.result || undefined) as AuditFilters['result'],
    from: values.from ? zonedMidnight(values.from, timeZone) : undefined,
    // `to` is inclusive of the whole day.
    to: values.to ? zonedMidnight(values.to, timeZone, 1) : undefined,
  };
  return { values, filters };
}

export type AuditTargetKind = keyof AuditTargetIds | 'alert' | 'credential' | 'job';

const kindLabels: Record<AuditTargetKind, string> = {
  certificate: 'Certificate',
  run: 'Deployment',
  host: 'Host',
  user: 'User',
  group: 'Group',
  channel: 'Notification channel',
  alert: 'Alert',
  credential: 'Ansible credential',
  job: 'Deployment job',
};

const routeKinds: Record<string, AuditTargetKind> = {
  '/certificates/new': 'certificate',
  '/certificates/[id]': 'certificate',
  '/certificates/[id]/private-key': 'certificate',
  '/hosts/new': 'host',
  '/hosts/[id]': 'host',
  '/users': 'user',
  '/groups': 'group',
  '/alerts': 'alert',
  '/alerts/channels': 'channel',
  '/deployments/[id]': 'run',
  '/ansible-credentials': 'credential',
};

/** What an audit event's `targetId` refers to; depends on the action, not only the route. */
export function auditTargetKind(route: string, action: string): AuditTargetKind | undefined {
  // These actions store the deployment run or job id instead of the page id.
  if (route === '/certificates/[id]' && action.startsWith('Deploy certificate')) return 'run';
  if (route === '/deployments/[id]' && action === 'Cancel queued deployment') return 'job';
  if (route === '/ansible-credentials' && /^(?:Un)?bind /.test(action)) return 'host';
  return routeKinds[route];
}

/** Groups target ids by kind, dropping ids whose shape cannot match that kind's key column. */
export function collectAuditTargetIds(
  events: { route: string; action: string; targetId: string | null }[],
) {
  const ids: AuditTargetIds = { certificate: [], run: [], host: [], user: [], group: [], channel: [] };
  for (const { route, action, targetId } of events) {
    const kind = targetId ? auditTargetKind(route, action) : undefined;
    if (!targetId || !kind || !(kind in ids)) continue;
    if (kind === 'group' || kind === 'channel') {
      if (/^\d{1,9}$/.test(targetId)) ids[kind].push(Number(targetId));
    } else if (kind === 'user' || uuidPattern.test(targetId)) {
      ids[kind as 'certificate'].push(targetId);
    }
  }
  return ids;
}

export function auditKindLabel(kind: AuditTargetKind) {
  return kindLabels[kind];
}
