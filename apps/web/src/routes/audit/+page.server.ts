import { listAuditEvents } from "@cbp/database/audit";
import { dateFormatter } from "#lib/server/date-formatter.js";
import { getDatabase } from "#lib/server/database.js";
import type { PageServerLoad } from "./$types";

const pageSize = 50;

export const load: PageServerLoad = async ({ url, cookies }) => {
  const requested = Number(url.searchParams.get("page"));
  const offset = (requested - 1) * pageSize;
  const page =
    Number.isSafeInteger(offset) && offset >= 0 && Number.isInteger(requested)
      ? requested
      : 1;
  const rows = await listAuditEvents(
    getDatabase(),
    (page - 1) * pageSize,
    pageSize + 1,
  );
  const format = dateFormatter(cookies.get("cbp-time-zone"));
  return {
    page,
    hasNext: rows.length > pageSize,
    entries: rows
      .slice(0, pageSize)
      .map(
        ({ id, occurredAt, actorName, action, route, targetId, status }) => ({
          id,
          actorName,
          action,
          route,
          targetId,
          status,
          iso: occurredAt.toISOString(),
          time: format.format(occurredAt),
        }),
      ),
  };
};
