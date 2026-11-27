import {
  and,
  arrayContained,
  arrayContains,
  asc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { openDatabase } from './index.js';
import { acmeAccounts, acmeChallenges, certificates } from './inventory-schema.js';

type Database = ReturnType<typeof openDatabase>;
const renewalAt = sql`greatest(
  ${certificates.validFrom} + (${certificates.validUntil} - ${certificates.validFrom}) * (2.0 / 3.0),
  ${certificates.renewalRetryAt}
)`.mapWith(certificates.validUntil);

const source = {
  id: certificates.id,
  domain: certificates.domain,
  issuer: certificates.issuer,
  autoRenew: certificates.autoRenew,
  hasRenewalKey: isNotNull(certificates.renewalKey),
  sans: certificates.sans,
  fullchain: certificates.fullchain,
  fingerprint: certificates.fingerprint,
  validUntil: certificates.validUntil,
};

export async function findIssuedCertificate(db: Database, names: string[]) {
  const [row] = await db
    .select({ id: certificates.id })
    .from(certificates)
    .where(
      and(
        isNotNull(certificates.renewalKey),
        ilike(certificates.issuer, "%Let's Encrypt%"),
        gt(certificates.validUntil, new Date()),
        arrayContains(certificates.sans, names),
        arrayContained(certificates.sans, names),
      ),
    )
    .limit(1);
  return row;
}

export function listRenewals(db: Database) {
  return db
    .select({
      id: certificates.id,
      domain: certificates.domain,
      issuer: certificates.issuer,
      hasRenewalKey: isNotNull(certificates.renewalKey),
      sans: certificates.sans,
      enabled: certificates.autoRenew,
      fullchain: certificates.fullchain,
      hasFullchain: isNotNull(certificates.fullchain),
      validUntil: certificates.validUntil,
      nextAttempt: renewalAt,
      lastError: certificates.renewalError,
    })
    .from(certificates)
    .where(
      or(
        certificates.autoRenew,
        ilike(certificates.issuer, "%Let's Encrypt%"),
        ilike(certificates.issuer, '%CN=Self-signed certificate%'),
      ),
    )
    .orderBy(asc(certificates.validUntil));
}

export async function findRenewalSource(db: Database, id: string) {
  const [certificate] = await db.select(source).from(certificates).where(eq(certificates.id, id));
  return certificate;
}

export function setAutoRenew(db: Database, id: string, enabled: boolean, fingerprint?: string) {
  return db
    .update(certificates)
    .set({ autoRenew: enabled, renewalRetryAt: null, renewalError: null })
    .where(
      and(
        eq(certificates.id, id),
        eq(certificates.autoRenew, !enabled),
        fingerprint === undefined ? undefined : eq(certificates.fingerprint, fingerprint),
      ),
    )
    .returning({ id: certificates.id });
}

export function setAutoDeploy(db: Database, id: string, enabled: boolean) {
  return db
    .update(certificates)
    .set({ autoDeploy: enabled })
    .where(and(eq(certificates.id, id), eq(certificates.autoDeploy, !enabled)))
    .returning({ id: certificates.id });
}

export async function claimRenewal(
  db: Database,
  issuer: 'letsencrypt' | 'self-signed' = 'letsencrypt',
  certificateId?: string,
  force = false,
) {
  const retryAt = new Date(Date.now() + 60 * 60_000);
  const issuerPattern =
    issuer === 'letsencrypt' ? "%Let's Encrypt%" : '%CN=Self-signed certificate%';
  const renewalCandidate = db
    .select({ id: certificates.id })
    .from(certificates)
    .where(
      and(
        force ? undefined : certificates.autoRenew,
        certificateId ? eq(certificates.id, certificateId) : undefined,
        ilike(certificates.issuer, issuerPattern),
        issuer === 'self-signed' && !force ? isNotNull(certificates.renewalKey) : undefined,
        force
          ? or(
              isNull(certificates.renewalRetryAt),
              lte(certificates.renewalRetryAt, new Date()),
              isNotNull(certificates.renewalError),
            )
          : lte(renewalAt, new Date()),
      ),
    )
    .orderBy(asc(renewalAt), asc(certificates.id))
    .limit(1)
    // Skip certificates already claimed by another renewal worker.
    .for('update', { skipLocked: true });
  const [certificate] = await db
    .update(certificates)
    .set({ renewalRetryAt: retryAt, renewalError: null })
    .where(eq(certificates.id, renewalCandidate))
    .returning(source);
  return certificate && { ...certificate, retryAt };
}

export function recordRenewalFailure(db: Database, id: string, retryAt: Date, message: string) {
  return db
    .update(certificates)
    .set({ renewalError: message })
    .where(and(eq(certificates.id, id), eq(certificates.renewalRetryAt, retryAt)));
}

export function recordRenewalWarning(db: Database, id: string, message: string) {
  return db.update(certificates).set({ renewalError: message }).where(eq(certificates.id, id));
}

export async function findRenewalKey(db: Database, id: string, fullchain: string) {
  const [row] = await db
    .select({ key: certificates.renewalKey })
    .from(certificates)
    .where(and(eq(certificates.id, id), eq(certificates.fullchain, fullchain)));
  return row?.key;
}

export async function findAcmeAccount(db: Database, id: string) {
  const [row] = await db.select().from(acmeAccounts).where(eq(acmeAccounts.id, id));
  return row?.encryptedKey;
}

export function saveAcmeAccount(db: Database, id: string, encryptedKey: string) {
  return db.insert(acmeAccounts).values({ id, encryptedKey }).onConflictDoNothing();
}

export async function findAcmeChallenge(db: Database, token: string) {
  const [row] = await db
    .select({ authorization: acmeChallenges.authorization })
    .from(acmeChallenges)
    .where(and(eq(acmeChallenges.token, token), gt(acmeChallenges.expiresAt, new Date())));
  return row?.authorization;
}

export function saveAcmeChallenge(
  db: Database,
  token: string,
  authorization: string,
  expiresAt: Date,
) {
  return db.insert(acmeChallenges).values({ token, authorization, expiresAt });
}

export function removeAcmeChallenge(db: Database, token: string) {
  return db.delete(acmeChallenges).where(eq(acmeChallenges.token, token));
}

export function expireAcmeChallenges(db: Database) {
  return db.delete(acmeChallenges).where(lte(acmeChallenges.expiresAt, new Date()));
}
