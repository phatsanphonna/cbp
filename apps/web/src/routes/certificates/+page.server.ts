import { listCertificates } from "@cbp/database/inventory";
import { getDatabase } from "#lib/server/database.js";
import { displayCertificateDomain } from "./display-domain.js";
import { expiryFilter, expiryStatus } from "./expiry.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  const expiry = expiryFilter(url.searchParams.get("expiry"), new Date());
  const certificates = await listCertificates(
    getDatabase(),
    expiry ?? undefined,
  );
  return {
    expiryLabel: expiry?.label ?? null,
    certificates: certificates.map(
      ({
        id,
        domain,
        sans,
        issuer,
        validFrom,
        validUntil,
        total,
        verified,
      }) => ({
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
