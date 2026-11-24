import { listAlerts } from "@cbp/database/inventory";
import { getDatabase } from "#lib/server/database.js";
import { dateFormatter } from "#lib/server/date-formatter.js";
import type { PageServerLoad } from "./$types";

const format = dateFormatter("UTC");

export const load: PageServerLoad = async ({ url }) => {
  const openOnly = url.searchParams.get("status") === "open";
  return {
    openOnly,
    alerts: (await listAlerts(getDatabase(), openOnly)).map(
      ({ id, severity, message, target, detectedAt, resolvedAt }) => ({
        id,
        severity,
        message,
        target,
        detected: format.format(detectedAt),
        status: resolvedAt ? "Resolved" : "Open",
      }),
    ),
  };
};
