import { asc, eq, inArray } from 'drizzle-orm';
import type { openDatabase } from './index.js';
import { user } from './auth-schema.js';
import {
  userGroupMembers,
  userGroupPermissions,
  userGroups,
  userPermissions,
} from './inventory-schema.js';

type Database = ReturnType<typeof openDatabase>;

export async function listUserPermissions(db: Database, userId: string) {
  const [groupGrants, directGrants] = await Promise.all([
    db
      .selectDistinct({ permission: userGroupPermissions.permission })
      .from(userGroupMembers)
      .innerJoin(userGroupPermissions, eq(userGroupPermissions.groupId, userGroupMembers.groupId))
      .where(eq(userGroupMembers.userId, userId)),
    db
      .select({ permission: userPermissions.permission })
      .from(userPermissions)
      .where(eq(userPermissions.userId, userId)),
  ]);
  return [...new Set([...groupGrants, ...directGrants].map(({ permission }) => permission))];
}

export async function listAccessGroups(db: Database) {
  const [groups, members, grants] = await Promise.all([
    db.select().from(userGroups).orderBy(asc(userGroups.name)),
    db
      .select({
        groupId: userGroupMembers.groupId,
        userId: user.id,
        name: user.name,
        email: user.email,
      })
      .from(userGroupMembers)
      .innerJoin(user, eq(user.id, userGroupMembers.userId))
      .orderBy(asc(user.name), asc(user.email)),
    db.select().from(userGroupPermissions),
  ]);
  return groups.map((group) => ({
    ...group,
    members: members.filter((member) => member.groupId === group.id),
    permissions: grants
      .filter((grant) => grant.groupId === group.id)
      .map(({ permission }) => permission),
  }));
}

export async function listAccessUsers(db: Database) {
  const [users, memberships, groupGrants, directGrants] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        displayUsername: user.displayUsername,
      })
      .from(user)
      .orderBy(asc(user.name), asc(user.email)),
    db
      .select({
        userId: userGroupMembers.userId,
        groupId: userGroups.id,
        groupName: userGroups.name,
      })
      .from(userGroupMembers)
      .innerJoin(userGroups, eq(userGroups.id, userGroupMembers.groupId)),
    db
      .select({ userId: userGroupMembers.userId, permission: userGroupPermissions.permission })
      .from(userGroupMembers)
      .innerJoin(userGroupPermissions, eq(userGroupPermissions.groupId, userGroupMembers.groupId)),
    db
      .select({ userId: userPermissions.userId, permission: userPermissions.permission })
      .from(userPermissions),
  ]);
  return users.map((account) => ({
    ...account,
    groups: memberships
      .filter((membership) => membership.userId === account.id)
      .map(({ groupName }) => groupName),
    groupIds: memberships
      .filter((membership) => membership.userId === account.id)
      .map(({ groupId }) => groupId),
    directPermissions: directGrants
      .filter((grant) => grant.userId === account.id)
      .map(({ permission }) => permission),
    permissions: [
      ...new Set([
        ...groupGrants
          .filter((grant) => grant.userId === account.id)
          .map(({ permission }) => permission),
        ...directGrants
          .filter((grant) => grant.userId === account.id)
          .map(({ permission }) => permission),
      ]),
    ],
  }));
}

export async function listAccessGroupOptions(db: Database) {
  return db
    .select({ id: userGroups.id, name: userGroups.name })
    .from(userGroups)
    .orderBy(asc(userGroups.name));
}

export async function createAccessGroup(db: Database, name: string) {
  const [group] = await db
    .insert(userGroups)
    .values({ name })
    .onConflictDoNothing()
    .returning({ id: userGroups.id });
  return group?.id;
}

export async function renameAccessGroup(db: Database, id: number, name: string) {
  const [group] = await db
    .update(userGroups)
    .set({ name })
    .where(eq(userGroups.id, id))
    .returning({ id: userGroups.id });
  return group?.id;
}

export async function removeAccessGroup(db: Database, id: number) {
  const [group] = await db
    .delete(userGroups)
    .where(eq(userGroups.id, id))
    .returning({ id: userGroups.id });
  return group?.id;
}

export async function setAccessGroupMembers(db: Database, groupId: number, userIds: string[]) {
  return db.transaction(async (tx) => {
    const [group] = await tx
      .select({ id: userGroups.id })
      .from(userGroups)
      .where(eq(userGroups.id, groupId))
      .for('update');
    if (!group) return 'missing' as const;
    if (userIds.length) {
      const existing = await tx.select({ id: user.id }).from(user).where(inArray(user.id, userIds));
      if (existing.length !== userIds.length) return 'invalid-users' as const;
    }
    await tx.delete(userGroupMembers).where(eq(userGroupMembers.groupId, groupId));
    if (userIds.length) {
      await tx.insert(userGroupMembers).values(userIds.map((userId) => ({ groupId, userId })));
    }
    return 'saved' as const;
  });
}

export async function setAccessUserGroups(db: Database, userId: string, groupIds: number[]) {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for('update');
    if (!account) return 'missing' as const;
    const uniqueGroupIds = [...new Set(groupIds)];
    if (uniqueGroupIds.length) {
      const existing = await tx
        .select({ id: userGroups.id })
        .from(userGroups)
        .where(inArray(userGroups.id, uniqueGroupIds))
        .for('update');
      if (existing.length !== uniqueGroupIds.length) return 'invalid-groups' as const;
    }
    await tx.delete(userGroupMembers).where(eq(userGroupMembers.userId, userId));
    if (uniqueGroupIds.length) {
      await tx
        .insert(userGroupMembers)
        .values(uniqueGroupIds.map((groupId) => ({ groupId, userId })));
    }
    return 'saved' as const;
  });
}

export async function setAccessUserPermissions(
  db: Database,
  userId: string,
  permissions: string[],
) {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for('update');
    if (!account) return 'missing' as const;
    const uniquePermissions = [...new Set(permissions)];
    await tx.delete(userPermissions).where(eq(userPermissions.userId, userId));
    if (uniquePermissions.length) {
      await tx
        .insert(userPermissions)
        .values(uniquePermissions.map((permission) => ({ userId, permission })));
    }
    return 'saved' as const;
  });
}

export async function setAccessGroupPermissions(
  db: Database,
  groupId: number,
  permissions: string[],
) {
  return db.transaction(async (tx) => {
    const [group] = await tx
      .select({ id: userGroups.id })
      .from(userGroups)
      .where(eq(userGroups.id, groupId))
      .for('update');
    if (!group) return false;
    await tx.delete(userGroupPermissions).where(eq(userGroupPermissions.groupId, groupId));
    if (permissions.length) {
      await tx
        .insert(userGroupPermissions)
        .values(permissions.map((permission) => ({ groupId, permission })));
    }
    return true;
  });
}
