import { resolve } from "$app/paths";
import { error, fail, redirect } from "@sveltejs/kit";
import {
  findCertificate,
  findCertificateDomain,
  findPreviousCertificateChain,
  listHostOptions,
  removeCertificate,
  updateCertificateChain,
} from "@cbp/database/inventory";
import {
  parseCertificateChain,
  readCertificateChain,
} from "#lib/server/certificate-chain.js";
import {
  deployCertificateAction,
  loadAgentDeployments,
} from "#lib/server/agent-deployment.js";
import { getDatabase } from "#lib/server/database.js";
import { dateFormatter } from "#lib/server/date-formatter.js";
import { readDeploymentKey } from '#lib/server/deployment-key.js';
import { boundAnsibleCredential } from '#lib/server/ansible-credentials.js';
import { deleteSavedCredential, hasSavedCredential, savedCredentialsAvailable } from '#lib/server/deployment-secrets.js';
import { hasTrustedTransport } from '#lib/server/trusted-transport.js';
import {
  linkDeploymentAction,
  removeDeploymentAction,
  updateDeploymentEndpointAction,
} from "#lib/server/deployment-actions.js";
import { displayCertificateDomain } from "../display-domain.js";
import { expiryStatus } from "../expiry.js";
import { hasPermission } from "#lib/server/access-control.js";
import {
  renewalAvailable,
  renewCertificateNow,
  selfSignedRenewalAvailable,
} from '#lib/server/lets-encrypt.js';
import { letsEncryptNames } from '#lib/server/renewal-names.js';
import {
  selfSignedCertificateNames,
  selfSignedIssuer,
} from '#lib/server/self-signed-certificate.js';
import {
  findRenewalSource,
  setAutoRenew,
} from '@cbp/database/renewals';
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

export const load: PageServerLoad = async (event) => {
  const { params, cookies, depends } = event;
  depends("cbp:agent-deployments");
  const database = getDatabase();
  const certificate = await findCertificate(database, params.id);
  if (!certificate) error(404, "Certificate not found");
  const selfSigned = certificate.issuer === selfSignedIssuer;
  const letsEncrypt = certificate.issuer.includes("Let's Encrypt");
  const renewalNames = selfSigned
    ? selfSignedCertificateNames(certificate.domain, certificate.fullchain)
    : letsEncrypt
      ? letsEncryptNames(certificate.domain, certificate.fullchain)
      : null;
  const renewalAvailableForCertificate = selfSigned
    ? selfSignedRenewalAvailable
    : renewalAvailable;
  const nextRenewal = certificate.autoRenew
    ? new Date(
        Math.max(
          certificate.validFrom.getTime() +
            (certificate.validUntil.getTime() -
              certificate.validFrom.getTime()) *
              (2 / 3),
          certificate.renewalRetryAt?.getTime() ?? 0,
        ),
      )
    : null;
  const canManageRenewals = hasPermission(
    event.locals.user,
    'renewals.manage',
  );
  const format = dateFormatter(cookies.get("cbp-time-zone"));
  const timestamp = (date: Date | null) =>
    date ? { iso: date.toISOString(), label: format.format(date) } : null;
  const [hosts, agentDeployments] = await Promise.all([
    listHostOptions(database),
    loadAgentDeployments(
      certificate.deployments.map(({ id }) => id),
      event,
    ),
  ]);
  let savedCredentials = { available: false, key: false, ansible: false, error: false };
  let boundCredentials: Record<string, string> = {};
  const canManageCredentials = hasPermission(event.locals.user, "credentials.manage");
  const canManageDeployments = hasPermission(event.locals.user, "deployments.manage");
  const canManageHosts = hasPermission(event.locals.user, "hosts.manage");
  const canManageCertificates = hasPermission(event.locals.user, "certificates.manage");
  if (canManageCredentials && savedCredentialsAvailable() && hasTrustedTransport(event)) {
    try {
      const [key, ansible] = await Promise.all([
        hasSavedCredential('certificate', params.id),
        hasSavedCredential('ansible', params.id),
      ]);
      savedCredentials = { available: true, key, ansible, error: false };
      const hostIds = [...new Set(certificate.deployments.filter((deployment) => deployment.method === 'Ansible' && deployment.hostId).map((deployment) => deployment.hostId!))];
      const bound = await Promise.all(hostIds.map(async (hostId) => ({ hostId, credential: await boundAnsibleCredential(hostId) })));
      boundCredentials = Object.fromEntries(bound.filter(({ credential }) => credential).map(({ hostId, credential }) => [hostId, credential!.name]));
    } catch {
      savedCredentials.error = true;
    }
  }
  const {
    fullchain: _fullchain,
    renewalRetryAt: _renewalRetryAt,
    renewalError: _renewalError,
    ...certificateDetails
  } = certificate;
  return {
    agentDeployments,
    savedCredentials,
    canManageCredentials,
    canManageDeployments,
    canManageHosts,
    canManageCertificates,
    canManageRenewals,
    boundCredentials,
    hostOptions: hosts.map(({ id, name, hostname }) => ({
      id,
      label: hostname && hostname !== name ? `${hostname} (${name})` : name,
    })),
    certificate: {
      ...certificateDetails,
      renewal: {
        provider: selfSigned
          ? 'Self-signed'
          : letsEncrypt
            ? 'Let’s Encrypt'
            : null,
        eligible:
          Boolean(renewalNames && certificate.fingerprint),
        canAutoRenew:
          Boolean(renewalNames && certificate.fingerprint) &&
          (!selfSigned || certificate.hasRenewalKey),
        available: renewalAvailableForCertificate,
        error: certificate.renewalError,
        nextAttempt: nextRenewal?.toISOString() ?? null,
        nextAttemptLabel: nextRenewal ? format.format(nextRenewal) : null,
      },
      displayDomain: displayCertificateDomain(
        certificate.domain,
        certificate.sans,
      ),
      status: expiryStatus(certificate.validFrom, certificate.validUntil),
      validFrom: certificate.validFrom.toISOString(),
      validFromLabel: format.format(certificate.validFrom),
      validUntil: certificate.validUntil.toISOString(),
      validUntilLabel: format.format(certificate.validUntil),
      deployments: certificate.deployments.map((deployment) => ({
        ...deployment,
        servedCertificateExpiresAt: timestamp(
          deployment.hostId ? deployment.servedCertificateExpiresAt : null,
        ),
        servedCertificateObservedAt: timestamp(
          deployment.hostId ? deployment.servedCertificateObservedAt : null,
        ),
      })),
    },
  };
};

