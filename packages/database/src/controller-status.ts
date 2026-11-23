import { eq, sql } from 'drizzle-orm';
import type { openDatabase } from './index.js';
import { controllerStatus } from './inventory-schema.js';

type Database = ReturnType<typeof openDatabase>;
const controllerId = 1;

export function saveControllerHeartbeat(db: Database) {
  const lastSeenAt = sql`clock_timestamp()`;
  return db.insert(controllerStatus).values({ id: controllerId, lastSeenAt })
    .onConflictDoUpdate({ target: controllerStatus.id, set: { lastSeenAt } });
}

export async function controllerIsOnline(db: Database) {
  const [row] = await db.select({
    online: sql<boolean>`${controllerStatus.lastSeenAt} > now() - interval '30 seconds'`
  }).from(controllerStatus).where(eq(controllerStatus.id, controllerId));
  return row?.online ?? false;
}
