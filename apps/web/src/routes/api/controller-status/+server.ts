import { controllerIsOnline } from '@cbp/database/controller-status';
import { json } from '@sveltejs/kit';
import { getControllerToken } from '#lib/server/controller-config.js';
import { getDatabase } from '#lib/server/database.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const headers = { 'cache-control': 'no-store' };
  if (!getControllerToken()) return json({ status: 'not-configured' }, { headers });
  try {
    const online = await controllerIsOnline(getDatabase());
    return json({ status: online ? 'online' : 'offline' }, { headers });
  } catch {
    return json({ status: 'unavailable' }, { status: 503, headers });
  }
};
