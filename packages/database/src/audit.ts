import { desc } from "drizzle-orm";
import type { openDatabase } from "./index.js";
import { auditEvents } from "./inventory-schema.js";

type Database = ReturnType<typeof openDatabase>;
type AuditEvent = Omit<typeof auditEvents.$inferInsert, "id" | "occurredAt">;

export async function recordAuditEvent(db: Database, event: AuditEvent) {
  await db.insert(auditEvents).values(event);
}

export function listAuditEvents(db: Database, offset: number, limit: number) {
  return db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .offset(offset)
    .limit(limit);
}
