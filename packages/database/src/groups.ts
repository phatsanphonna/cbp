import { and, asc, eq } from 'drizzle-orm';
import { user } from './auth-schema.js';
import type { openDatabase } from './index.js';
import { userGroupMembers, userGroups } from './inventory-schema.js';

type Database = ReturnType<typeof openDatabase>;

export function listGroups(db: Database) {
  return db.select().from(userGroups).orderBy(asc(userGroups.name));
}

export async function groupExists(db: Database, id: number) {
  const [group] = await db.select({ id: userGroups.id }).from(userGroups).where(eq(userGroups.id, id));
  return !!group;
}

export async function listGroupDirectory(db: Database) {
  const [groups, users, members] = await Promise.all([
    listGroups(db),
    db.select({ id: user.id, name: user.name, email: user.email }).from(user).orderBy(asc(user.name), asc(user.email)),
    db.select().from(userGroupMembers)
  ]);
  return { groups, users, members };
}

export function createGroup(db: Database, name: string) {
  return db.insert(userGroups).values({ name }).onConflictDoNothing().returning({ id: userGroups.id });
}

export async function addGroupMember(db: Database, groupId: number, userId: string) {
  return db.transaction(async (tx) => {
    const [group] = await tx.select({ id: userGroups.id }).from(userGroups).where(eq(userGroups.id, groupId)).for('key share');
    if (!group) return false;
    const [account] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('key share');
    if (!account) return false;
    await tx.insert(userGroupMembers).values({ groupId, userId }).onConflictDoNothing();
    return true;
  });
}

export function removeGroupMember(db: Database, groupId: number, userId: string) {
  return db.delete(userGroupMembers)
    .where(and(eq(userGroupMembers.groupId, groupId), eq(userGroupMembers.userId, userId)));
}
