import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { canAccessAsset, setAssetOwners, visibleAssetIds } from './asset-owners.js';
import { user } from './auth-schema.js';
import { openDatabase } from './index.js';
import { listCertificates, listHosts, removeCertificate } from './inventory.js';
import {
  assetOwners,
  certificates,
  hosts,
  userGroupMembers,
  userGroups,
} from './inventory-schema.js';

const databaseURL = Bun.env.CBP_TEST_DATABASE_URL;

test.skipIf(!databaseURL)('owners limit who sees certificates, hosts, and credentials', async () => {
  const db = openDatabase(databaseURL);
  const [owner, member, stranger] = [randomUUID(), randomUUID(), randomUUID()];
  const certificateId = randomUUID();
  const hostId = randomUUID();
  const credentialId = randomUUID();
  let groupId = 0;
  try {
    await db.insert(user).values(
      [owner, member, stranger].map((id) => ({ id, name: id, email: `${id}@example.test` })),
    );
    [{ id: groupId }] = await db
      .insert(userGroups)
      .values({ name: randomUUID() })
      .returning({ id: userGroups.id });
    await db.insert(userGroupMembers).values({ groupId, userId: member });
    await db.insert(certificates).values({
      id: certificateId,
      domain: `${certificateId}.example.test`,
      issuer: 'test',
      serial: certificateId,
      validFrom: new Date(0),
      validUntil: new Date('2099-01-01'),
    });
    await db.insert(hosts).values({ id: hostId, name: `${hostId}.example.test` });

    const as = (userId: string, groupIds: number[] = []) => ({ userId, groupIds });
    const seesCertificate = async (viewer: ReturnType<typeof as> | null) =>
      (await listCertificates(db, undefined, viewer ?? undefined)).some(
        ({ id }) => id === certificateId,
      );

    // Unowned assets stay visible to everyone.
    expect(await seesCertificate(as(stranger))).toBe(true);
    expect(await canAccessAsset(db, 'credential', credentialId, as(stranger))).toBe(true);

    expect(
      await setAssetOwners(db, 'certificate', certificateId, [owner], [groupId]),
    ).toBe('saved');
    await setAssetOwners(db, 'host', hostId, [owner], []);
    await setAssetOwners(db, 'credential', credentialId, [], [groupId]);
    expect(await setAssetOwners(db, 'host', hostId, [randomUUID()], [])).toBe('invalid-owners');

    expect(await seesCertificate(as(owner))).toBe(true);
    expect(await seesCertificate(as(member, [groupId]))).toBe(true);
    expect(await seesCertificate(as(stranger))).toBe(false);
    expect(await seesCertificate(null)).toBe(true);

    const hostIds = async (viewer: ReturnType<typeof as>) =>
      (await listHosts(db, viewer)).map(({ id }) => id);
    expect(await hostIds(as(owner))).toContain(hostId);
    expect(await hostIds(as(member, [groupId]))).not.toContain(hostId);

    expect(await visibleAssetIds(db, 'credential', [credentialId], as(member, [groupId]))).toEqual([
      credentialId,
    ]);
    expect(await visibleAssetIds(db, 'credential', [credentialId], as(owner))).toEqual([]);

    expect(await removeCertificate(db, certificateId)).toBe(true);
    expect(
      await db.select().from(assetOwners).where(eq(assetOwners.assetId, certificateId)),
    ).toEqual([]);
  } finally {
    try {
      await db
        .delete(assetOwners)
        .where(inArray(assetOwners.assetId, [certificateId, hostId, credentialId]));
      await db.delete(certificates).where(eq(certificates.id, certificateId));
      await db.delete(hosts).where(eq(hosts.id, hostId));
      if (groupId) await db.delete(userGroups).where(eq(userGroups.id, groupId));
      await db.delete(user).where(inArray(user.id, [owner, member, stranger]));
    } finally {
      await db.$client.close();
    }
  }
});
