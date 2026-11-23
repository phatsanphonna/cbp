import { listProbeHosts } from '@cbp/database/inventory';
import { json } from '@sveltejs/kit';
import { controllerPost, validHostId } from '../request.js';

export const POST = controllerPost(async (db, { after }) => {
  if (after !== undefined && !validHostId(after)) return 400;
  return json(await listProbeHosts(db, after ?? null), { headers: { 'cache-control': 'no-store' } });
});
