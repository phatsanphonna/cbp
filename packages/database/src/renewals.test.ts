import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './index.js';
import {
  listCertificateVersions,
  registerCertificate,
  removeCertificate,
  updateCertificateChain,
} from './inventory.js';
import {
  claimRenewal,
  findIssuedCertificate,
  findRenewalKey,
  listRenewals,
  recordRenewalFailure,
  setAutoRenew,
} from './renewals.js';

const databaseURL = Bun.env.CBP_TEST_DATABASE_URL;
const day = 86_400_000;

test.skipIf(!databaseURL)(
  'renewals use the actual lifetime, reserve one attempt, and preserve the key on rollback',
  async () => {
    const db = openDatabase(databaseURL);
    const now = Date.now();
    const id = randomUUID();
    const original = {
      issuer: "O=Let's Encrypt",
      serial: id,
      fingerprint: id,
      fullchain: 'original chain',
      validFrom: new Date(now - 43 * day),
      validUntil: new Date(now + 21 * day),
      sans: ['renewal.example.com'],
    };

    try {
      await registerCertificate(db, {
        id,
        domain: 'renewal.example.com',
        ...original,
      });
      const status = async () => (await listRenewals(db)).find((row) => row.id === id);
      const initial = await status();
      expect(initial?.enabled).toBe(false);
      expect(initial?.nextAttempt.getTime()).toBe(now - day / 3);
      expect(await findIssuedCertificate(db, original.sans)).toBeUndefined();

      await setAutoRenew(db, id, true, original.fingerprint);
      const claims = (await Promise.all([claimRenewal(db), claimRenewal(db)])).filter(Boolean);
      expect(claims).toHaveLength(1);
      const attempt = claims[0]!;
      expect(attempt.id).toBe(id);
      await recordRenewalFailure(db, id, attempt.retryAt, 'Validation failed');
      expect((await status())?.lastError).toBe('Validation failed');
      expect(await claimRenewal(db)).toBeUndefined();

      const renewed = {
        ...original,
        fingerprint: randomUUID(),
        fullchain: 'renewed chain',
        validFrom: new Date(now),
        validUntil: new Date(now + 64 * day),
      };
      expect(
        await updateCertificateChain(db, id, renewed, undefined, {
          fingerprint: original.fingerprint,
          retryAt: attempt.retryAt,
          encryptedKey: 'encrypted key',
        }),
      ).toBe(true);
      expect((await status())?.lastError).toBeNull();
      expect(await findIssuedCertificate(db, renewed.sans)).toEqual({ id });
      expect(
        await findIssuedCertificate(db, [...renewed.sans, 'extra.example.com']),
      ).toBeUndefined();
      expect(await findRenewalKey(db, id, renewed.fullchain)).toBe('encrypted key');
      expect(await updateCertificateChain(db, id, original)).toBe(true);
      expect(await findRenewalKey(db, id, original.fullchain)).toBeNull();
      const [renewedVersion, originalVersion] = await listCertificateVersions(db, id);
      expect(renewedVersion).toMatchObject({ fullchain: renewed.fullchain, hasKey: true });
      expect(originalVersion).toMatchObject({ fullchain: original.fullchain });

      // A version id from the wrong chain or an unknown id is rejected.
      expect(await updateCertificateChain(db, id, renewed, originalVersion.id)).toBe('changed');
      expect(await updateCertificateChain(db, id, renewed, randomUUID())).toBe('changed');

      expect(await updateCertificateChain(db, id, renewed, renewedVersion.id)).toBe(true);
      expect(await findRenewalKey(db, id, renewed.fullchain)).toBe('encrypted key');
      const afterRestore = await listCertificateVersions(db, id);
      expect(afterRestore.map((version) => version.fullchain)).toEqual([
        original.fullchain,
        original.fullchain,
      ]);
      expect(afterRestore.some((version) => version.id === renewedVersion.id)).toBe(false);

      for (const versionNumber of [1, 2, 3, 4])
        await updateCertificateChain(db, id, {
          ...original,
          fingerprint: randomUUID(),
          fullchain: `chain ${versionNumber}`,
        });
      expect((await listCertificateVersions(db, id)).map((version) => version.fullchain)).toEqual([
        'chain 3',
        'chain 2',
        'chain 1',
      ]);
    } finally {
      await removeCertificate(db, id);
      await db.$client.close();
    }
  },
);
