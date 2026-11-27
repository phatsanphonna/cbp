import { eq, sql } from 'drizzle-orm';
import type { openDatabase } from './index.js';
import { controllerStatus } from './inventory-schema.js';

type Database = ReturnType<typeof openDatabase>;
const controllerId = 1;
const freshForSeconds = 30;

export function saveControllerHeartbeat(db: Database) {
  const lastSeenAt = sql`clock_timestamp()`;
  return db.transaction(async (tx) => {
    await tx
      .insert(controllerStatus)
      .values({ id: controllerId, lastSeenAt })
      .onConflictDoUpdate({ target: controllerStatus.id, set: { lastSeenAt } });
    await tx.execute(sql`select pg_notify('cbp_deployment_updates', 'controller')`);
  });
}

export async function controllerHeartbeatRemaining(db: Database) {
  const [row] = await db
    .select({
      remaining:
        sql<number>`extract(epoch from (${controllerStatus.lastSeenAt} - clock_timestamp())) * 1000 + ${freshForSeconds * 1000}`.mapWith(
          Number,
        ),
    })
    .from(controllerStatus)
    .where(eq(controllerStatus.id, controllerId));
  return Math.max(0, row?.remaining ?? 0);
}

export async function controllerIsOnline(db: Database) {
  return (await controllerHeartbeatRemaining(db)) > 0;
}
