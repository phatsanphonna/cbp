import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './index.js';
import {
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
      const status = async () =>
        (await listRenewals(db)).find((row) => row.id === id);
      const initial = await status();
      expect(initial?.enabled).toBe(false);
      expect(initial?.nextAttempt.getTime()).toBe(now - day / 3);
      expect(await findIssuedCertificate(db, original.sans)).toBeUndefined();

      await setAutoRenew(db, id, true, original.fingerprint);
      const claims = (
        await Promise.all([claimRenewal(db), claimRenewal(db)])
      ).filter(Boolean);
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
      expect(await findRenewalKey(db, id, renewed.fullchain)).toBe(
        'encrypted key',
      );
      expect(await updateCertificateChain(db, id, original)).toBe(true);
      expect(await findRenewalKey(db, id, original.fullchain)).toBeNull();
      expect(
        await updateCertificateChain(db, id, renewed, renewed.fullchain),
      ).toBe(true);
      expect(await findRenewalKey(db, id, renewed.fullchain)).toBe(
        'encrypted key',
      );
    } finally {
      await removeCertificate(db, id);
      await db.$client.close();
    }
  },
);
