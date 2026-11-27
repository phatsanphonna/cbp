import { error } from '@sveltejs/kit';
import { findRenewalKey, findRenewalSource } from '@cbp/database/renewals';
import { getDatabase } from '#lib/server/database.js';
import { decryptSecret } from '#lib/server/encrypted-secret.js';
import { hasPermission } from '#lib/server/access-control.js';
import { hasTrustedTransport } from '#lib/server/trusted-transport.js';
import { readSavedCredential, savedCredentialsAvailable } from '#lib/server/deployment-secrets.js';
import { readDeploymentKey } from '#lib/server/deployment-key.js';
import { renewalKeyContext } from '#lib/server/lets-encrypt.js';
import { selfSignedIssuer, selfSignedKeyContext } from '#lib/server/self-signed-certificate.js';
import type { RequestHandler } from './$types';

const certificateId = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

async function matchingPrivateKey(privateKey: string, fullchain: string) {
  const fields = new FormData();
  fields.set('privateKeyPem', privateKey);
  const result = await readDeploymentKey(fields, fullchain);
  return 'pem' in result ? result.pem : null;
}

export const GET: RequestHandler = async (event) => {
  if (!hasPermission(event.locals.user, 'credentials.manage') || !hasTrustedTransport(event)) {
    error(403, 'Credential management permission over a trusted connection is required.');
  }
  if (!certificateId.test(event.params.id)) error(404, 'Certificate not found');

  const database = getDatabase();
  const certificate = await findRenewalSource(database, event.params.id);
  if (!certificate) error(404, 'Certificate not found');
  if (!certificate.fullchain) error(404, 'The certificate has no fullchain.');
  const fullchain = certificate.fullchain;

  const encryptedKey = await findRenewalKey(database, certificate.id, fullchain);
  const context =
    certificate.issuer === selfSignedIssuer
      ? selfSignedKeyContext(certificate.id)
      : certificate.issuer.includes("Let's Encrypt")
        ? renewalKeyContext(certificate.id)
        : null;
  const privateKey = encryptedKey && context ? decryptSecret(encryptedKey, context) : null;
  let matchingKey = privateKey ? await matchingPrivateKey(privateKey, fullchain) : null;

  if (!matchingKey && savedCredentialsAvailable()) {
    try {
      const savedKey = await readSavedCredential('certificate', certificate.id);
      matchingKey = await matchingPrivateKey(savedKey, fullchain);
    } catch (cause) {
      if ((cause as { response?: { statusCode?: number } }).response?.statusCode !== 404)
        error(503, 'Could not retrieve the saved private key.');
    }
  }
  if (!matchingKey) error(404, 'No retained private key matches this certificate.');

  const filename = `${certificate.domain.replace(/^\*\./, 'wildcard.')}.key.pem`;
  const encodedFilename = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16)}`,
  );
  return new Response(matchingKey, {
    headers: {
      'content-type': 'application/x-pem-file',
      'content-disposition': `attachment; filename="certificate.key.pem"; filename*=UTF-8''${encodedFilename}`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};
