import { createHash, randomBytes } from 'node:crypto';
import { CBP_AGENT_CA_DOWNLOAD_FILE, CBP_AGENT_CA_FILE, CBP_AGENT_CONTROLLER_ADDRESS } from '$app/env/private';
import { resolve } from '$app/paths';
import { error, fail, redirect } from '@sveltejs/kit';
import { hostAgentEnrollment, inviteHostAgent, revokeHostAgent } from '@cbp/database/host-agents';
import { findHost, findHostAddress, listCertificateOptions, removeHost, saveHostPing, saveHostReport } from '@cbp/database/inventory';
import { agentCaPaths, linuxAgentEnrollmentCommand, normalizeAgentControllerAddress } from '#lib/server/agent-enrollment-command.js';
import { loadAgentDeployments } from '#lib/server/agent-deployment.js';
import { getDatabase } from '#lib/server/database.js';
import { dateFormatter } from '#lib/server/date-formatter.js';
import { hostIpAddress } from '#lib/server/host-address.js';
import { parseHostReport } from '#lib/server/host-report.js';
import { linkDeploymentAction, removeDeploymentAction, updateDeploymentEndpointAction } from '#lib/server/deployment-actions.js';
import { pingHost, pingLabels } from '#lib/server/ping-host.js';
import { displayCertificateDomain } from '../../certificates/display-domain.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { params, cookies, depends } = event;
  depends('cbp:agent-deployments', 'cbp:host-ping');
  const database = getDatabase();
  const host = await findHost(database, params.id);
  if (!host) error(404, 'Host not found');

  const format = dateFormatter(cookies.get('cbp-time-zone'));
  const timestamp = (date: Date | null) => date ? { iso: date.toISOString(), label: format.format(date) } : null;
  const [enrollment, agentDeployments] = await Promise.all([
    hostAgentEnrollment(database, host.id), loadAgentDeployments(host.deployments.map(({ id }) => id), event)
  ]);
  return {
    agentDeployments,
    enrollment: {
      configured: Boolean(normalizeAgentControllerAddress(CBP_AGENT_CONTROLLER_ADDRESS)),
      caDownloadSource: event.locals.user?.isAdmin && CBP_AGENT_CA_FILE && CBP_AGENT_CA_DOWNLOAD_FILE
        ? agentCaPaths(CBP_AGENT_CA_FILE).source : null,
      status: enrollment.status,
      expiresAt: timestamp(enrollment.expiresAt)
    },
    certificateOptions: (await listCertificateOptions(database)).map(({ id, domain, sans, serial }) => ({
      id, label: `${displayCertificateDomain(domain, sans)} (serial ${serial})`
    })),
    host: {
      ...host,
      ipAddress: hostIpAddress(host),
      deployments: host.deployments.map((deployment) => ({
        ...deployment,
        listenerCheckedAt: timestamp(deployment.listenerCheckedAt)
      })),
      lastPingAt: timestamp(host.lastPingAt),
      lastPingLabel: host.lastPingStatus ? pingLabels[host.lastPingStatus] : 'Not checked',
      agentSeenAt: timestamp(host.agentSeenAt),
      ansibleRunAt: timestamp(host.ansibleRunAt)
    }
  };
};

export const actions: Actions = {
  inviteAgent: async ({ params, setHeaders }) => {
    setHeaders({ 'cache-control': 'no-store' });
    const address = normalizeAgentControllerAddress(CBP_AGENT_CONTROLLER_ADDRESS);
    if (!address) return fail(503, { enrollmentError: 'Set CBP_AGENT_CONTROLLER_ADDRESS to the controller host and port.' });
    const code = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(code).digest('hex');
    const result = await inviteHostAgent(getDatabase(), params.id, hash, { enableAgent: true });
    if (result === 'missing') error(404, 'Host not found');
    if (result === 'conflict') return fail(409, { enrollmentError: 'This host already has an agent or an active enrollment code.' });
    return {
      enrollmentCode: code,
      enrollmentCommand: linuxAgentEnrollmentCommand(params.id.toLowerCase(), code, address, CBP_AGENT_CA_FILE)
    };
  },
  resetAgent: async ({ params }) => {
    if (await revokeHostAgent(getDatabase(), params.id) === 'missing') error(404, 'Host not found');
    return { enrollmentMessage: 'Agent enrollment reset.' };
  },
  linkDeployment: ({ params, request }) => linkDeploymentAction(request, { hostId: params.id }),
  updateEndpoint: ({ params, request }) => updateDeploymentEndpointAction(request, { hostId: params.id }),
  removeDeployment: ({ params, request }) => removeDeploymentAction(request, { hostId: params.id }),
  importReport: async ({ params, request }) => {
    const report = parseHostReport((await request.formData()).get('report'));
    if (!report) return fail(400, { importError: 'Paste a valid JSON report from the collector. Check that the host clock is correct.' });

    const database = getDatabase();
    if (!(await saveHostReport(database, params.id, report))) {
      if (!(await findHostAddress(database, params.id))) error(404, 'Host not found');
      return fail(409, { importError: 'This host already has a newer report.' });
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
      lastPingStatus: ping.status
    });
    return { ping };
  },
  remove: async ({ params }) => {
    if (!(await removeHost(getDatabase(), params.id))) error(404, 'Host not found');
    redirect(303, resolve('/hosts'));
  }
};
