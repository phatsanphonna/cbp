import { countOpenAlerts } from '@cbp/database/inventory';
import { getDatabase } from '#lib/server/database.js';
import type { LayoutServerLoad } from './$types';
import { assetViewer } from '#lib/server/access-control.js';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
  const { user } = locals;
  if (!user) return { user, openAlertCount: null };

  depends('cbp:open-alert-count');
  try {
    return { user, openAlertCount: await countOpenAlerts(getDatabase(), assetViewer(user)) };
  } catch {
    return { user, openAlertCount: null };
  }
};
