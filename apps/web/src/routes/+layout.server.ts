import { countOpenAlerts } from '@cbp/database/inventory';
import { getDatabase } from '#lib/server/database.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
  const { user } = locals;
  if (!user) return { user, openAlertCount: null };

  depends('cbp:open-alert-count');
  try {
    return { user, openAlertCount: await countOpenAlerts(getDatabase()) };
  } catch {
    return { user, openAlertCount: null };
  }
};
