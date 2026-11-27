import { BETTER_AUTH_SECRET, CBP_LETS_ENCRYPT_EMAIL } from '$app/env/private';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { axios, Client, crypto, directory } from 'acme-client';
import { updateCertificateChain } from '@cbp/database/inventory';
import {
  claimRenewal,
  expireAcmeChallenges,
  findAcmeAccount,
  findRenewalKey,
  findRenewalSource,
  recordRenewalFailure,
  recordRenewalWarning,
  removeAcmeChallenge,
  saveAcmeAccount,
  saveAcmeChallenge,
} from '@cbp/database/renewals';
import { parseCertificateChain } from './certificate-chain.js';
import { getDatabase } from './database.js';
import { decryptSecret, encryptSecret } from './encrypted-secret.js';
import { saveCredential, savedCredentialsAvailable } from './deployment-secrets.js';
import { autoDeployRenewal } from './auto-deploy.js';
import { letsEncryptNames } from './renewal-names.js';
import {
  renewSelfSignedCertificate,
  selfSignedCertificateNames,
  selfSignedKeyContext,
} from './self-signed-certificate.js';

const email = CBP_LETS_ENCRYPT_EMAIL?.trim();
export const renewalAvailable = Boolean(email && (BETTER_AUTH_SECRET?.length ?? 0) >= 32);
export const selfSignedRenewalAvailable = (BETTER_AUTH_SECRET?.length ?? 0) >= 32;
export const acmeToken = /^[A-Za-z0-9_-]{22,128}$/;
const provider = 'letsencrypt';
const accountContext = 'cbp/letsencrypt/account/v1';
export const renewalKeyContext = (id: string) => 'cbp/letsencrypt/certificate/v1/' + id;

