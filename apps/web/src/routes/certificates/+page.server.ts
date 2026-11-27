import { listCertificates } from '@cbp/database/inventory';
import { getDatabase } from '#lib/server/database.js';
import { displayCertificateDomain } from './display-domain.js';
import { expiryFilter, expiryStatus } from './expiry.js';
import type { PageServerLoad } from './$types';
import { assetViewer, hasPermission } from '#lib/server/access-control.js';

export const load: PageServerLoad = async ({ url, locals }) => {
  const expiry = expiryFilter(url.searchParams.get('expiry'), new Date());
  const certificates = await listCertificates(
    getDatabase(),
    expiry ?? undefined,
    assetViewer(locals.user),
  );
  return {
    canManageCertificates: hasPermission(locals.user, 'certificates.manage'),
    expiryLabel: expiry?.label ?? null,
    certificates: certificates.map(
      ({ id, domain, sans, issuer, validFrom, validUntil, total, verified }) => ({
        id,
        domain,
        displayDomain: displayCertificateDomain(domain, sans),
        issuer,
        deployments: `${verified} of ${total} verified`,
        status: expiryStatus(validFrom, validUntil),
      }),
    ),
  };
};
