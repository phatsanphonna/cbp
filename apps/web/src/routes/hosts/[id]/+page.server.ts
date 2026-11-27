import { createHash, randomBytes } from 'node:crypto';
import {
  CBP_AGENT_CA_DOWNLOAD_FILE,
  CBP_AGENT_CA_FILE,
  CBP_AGENT_CONTROLLER_ADDRESS,
} from '$app/env/private';
import { resolve } from '$app/paths';
import { error, fail, redirect } from '@sveltejs/kit';
import { hostAgentEnrollment, inviteHostAgent, revokeHostAgent } from '@cbp/database/host-agents';
import {
  findHost,
  findHostAddress,
  listCertificateOptions,
  removeHost,
  saveHostPing,
  saveHostReport,
} from '@cbp/database/inventory';
import {
  agentCaPaths,
  linuxAgentEnrollmentCommand,
  normalizeAgentControllerAddress,
} from '#lib/server/agent-enrollment-command.js';
import { loadAgentDeployments } from '#lib/server/agent-deployment.js';
import { getDatabase } from '#lib/server/database.js';
import { dateFormatter } from '#lib/server/date-formatter.js';
import { listAnsibleProfiles, readAnsibleProfile } from '#lib/server/ansible-credentials.js';
import {
  deleteSavedCredential,
  readHostCredentialBinding,
  saveCredential,
  savedCredentialsAvailable,
} from '#lib/server/deployment-secrets.js';
import { hostIpAddress } from '#lib/server/host-address.js';
import { parseHostReport } from '#lib/server/host-report.js';
import {
  linkDeploymentAction,
  removeDeploymentAction,
  updateDeploymentEndpointAction,
} from '#lib/server/deployment-actions.js';
import { pingHost, pingLabels } from '#lib/server/ping-host.js';
import { hasTrustedTransport } from '#lib/server/trusted-transport.js';
import { assetViewer, hasPermission } from '#lib/server/access-control.js';
import { setOwnersAction } from '#lib/server/asset-owner-action.js';
import { canAccessAsset, listAssetOwners, listOwnerOptions } from '@cbp/database/asset-owners';
import { displayCertificateDomain } from '../../certificates/display-domain.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { params, cookies, depends } = event;
  depends('cbp:agent-deployments', 'cbp:host-ping');
  const database = getDatabase();
  const viewer = assetViewer(event.locals.user);
  const host = await findHost(database, params.id, viewer);
  if (!host) error(404, 'Host not found');

  const format = dateFormatter(cookies.get('cbp-time-zone'));
  const timestamp = (date: Date | null) =>
    date ? { iso: date.toISOString(), label: format.format(date) } : null;
  const canManageCredentials = hasPermission(event.locals.user, 'credentials.manage');
  const canManageAgents = hasPermission(event.locals.user, 'agents.manage');
  const canManageDeployments = hasPermission(event.locals.user, 'deployments.manage');
  const canManageCertificates = hasPermission(event.locals.user, 'certificates.manage');
  const canManageHosts = hasPermission(event.locals.user, 'hosts.manage');
  const [enrollment, agentDeployments, owners, ownerOptions] = await Promise.all([
    hostAgentEnrollment(database, host.id),
    loadAgentDeployments(
      host.deployments.map(({ id }) => id),
      event,
    ),
    listAssetOwners(database, 'host', host.id),
    canManageHosts ? listOwnerOptions(database) : null,
  ]);
  let credentials: {
    available: boolean;
    profiles: { id: string; name: string }[];
    bound: string | null;
    error: boolean;
  } = { available: false, profiles: [], bound: null, error: false };
  if (canManageCredentials && savedCredentialsAvailable() && hasTrustedTransport(event)) {
    try {
      const [profiles, bound] = await Promise.all([
        listAnsibleProfiles(viewer),
        readHostCredentialBinding(host.id),
      ]);
      credentials = { available: true, profiles, bound, error: false };
    } catch {
      credentials.error = true;
    }
  }
  return {
    owners,
    ownerOptions,
    agentDeployments,
    credentials,
    canManageHosts,
    canManageCredentials,
    canManageDeployments,
    canManageCertificates,
    enrollment: {
      canDownloadAgent: Boolean(canManageAgents && hasTrustedTransport(event)),
      canManageAgents,
      configured: Boolean(normalizeAgentControllerAddress(CBP_AGENT_CONTROLLER_ADDRESS)),
      caDownloadSource:
        canManageAgents && CBP_AGENT_CA_FILE && CBP_AGENT_CA_DOWNLOAD_FILE
          ? agentCaPaths(CBP_AGENT_CA_FILE).source
          : null,
      status: enrollment.status,
      expiresAt: timestamp(enrollment.expiresAt),
    },
    certificateOptions: (await listCertificateOptions(database, undefined, viewer)).map(
      ({ id, domain, sans, serial }) => ({
        id,
        label: `${displayCertificateDomain(domain, sans)} (serial ${serial})`,
      }),
    ),
    host: {
      ...host,
      ipAddress: hostIpAddress(host),
      deployments: host.deployments.map((deployment) => ({
        ...deployment,
        listenerCheckedAt: timestamp(deployment.listenerCheckedAt),
        servedCertificateExpiresAt: timestamp(deployment.servedCertificateExpiresAt),
        servedCertificateObservedAt: timestamp(deployment.servedCertificateObservedAt),
      })),
      lastPingAt: timestamp(host.lastPingAt),
      lastPingLabel: host.lastPingStatus ? pingLabels[host.lastPingStatus] : 'Not checked',
      agentSeenAt: timestamp(host.agentSeenAt),
      ansibleRunAt: timestamp(host.ansibleRunAt),
    },
  };
};