async function accountKey(db: ReturnType<typeof getDatabase>) {
  let stored = await findAcmeAccount(db, provider);
  if (!stored) {
    const pem = await crypto.createPrivateEcdsaKey();
    await saveAcmeAccount(db, provider, encryptSecret(pem.toString(), accountContext));
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
  let failure = 'Could not load the Let’s Encrypt account. Check the server secret and database.';
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
        commonName: domain.length <= 64 ? domain : names.find((name) => name.length <= 64),
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

    failure = 'Let’s Encrypt returned a certificate with unexpected names, validity, or key.';
    const chain = parseCertificateChain(fullchain);
    const issuedNames = letsEncryptNames(domain, fullchain);
    const now = Date.now();
    if (
      'message' in chain ||
      issuedNames?.join(',') !== names.join(',') ||
      chain.metadata.validFrom.getTime() > now ||
      chain.metadata.validUntil.getTime() <= now ||
      !new X509Certificate(fullchain).checkPrivateKey(createPrivateKey(privateKey))
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
  if (!selfSignedRenewalAvailable) return;
  const db = getDatabase();
  if (renewalAvailable) {
    await expireAcmeChallenges(db);
    await renewDueLetsEncrypt(db);
  }
  await renewDueSelfSigned(db);
}

export async function renewCertificateNow(id: string, privateKeyOverride?: string) {
  const db = getDatabase();
  const source = await findRenewalSource(db, id);
  if (!source) return { ok: false as const, status: 404, message: 'Certificate not found.' };

  if (source.issuer === 'CN=Self-signed certificate') {
    if (!selfSignedRenewalAvailable)
      return {
        ok: false as const,
        status: 503,
        message: 'A 32-character server secret is required for renewal.',
      };
    if (
      !selfSignedCertificateNames(source.domain, source.fullchain) ||
      (!source.hasRenewalKey && !privateKeyOverride)
    )
      return {
        ok: false as const,
        status: 400,
        message:
          'This self-signed certificate needs a valid fullchain and matching private key to renew.',
      };
    const renewal = await renewDueSelfSigned(db, id, privateKeyOverride);
    return renewal
      ? {
          ok: true as const,
          privateKey: renewal.privateKey,
          warning: renewal.warning,
        }
      : {
          ok: false as const,
          status: 409,
          message: 'Renewal could not complete. Refresh and try again later.',
        };
  }

  if (!renewalAvailable)
    return {
      ok: false as const,
      status: 503,
      message: 'Configure Let’s Encrypt on the server first.',
    };
  if (!letsEncryptNames(source.domain, source.fullchain))
    return {
      ok: false as const,
      status: 400,
      message:
        'This certificate needs a valid Let’s Encrypt fullchain with non-wildcard DNS names.',
    };
  const renewal = await renewDueLetsEncrypt(db, id);
  return renewal
    ? { ok: true as const, warning: renewal.warning }
    : {
        ok: false as const,
        status: 409,
        message: 'Renewal could not complete. Refresh and try again later.',
      };
}

async function renewDueLetsEncrypt(db: ReturnType<typeof getDatabase>, certificateId?: string) {
  const certificate = await claimRenewal(db, 'letsencrypt', certificateId, Boolean(certificateId));
  if (!certificate) return false;

  let failure =
    'This certificate needs a Let’s Encrypt fullchain with only non-wildcard DNS names.';
  try {
    const names = letsEncryptNames(certificate.domain, certificate.fullchain);
    if (!names) return false;
    const issued = await issueLetsEncryptCertificate(
      db,
      certificate.domain,
      names,
      certificate.retryAt,
    );
    if (!issued.metadata) {
      failure = issued.message;
      return false;
    }
    if (issued.metadata.validUntil <= certificate.validUntil) {
      failure =
        'Let’s Encrypt returned a certificate that does not extend the current expiry date.';
      return false;
    }

    failure = 'Could not save the renewed certificate.';
    const result = await updateCertificateChain(db, certificate.id, issued.metadata, undefined, {
      fingerprint: certificate.fingerprint,
      retryAt: certificate.retryAt,
      encryptedKey: encryptSecret(issued.privateKey, renewalKeyContext(certificate.id)),
    });
    if (result === 'changed' || result === 'duplicate' || !result) return false;
    failure = '';
    const warning = await storeRenewedKey(db, certificate.id, issued.privateKey);
    return { warning };
  } catch {
    console.error('Let’s Encrypt renewal failed', {
      certificateId: certificate.id,
      message: failure,
    });
  } finally {
    if (failure) await recordRenewalFailure(db, certificate.id, certificate.retryAt, failure);
  }
  return false;
}

async function renewDueSelfSigned(
  db: ReturnType<typeof getDatabase>,
  certificateId?: string,
  privateKeyOverride?: string,
) {
  const certificate = await claimRenewal(db, 'self-signed', certificateId, Boolean(certificateId));
  if (!certificate) return false;

  let failure = 'Could not renew the self-signed certificate.';
  try {
    const fullchain = certificate.fullchain;
    if (!fullchain) return false;
    const names = selfSignedCertificateNames(certificate.domain, fullchain);
    if (!names) return false;
    const vaultConfigured = savedCredentialsAvailable();
    const encryptedKey = await findRenewalKey(db, certificate.id, fullchain);
    const storedPrivateKey = encryptedKey
      ? decryptSecret(encryptedKey, selfSignedKeyContext(certificate.id))
      : null;
    const privateKey = privateKeyOverride ?? storedPrivateKey;
    if (!privateKey) {
      failure = 'The stored self-signed certificate key is unavailable.';
      return false;
    }

    const issued = await renewSelfSignedCertificate(names, fullchain, privateKey);
    if (issued.metadata.validUntil <= certificate.validUntil) {
      failure = 'The renewed certificate does not extend its expiry date.';
      return false;
    }

    failure = 'Could not save the renewed self-signed certificate.';
    const result = await updateCertificateChain(db, certificate.id, issued.metadata, undefined, {
      fingerprint: certificate.fingerprint,
      retryAt: certificate.retryAt,
      previousEncryptedKey: encryptSecret(privateKey, selfSignedKeyContext(certificate.id)),
      encryptedKey:
        certificate.autoRenew || encryptedKey || vaultConfigured
          ? encryptSecret(issued.privateKey, selfSignedKeyContext(certificate.id))
          : null,
    });
    if (result === 'changed' || result === 'duplicate' || !result) return false;
    failure = '';
    const warning = await storeRenewedKey(db, certificate.id, issued.privateKey);
    return { privateKey: issued.privateKey, warning };
  } catch {
    console.error('Self-signed certificate renewal failed', {
      certificateId: certificate.id,
      message: failure,
    });
  } finally {
    if (failure) await recordRenewalFailure(db, certificate.id, certificate.retryAt, failure);
  }
  return false;
}

async function storeRenewedKey(
  db: ReturnType<typeof getDatabase>,
  certificateId: string,
  privateKey: string,
) {
  const vaultWarning = savedCredentialsAvailable()
    ? await saveCredential('certificate', certificateId, privateKey)
        .then(() => undefined)
        .catch(() => 'Vault could not store the rotated private key.')
    : 'Vault is not configured, so the rotated private key was not saved there.';
  // The renewal is already saved, so a deploy failure must not fail it.
  const deployWarning = await autoDeployRenewal(db, certificateId, privateKey).catch(
    () => 'Automatic deployment could not be queued.',
  );
  const warning = [vaultWarning, deployWarning].filter(Boolean).join(' ');
  if (!warning) return undefined;

  try {
    await recordRenewalWarning(db, certificateId, warning);
  } catch {
    console.error('Could not record the renewal warning', {
      certificateId,
    });
  }
  console.error('Certificate renewal warning', {
    certificateId,
    message: warning,
  });
  return warning;
}
