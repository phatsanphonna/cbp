import { BETTER_AUTH_SECRET, CBP_LETS_ENCRYPT_EMAIL } from '$app/env/private';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { Client, axios, crypto, directory } from 'acme-client';
import { updateCertificateChain } from '@cbp/database/inventory';
import {
  claimRenewal,
  expireAcmeChallenges,
  findAcmeAccount,
  recordRenewalFailure,
  removeAcmeChallenge,
  saveAcmeAccount,
  saveAcmeChallenge,
} from '@cbp/database/renewals';
import { parseCertificateChain } from './certificate-chain.js';
import { getDatabase } from './database.js';
import { decryptSecret, encryptSecret } from './encrypted-secret.js';
import { letsEncryptNames } from './renewal-names.js';

const email = CBP_LETS_ENCRYPT_EMAIL?.trim();
export const renewalAvailable = Boolean(
  email && (BETTER_AUTH_SECRET?.length ?? 0) >= 32,
);
export const acmeToken = /^[A-Za-z0-9_-]{22,128}$/;
const provider = 'letsencrypt';
const accountContext = 'cbp/letsencrypt/account/v1';
export const renewalKeyContext = (id: string) =>
  'cbp/letsencrypt/certificate/v1/' + id;

async function accountKey(db: ReturnType<typeof getDatabase>) {
  let stored = await findAcmeAccount(db, provider);
  if (!stored) {
    const pem = await crypto.createPrivateEcdsaKey();
    await saveAcmeAccount(
      db,
      provider,
      encryptSecret(pem.toString(), accountContext),
    );
    stored = await findAcmeAccount(db, provider);
  }
  return stored && decryptSecret(stored, accountContext);
}

export async function issueLetsEncryptCertificate(
  db: ReturnType<typeof getDatabase>,
  domain: string,
  names: string[],
  expiresAt: Date,
) {
  let failure =
    'Could not load the Let’s Encrypt account. Check the server secret and database.';
  try {
    const key = await accountKey(db);
    if (!key) return { message: failure };

    axios.defaults.timeout = 15_000;
    const client = new Client({
      directoryUrl: directory.letsencrypt.production,
      accountKey: key,
      backoffAttempts: 15,
      backoffMax: 10_000,
    });
    const leafKey = await crypto.createPrivateEcdsaKey();
    const [privateKey, csr] = await crypto.createCsr(
      {
        commonName:
          domain.length <= 64
            ? domain
            : names.find((name) => name.length <= 64),
        altNames: names,
      },
      leafKey,
    );
    failure =
      'Let’s Encrypt could not issue the certificate. Check DNS and public HTTP access on port 80 for every hostname.';
    const fullchain = await client.auto({
      csr,
      email,
      termsOfServiceAgreed: true,
      challengePriority: ['http-01'],
      skipChallengeVerification: true,
      challengeCreateFn: async (_authz, { type, token }, authorization) => {
        if (type !== 'http-01' || !token || !acmeToken.test(token)) {
          throw new Error('Invalid HTTP-01 challenge');
        }
        await saveAcmeChallenge(db, token, authorization, expiresAt);
      },
      challengeRemoveFn: async (_authz, { token }) => {
        if (token) await removeAcmeChallenge(db, token);
      },
    });

    failure =
      'Let’s Encrypt returned a certificate with unexpected names, validity, or key.';
    const chain = parseCertificateChain(fullchain);
    const issuedNames = letsEncryptNames(domain, fullchain);
    const now = Date.now();
    if (
      'message' in chain ||
      issuedNames?.join(',') !== names.join(',') ||
      chain.metadata.validFrom.getTime() > now ||
      chain.metadata.validUntil.getTime() <= now ||
      !new X509Certificate(fullchain).checkPrivateKey(
        createPrivateKey(privateKey),
      )
    )
      return { message: failure };

    return { metadata: chain.metadata, privateKey: privateKey.toString() };
  } catch {
    console.error('Let’s Encrypt issuance failed', {
      domain,
      message: failure,
    });
    return { message: failure };
  }
}

export async function renewDueCertificate() {
  if (!renewalAvailable) return;
  const db = getDatabase();
  await expireAcmeChallenges(db);
  const certificate = await claimRenewal(db);
  if (!certificate) return;

  let failure =
    'This certificate needs a Let’s Encrypt fullchain with only non-wildcard DNS names.';
  try {
    const names = letsEncryptNames(certificate.domain, certificate.fullchain);
    if (!names) return;
    const issued = await issueLetsEncryptCertificate(
      db,
      certificate.domain,
      names,
      certificate.retryAt,
    );
    if (!issued.metadata) {
      failure = issued.message;
      return;
    }
    if (issued.metadata.validUntil <= certificate.validUntil) {
      failure =
        'Let’s Encrypt returned a certificate that does not extend the current expiry date.';
      return;
    }

    failure = 'Could not save the renewed certificate.';
    const result = await updateCertificateChain(
      db,
      certificate.id,
      issued.metadata,
      undefined,
      {
        fingerprint: certificate.fingerprint,
        retryAt: certificate.retryAt,
        encryptedKey: encryptSecret(
          issued.privateKey,
          renewalKeyContext(certificate.id),
        ),
      },
    );
    if (result === 'duplicate') return;
    failure = '';
  } catch {
    console.error('Let’s Encrypt renewal failed', {
      certificateId: certificate.id,
      message: failure,
    });
  } finally {
    if (failure)
      await recordRenewalFailure(
        db,
        certificate.id,
        certificate.retryAt,
        failure,
      );
  }
}
