import { resolve } from '$app/paths';
import { fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { registerCertificate } from '@cbp/database/inventory';
import { findIssuedCertificate } from '@cbp/database/renewals';
import { getDatabase } from '#lib/server/database.js';
import { readCertificateChain } from '#lib/server/certificate-chain.js';
import { encryptSecret } from '#lib/server/encrypted-secret.js';
import {
  issueLetsEncryptCertificate,
  renewalAvailable,
  renewalKeyContext,
} from '#lib/server/lets-encrypt.js';
import { readIssuanceNames } from '#lib/server/renewal-names.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = ({ url }) => ({
  issue: url.searchParams.get('method') === 'letsencrypt',
  renewalAvailable,
});

let issuing = false;

async function issueCertificate(
  { locals, platform, request }: RequestEvent,
  fields: FormData,
) {
  const hostnames = fields.get('hostnames');
  const reject = (status: number, message: string) =>
    fail(status, {
      message,
      hostnames:
        typeof hostnames === 'string' && hostnames.length <= 25_400
          ? hostnames
          : '',
    });
  if (!renewalAvailable)
    return reject(503, 'Configure Let’s Encrypt on the server first.');
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
    const existing = await findIssuedCertificate(db, names);
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
  } finally {
    issuing = false;
  }
  locals.auditTargetId = id;
  redirect(303, resolve('/certificates/[id]', { id }));
}

export const actions: Actions = {
  default: async (event) => {
    const { request, locals, url } = event;
    const fields = await request.formData();
    if (url.searchParams.get('method') === 'letsencrypt')
      return issueCertificate(event, fields);
    const chain = await readCertificateChain(fields);
    if ('message' in chain) return fail(400, { message: chain.message });

    const [saved] = await registerCertificate(getDatabase(), {
      ...chain.metadata,
      domain: chain.domain,
    });
    if (!saved)
      return fail(409, { message: 'This certificate is already registered.' });
    locals.auditTargetId = saved.id;
    redirect(303, resolve('/certificates/[id]', { id: saved.id }));
  },
};
