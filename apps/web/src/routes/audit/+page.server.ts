import { auditResult, findAuditTargetNames, listAuditEvents } from '@cbp/database/audit';
import { auditActionLabels } from '#lib/server/audit-action.js';
import {
  auditKindLabel,
  auditTargetKind,
  collectAuditTargetIds,
  parseAuditFilters,
} from '#lib/server/audit-view.js';
import { dateFormatter } from '#lib/server/date-formatter.js';
import { getDatabase } from '#lib/server/database.js';
import type { PageServerLoad } from './$types';

const pageSize = 50;
// Kinds whose rows are looked up by name; a missing name means the target was removed.
const namedKinds = new Set(['certificate', 'run', 'host', 'user', 'group', 'channel']);

export const load: PageServerLoad = async ({ url, cookies }) => {
  const requested = Number(url.searchParams.get('page'));
  const offset = (requested - 1) * pageSize;
  const page =
    Number.isSafeInteger(offset) && offset >= 0 && Number.isInteger(requested) ? requested : 1;
  const timeZone = cookies.get('cbp-time-zone');
  const { values, filters } = parseAuditFilters(url.searchParams, timeZone);
  const database = getDatabase();
  const rows = await listAuditEvents(database, (page - 1) * pageSize, pageSize + 1, filters);
  const visible = rows.slice(0, pageSize);
  const names = await findAuditTargetNames(database, collectAuditTargetIds(visible));
  const format = dateFormatter(timeZone);
  return {
    page,
    hasNext: rows.length > pageSize,
    filters: values,
    actions: auditActionLabels,
    entries: visible.map(({ id, occurredAt, actorName, action, route, targetId, status }) => {
      const kind = auditTargetKind(route, action);
      const name = kind && targetId ? names.get(`${kind}:${targetId}`) : undefined;
      return {
        id,
        actorName,
        action,
        status,
        result: auditResult(status),
        target: targetId
          ? {
              id: targetId,
              kind,
              kindLabel: kind ? auditKindLabel(kind) : route,
              name,
              removed: !!kind && namedKinds.has(kind) && !name,
            }
          : null,
        iso: occurredAt.toISOString(),
        time: format.format(occurredAt),
      };
    }),
  };
};
