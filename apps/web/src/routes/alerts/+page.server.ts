import { listAlerts } from '@cbp/database/inventory';
import { clearAlert } from '@cbp/database/alerts';
import { fail } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/database.js';
import { dateFormatter } from '#lib/server/date-formatter.js';
import type { Actions, PageServerLoad } from './$types';
import { assetViewer, hasPermission } from '#lib/server/access-control.js';

export const load: PageServerLoad = async ({ url, cookies, locals }) => {
  const format = dateFormatter(cookies.get('cbp-time-zone'));
  const openOnly = url.searchParams.get('status') === 'open';
  return {
    openOnly,
    canManageAlerts: hasPermission(locals.user, 'alerts.manage'),
    alerts: (await listAlerts(getDatabase(), openOnly, assetViewer(locals.user))).map(
      ({ id, severity, message, target, detectedAt, resolvedAt, clearedAt }) => ({
        id,
        severity,
        message,
        target,
        detected: format.format(detectedAt),
        status: resolvedAt ? 'Resolved' : clearedAt ? 'Cleared' : 'Open',
      }),
    ),
  };
};

export const actions: Actions = {
  clear: async ({ request, locals }) => {
    const id = (await request.formData()).get('id');
    if (typeof id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) {
      return fail(400, { message: 'Choose an alert to clear.' });
    }
    locals.auditTargetId = id;
    if (!(await clearAlert(getDatabase(), id, assetViewer(locals.user))))
      return fail(409, { message: 'This alert is no longer open.' });
    return { success: 'Alert cleared.' };
  },
};