export const actions: Actions = {
  bindCredential: async (event) => {
    if (!hasPermission(event.locals.user, 'credentials.manage') || !hasTrustedTransport(event))
      error(403, 'Credential management permission and a trusted connection are required.');
    const host = await findHost(getDatabase(), event.params.id);
    if (!host) error(404, 'Host not found');
    const id = (await event.request.formData()).get('credentialId');
    if (
      typeof id !== 'string' ||
      (id !== 'none' && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
    )
      return fail(400, { credentialError: 'Choose a valid credential.' });
    if (id !== 'none' && !host.ansibleManaged)
      return fail(400, { credentialError: 'This host is not managed by Ansible.' });
    try {
      if (id === 'none') {
        if (await readHostCredentialBinding(host.id))
          await deleteSavedCredential('host-binding', host.id);
      } else {
        if (
          !(await canAccessAsset(getDatabase(), 'credential', id, assetViewer(event.locals.user)))
        )
          return fail(404, { credentialError: 'That credential no longer exists.' });
        await readAnsibleProfile(id);
        await saveCredential('host-binding', host.id, id);
      }
    } catch {
      return fail(503, { credentialError: 'Could not update the host credential in Vault.' });
    }
    return { credentialMessage: id === 'none' ? 'Credential unbound.' : 'Credential bound.' };
  },
  inviteAgent: async ({ params, setHeaders }) => {
    setHeaders({ 'cache-control': 'no-store' });
    const address = normalizeAgentControllerAddress(CBP_AGENT_CONTROLLER_ADDRESS);
    if (!address)
      return fail(503, {
        enrollmentError: 'Set CBP_AGENT_CONTROLLER_ADDRESS to the controller host and port.',
      });
    const code = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(code).digest('hex');
    const result = await inviteHostAgent(getDatabase(), params.id, hash, {
      enableAgent: true,
    });
    if (result === 'missing') error(404, 'Host not found');
    if (result === 'unsupported')
      return fail(400, {
        enrollmentError: 'Agent enrollment is available for Linux hosts only.',
      });
    if (result === 'conflict')
      return fail(409, {
        enrollmentError: 'This host already has an agent or an active enrollment code.',
      });
    return {
      enrollmentCode: code,
      enrollmentCommand: linuxAgentEnrollmentCommand(
        params.id.toLowerCase(),
        code,
        address,
        CBP_AGENT_CA_FILE,
      ),
    };
  },
  resetAgent: async ({ params }) => {
    if ((await revokeHostAgent(getDatabase(), params.id)) === 'missing')
      error(404, 'Host not found');
    return { enrollmentMessage: 'Agent enrollment reset.' };
  },
  linkDeployment: ({ locals, params, request }) =>
    linkDeploymentAction(request, { hostId: params.id }, assetViewer(locals.user)),
  setOwners: async ({ locals, params, request }) => {
    if (!(await findHostAddress(getDatabase(), params.id))) error(404, 'Host not found');
    return setOwnersAction(locals, 'host', params.id, await request.formData());
  },
  updateEndpoint: ({ locals, params, request }) =>
    updateDeploymentEndpointAction(request, { hostId: params.id }, assetViewer(locals.user)),
  removeDeployment: ({ locals, params, request }) =>
    removeDeploymentAction(request, { hostId: params.id }, assetViewer(locals.user)),
  importReport: async ({ params, request }) => {
    const report = parseHostReport((await request.formData()).get('report'));
    if (!report)
      return fail(400, {
        importError:
          'Paste a valid JSON report from the collector. Check that the host clock is correct.',
      });

    const database = getDatabase();
    if (!(await saveHostReport(database, params.id, report))) {
      if (!(await findHostAddress(database, params.id))) error(404, 'Host not found');
      return fail(409, {
        importError: 'This host already has a newer report.',
      });
    }
    return { importMessage: 'Host information updated.' };
  },
  ping: async ({ params }) => {
    const database = getDatabase();
    const target = await findHostAddress(database, params.id);
    if (!target) error(404, 'Host not found');
    const ping = await pingHost(target);
    await saveHostPing(database, params.id, {
      lastPingAddress: ping.address,
      lastPingAt: new Date(),
      lastPingStatus: ping.status,
    });
    return { ping };
  },
  remove: async ({ params }) => {
    if (savedCredentialsAvailable()) {
      try {
        if (await readHostCredentialBinding(params.id))
          return fail(409, {
            credentialError: 'Unbind the Ansible credential before removing this host.',
          });
      } catch {
        return fail(503, {
          credentialError: 'Vault must be available to check this host’s credential.',
        });
      }
    }
    const result = await removeHost(getDatabase(), params.id);
    if (result === 'missing') error(404, 'Host not found');
    if (result === 'busy')
      return fail(409, {
        credentialError: 'Wait for the current deployment to finish before removing this host.',
      });
    redirect(303, resolve('/hosts'));
  },
};