async function changeRenewal(event: RequestEvent, enabled: boolean) {
  const { locals, params } = event;
  if (!hasPermission(locals.user, 'renewals.manage'))
    return fail(403, {
      renewalError: 'Renewal management permission is required.',
    });

  const database = getDatabase();
  let fingerprint: string | undefined;
  if (enabled) {
    const source = await findRenewalSource(database, params.id);
    if (!source) error(404, 'Certificate not found');
    const selfSigned = source.issuer === selfSignedIssuer;
    const available = selfSigned
      ? selfSignedRenewalAvailable
      : renewalAvailable;
    if (!available)
      return fail(503, {
        renewalError: selfSigned
          ? 'A 32-character server secret is required for renewal.'
          : 'Configure Let’s Encrypt on the server first.',
      });
    const eligible = selfSigned
      ? source.hasRenewalKey &&
        Boolean(selfSignedCertificateNames(source.domain, source.fullchain))
      : source.issuer.includes("Let's Encrypt") &&
        Boolean(letsEncryptNames(source.domain, source.fullchain));
    if (!eligible || !source.fingerprint)
      return fail(400, {
        renewalError: selfSigned
          ? 'This self-signed certificate needs a valid fullchain and stored private key for automatic renewal.'
          : 'This certificate needs an eligible Let’s Encrypt fullchain.',
      });
    fingerprint = source.fingerprint;
  }

  const [updated] = await setAutoRenew(
    database,
    params.id,
    enabled,
    fingerprint,
  );
  if (!updated)
    return fail(409, {
      renewalError:
        'The certificate or its renewal setting changed. Refresh and try again.',
    });
  locals.auditTargetId = params.id;
  redirect(303, resolve('/certificates/[id]', { id: params.id }));
}

async function renewNow(event: RequestEvent) {
  const { locals, params, platform, request, setHeaders } = event;
  if (!hasPermission(locals.user, 'renewals.manage'))
    return fail(403, {
      renewalError: 'Renewal management permission is required.',
    });
  setHeaders({ 'cache-control': 'no-store' });
  platform?.server?.timeout(request, 0);
  const source = await findRenewalSource(getDatabase(), params.id);
  if (!source) error(404, 'Certificate not found');
  let privateKey: string | undefined;
  if (source.issuer === selfSignedIssuer) {
    if (!hasTrustedTransport(event))
      return fail(400, {
        renewalError:
          'Use a trusted HTTPS connection to renew and receive the rotated private key.',
      });
    const fields = await request.formData().catch(() => null);
    const upload = fields?.get('privateKey');
    const hasUpload = upload instanceof File && upload.size > 0;
    if (!source.hasRenewalKey || hasUpload) {
      if (!source.fullchain)
        return fail(409, { renewalError: 'This certificate has no fullchain.' });
      if (!fields)
        return fail(400, { renewalError: 'Upload the matching private key.' });
      const key = await readDeploymentKey(fields, source.fullchain);
      if ('message' in key)
        return fail(400, { renewalError: key.message });
      privateKey = key.pem;
    }
  }
  const result = await renewCertificateNow(params.id, privateKey);
  if ('status' in result)
    return fail(result.status, { renewalError: result.message });
  locals.auditTargetId = params.id;
  return {
    renewalResult: {
      ...('privateKey' in result ? { privateKey: result.privateKey } : {}),
      ...('warning' in result && result.warning
        ? { warning: result.warning }
        : {}),
    },
  };
}

