import { and, asc, eq, exists, inArray, notExists, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { openDatabase } from './index.js';
import { user } from './auth-schema.js';
import { alerts, assetOwners, userGroups } from './inventory-schema.js';

type Database = ReturnType<typeof openDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type AssetKind = (typeof assetOwners.assetKind.enumValues)[number];
// null means the viewer bypasses ownership (admin or sudo).
export type Viewer = { userId: string; groupIds: number[] } | null;

const assetId = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

function ownersOf(kind: AssetKind, id: AnyPgColumn | SQL) {
  return and(eq(assetOwners.assetKind, kind), sql`${assetOwners.assetId} = ${id}`);
}

// Unowned assets are visible to everyone; owned ones only to their users and group members.
export function visibleAsset(
  db: Pick<Database, 'select'>,
  kind: AssetKind,
  id: AnyPgColumn | SQL,
  viewer: Viewer | undefined,
) {
  if (!viewer) return undefined;
  const owners = () => db.select({ one: sql`1` }).from(assetOwners);
  return or(
    notExists(owners().where(ownersOf(kind, id))),
    exists(
      owners().where(
        and(
          ownersOf(kind, id),
          or(
            eq(assetOwners.userId, viewer.userId),
            viewer.groupIds.length ? inArray(assetOwners.groupId, viewer.groupIds) : undefined,
          ),
        ),
      ),
    ),
  );
}

export async function canAccessAsset(
  db: Database,
  kind: AssetKind,
  id: string,
  viewer: Viewer | undefined,
) {
  if (!viewer) return true;
  if (!assetId.test(id)) return false;
  return (await visibleAssetIds(db, kind, [id], viewer)).length === 1;
}

export async function visibleAssetIds(
  db: Database,
  kind: AssetKind,
  ids: string[],
  viewer: Viewer | undefined,
) {
  if (!viewer) return ids;
  ids = ids.filter((id) => assetId.test(id));
  if (!ids.length) return ids;
  const owned = await db
    .select({ id: assetOwners.assetId, userId: assetOwners.userId, groupId: assetOwners.groupId })
    .from(assetOwners)
    .where(and(eq(assetOwners.assetKind, kind), inArray(assetOwners.assetId, ids)));
  return ids.filter((id) => {
    const owners = owned.filter((owner) => owner.id === id);
    return (
      !owners.length ||
      owners.some(
        (owner) =>
          owner.userId === viewer.userId ||
          (owner.groupId !== null && viewer.groupIds.includes(owner.groupId)),
      )
    );
  });
}

export async function listAssetOwners(db: Database, kind: AssetKind, id: string) {
  const [users, groups] = await Promise.all([
    db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(assetOwners)
      .innerJoin(user, eq(user.id, assetOwners.userId))
      .where(ownersOf(kind, sql`${id}::uuid`))
      .orderBy(asc(user.name)),
    db
      .select({ id: userGroups.id, name: userGroups.name })
      .from(assetOwners)
      .innerJoin(userGroups, eq(userGroups.id, assetOwners.groupId))
      .where(ownersOf(kind, sql`${id}::uuid`))
      .orderBy(asc(userGroups.name)),
  ]);
  return { users, groups };
}

export async function listOwnerOptions(db: Database) {
  const [users, groups] = await Promise.all([
    db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .orderBy(asc(user.name), asc(user.email)),
    db
      .select({ id: userGroups.id, name: userGroups.name })
      .from(userGroups)
      .orderBy(asc(userGroups.name)),
  ]);
  return { users, groups };
}

export async function setAssetOwners(
  db: Database,
  kind: AssetKind,
  id: string,
  userIds: string[],
  groupIds: number[],
) {
  if (!assetId.test(id)) return 'missing' as const;
  const users = [...new Set(userIds)];
  const groups = [...new Set(groupIds)];
  return db.transaction(async (tx) => {
    if (users.length) {
      const found = await tx.select({ id: user.id }).from(user).where(inArray(user.id, users));
      if (found.length !== users.length) return 'invalid-owners' as const;
    }
    if (groups.length) {
      const found = await tx
        .select({ id: userGroups.id })
        .from(userGroups)
        .where(inArray(userGroups.id, groups))
        .for('key share');
      if (found.length !== groups.length) return 'invalid-owners' as const;
    }
    await removeAssetOwners(tx, kind, id);
    const rows = [
      ...users.map((userId) => ({ assetKind: kind, assetId: id, userId })),
      ...groups.map((groupId) => ({ assetKind: kind, assetId: id, groupId })),
    ];
    if (rows.length) await tx.insert(assetOwners).values(rows);
    return 'saved' as const;
  });
}

export async function addAssetOwner(
  db: Database | Transaction,
  kind: AssetKind,
  id: string,
  userId: string,
) {
  await db
    .insert(assetOwners)
    .values({ assetKind: kind, assetId: id, userId })
    .onConflictDoNothing();
}

export async function removeAssetOwners(db: Database | Transaction, kind: AssetKind, id: string) {
  await db.delete(assetOwners).where(ownersOf(kind, sql`${id}::uuid`));
}

// Host alerts target a host id; every other alert rule targets a certificate id.
export function visibleAlert(db: Pick<Database, 'select'>, viewer: Viewer | undefined) {
  if (!viewer) return undefined;
  const target = sql`(case when ${alerts.targetId} ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then ${alerts.targetId}::uuid end)`;
  const hostAlert = sql`coalesce(${alerts.ruleKey}, '') like 'host-no-reply:%'`;
  return or(
    and(hostAlert, visibleAsset(db, 'host', target, viewer)),
    and(sql`not (${hostAlert})`, visibleAsset(db, 'certificate', target, viewer)),
  );
}
