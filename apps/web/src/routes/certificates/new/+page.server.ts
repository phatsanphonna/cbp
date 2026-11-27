import { resolve } from '$app/paths';
import { fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { registerCertificate } from '@cbp/database/inventory';
import { findIssuedCertificate } from '@cbp/database/renewals';
import { getDatabase } from '#lib/server/database.js';
import { readCertificateChain } from '#lib/server/certificate-chain.js';
import { encryptSecret } from '#lib/server/encrypted-secret.js';
import { assetViewer, hasPermission } from '#lib/server/access-control.js';
import { addAssetOwner } from '@cbp/database/asset-owners';
import { saveCredential, savedCredentialsAvailable } from '#lib/server/deployment-secrets.js';
import { hasTrustedTransport } from '#lib/server/trusted-transport.js';
import {
  generateSelfSignedCertificate,
  readSelfSignedNames,
  selfSignedKeyContext,
} from '#lib/server/self-signed-certificate.js';
import {
  issueLetsEncryptCertificate,
  renewalAvailable,
  renewalKeyContext,
  selfSignedRenewalAvailable,
} from '#lib/server/lets-encrypt.js';
import { readIssuanceNames } from '#lib/server/renewal-names.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = (event) => ({
  issue: event.url.searchParams.get('method') === 'letsencrypt',
  selfSigned: event.url.searchParams.get('method') === 'selfsigned',
  renewalAvailable,
  selfSignedRenewalAvailable,
  canGenerateSelfSignedCertificate: hasTrustedTransport(event),
  canStorePrivateKey:
    selfSignedRenewalAvailable &&
    savedCredentialsAvailable() &&
    hasPermission(event.locals.user, 'credentials.manage') &&
    hasTrustedTransport(event),
});

let issuing = false;

async function issueCertificate({ locals, platform, request }: RequestEvent, fields: FormData) {
  const hostnames = fields.get('hostnames');
  const reject = (status: number, message: string) =>
    fail(status, {
      message,
      hostnames: typeof hostnames === 'string' && hostnames.length <= 25_400 ? hostnames : '',
    });
  if (!renewalAvailable) return reject(503, 'Configure Let’s Encrypt on the server first.');
  const parsed = readIssuanceNames(hostnames);
  if (!parsed) {
    return reject(
      400,
      'Enter 1 to 100 DNS hostnames, one per line. Use names without wildcards, URLs, or IP addresses.',
    );
  }
  if (issuing)
    return reject(
      409,
      'A Let’s Encrypt request is already in progress. Wait for it to finish before trying again.',
    );

  const db = getDatabase();
  const { domain, names } = parsed;
  const id = randomUUID();
  issuing = true;
  try {
    const existing = await findIssuedCertificate(db, names, assetViewer(locals.user));
    if (existing) {
      locals.auditTargetId = existing.id;
      redirect(303, resolve('/certificates/[id]', { id: existing.id }));
    }

    platform?.server?.timeout(request, 0);
    const issued = await issueLetsEncryptCertificate(
      db,
      domain,
      names,
      new Date(Date.now() + 60 * 60_000),
    );
    if (!issued.metadata) return reject(502, issued.message);
    const [saved] = await registerCertificate(db, {
      id,
      ...issued.metadata,
      domain,
      autoRenew: true,
      renewalKey: encryptSecret(issued.privateKey, renewalKeyContext(id)),
    });
    if (!saved) return reject(409, 'This certificate is already registered.');
    await addAssetOwner(db, 'certificate', id, locals.user!.id);
  } finally {
    issuing = false;
  }
  locals.auditTargetId = id;
  redirect(303, resolve('/certificates/[id]', { id }));
}

async function createSelfSignedCertificate(event: RequestEvent, fields: FormData) {
  const { locals, setHeaders } = event;
  setHeaders({ 'cache-control': 'no-store' });
  const hostnames = fields.get('hostnames');
  const autoRenew = fields.get('autoRenew') === 'yes';
  const storePrivateKey = fields.get('storePrivateKey') === 'yes';
  const reject = (status: number, message: string) =>
    fail(status, {
      message,
      hostnames: typeof hostnames === 'string' && hostnames.length <= 25_400 ? hostnames : '',
      autoRenew,
      storePrivateKey,
    });
  if (!hasTrustedTransport(event))
    return reject(400, 'Use a trusted HTTPS connection to generate and download private keys.');
  if (
    storePrivateKey &&
    (!savedCredentialsAvailable() || !hasPermission(locals.user, 'credentials.manage'))
  ) {
    return reject(
      403,
      'Vault storage requires Vault configuration and credential-management permission.',
    );
  }
  if ((autoRenew || storePrivateKey) && !selfSignedRenewalAvailable) {
    return reject(
      503,
      'A server secret of at least 32 characters is required to store a private key for renewal.',
    );
  }
  const parsed = readSelfSignedNames(hostnames);
  if (!parsed) {
    return reject(
      400,
      'Enter 1 to 100 DNS hostnames or IP addresses, one per line. Wildcards are allowed for DNS names only.',
    );
  }

  let generated: Awaited<ReturnType<typeof generateSelfSignedCertificate>>;
  try {
    generated = await generateSelfSignedCertificate(parsed.names);
  } catch {
    return reject(500, 'Could not generate the self-signed certificate.');
  }

  const id = randomUUID();
  const [saved] = await registerCertificate(getDatabase(), {
    id,
    ...generated.metadata,
    domain: parsed.domain,
    autoRenew,
    renewalKey:
      autoRenew || storePrivateKey
        ? encryptSecret(generated.privateKey, selfSignedKeyContext(id))
        : null,
  });
  if (!saved) return reject(409, 'This certificate is already registered.');
  await addAssetOwner(getDatabase(), 'certificate', id, locals.user!.id);

  let storeError: string | null = null;
  if (storePrivateKey) {
    try {
      await saveCredential('certificate', id, generated.privateKey);
    } catch {
      storeError = 'Could not save a copy of the private key to Vault.';
    }
  }

  locals.auditTargetId = id;
  return {
    generated: {
      certificateId: id,
      domain: parsed.domain,
      privateKey: generated.privateKey,
      retained: autoRenew || storePrivateKey,
      storeError,
      autoRenew,
    },
  };
}

export const actions: Actions = {
  default: async (event) => {
    const { request, locals, url } = event;
    const fields = await request.formData();
    if (url.searchParams.get('method') === 'letsencrypt') return issueCertificate(event, fields);
    if (url.searchParams.get('method') === 'selfsigned')
      return createSelfSignedCertificate(event, fields);
    const chain = await readCertificateChain(fields);
    if ('message' in chain) return fail(400, { message: chain.message });

    const [saved] = await registerCertificate(getDatabase(), {
      ...chain.metadata,
      domain: chain.domain,
    });
    if (!saved) return fail(409, { message: 'This certificate is already registered.' });
    await addAssetOwner(getDatabase(), 'certificate', saved.id, locals.user!.id);
    locals.auditTargetId = saved.id;
    redirect(303, resolve('/certificates/[id]', { id: saved.id }));
  },
};