export const actions: Actions = {
  enableRenewal: (event) => changeRenewal(event, true),
  disableRenewal: (event) => changeRenewal(event, false),
  renewNow,
  deleteCredential: async (event) => {
    if (!hasPermission(event.locals.user, "credentials.manage")) return fail(403, { credentialError: 'Credential management permission is required.' });
    if (!hasTrustedTransport(event)) return fail(403, { credentialError: 'A trusted connection is required.' });
    const kind = (await event.request.formData()).get('kind');
    if (kind !== 'certificate' && kind !== 'ansible') return fail(400, { credentialError: 'Invalid credential type.' });
    if (!(await findCertificateDomain(getDatabase(), event.params.id))) error(404, 'Certificate not found');
    try {
      await deleteSavedCredential(kind, event.params.id);
    } catch {
      return fail(503, { credentialError: 'Could not delete the credential from Vault.' });
    }
    return { credentialMessage: 'Saved credential deleted.' };
  },
  deploy: (event) => deployCertificateAction(event, event.params.id),
  deployAnsible: (event) =>
    deployCertificateAction(event, event.params.id, "Ansible"),
  deployMixed: (event) => deployCertificateAction(event, event.params.id, null),
  linkDeployment: ({ params, request }) =>
    linkDeploymentAction(request, { certificateId: params.id }),
  updateEndpoint: ({ params, request }) =>
    updateDeploymentEndpointAction(request, { certificateId: params.id }),
  removeDeployment: ({ params, request }) =>
    removeDeploymentAction(request, { certificateId: params.id }),
  updateChain: async ({ params, request }) => {
    const database = getDatabase();
    const domain = await findCertificateDomain(database, params.id);
    if (!domain) error(404, "Certificate not found");

    const chain = await readCertificateChain(await request.formData());
    if ("message" in chain) return fail(400, { message: chain.message });
    if (!chain.covers(domain)) {
      return fail(400, {
        message: "The replacement certificate does not cover this hostname.",
      });
    }

    const updated = await updateCertificateChain(
      database,
      params.id,
      chain.metadata,
    );
    if (updated === "duplicate")
      return fail(409, {
        message: "The replacement is already registered on another record.",
      });
    if (!updated) error(404, "Certificate not found");
    redirect(303, resolve("/certificates/[id]", { id: params.id }));
  },
  restoreChain: async ({ params, request }) => {
    const revision = (await request.formData()).get("previousChainRevision");
    const database = getDatabase();
    const previous = await findPreviousCertificateChain(database, params.id);
    if (!previous) error(404, "Certificate not found");
    if (!previous.fullchain)
      return fail(409, {
        restoreError: "There is no previous fullchain to restore.",
      });
    if (revision !== previous.revision)
      return fail(409, {
        restoreError:
          "The previous fullchain changed. Refresh the page and try again.",
      });
    const chain = parseCertificateChain(previous.fullchain);
    if ("message" in chain || !chain.covers(previous.domain)) {
      return fail(400, {
        restoreError: "The saved fullchain is invalid for this hostname.",
      });
    }
    const restored = await updateCertificateChain(
      database,
      params.id,
      chain.metadata,
      previous.fullchain,
    );
    if (restored === "duplicate")
      return fail(409, {
        restoreError:
          "The saved certificate is already registered on another record.",
      });
    if (restored === "changed")
      return fail(409, {
        restoreError:
          "The previous fullchain changed. Refresh the page and try again.",
      });
    if (!restored) error(404, "Certificate not found");
    return {
      restoreMessage:
        "Previous fullchain restored. Deploy it with its matching private key to update your hosts.",
    };
  },
  remove: async ({ params }) => {
    if (savedCredentialsAvailable()) {
      try {
        if ((await hasSavedCredential('certificate', params.id)) || (await hasSavedCredential('ansible', params.id)))
          return fail(409, { message: 'Delete the saved Vault credentials before removing this certificate.' });
      } catch {
        return fail(503, { message: 'Vault must be available to check saved credentials before removing this certificate.' });
      }
    }
    if (!(await removeCertificate(getDatabase(), params.id)))
      error(404, "Certificate not found");
    redirect(303, resolve("/certificates"));
  },
};
