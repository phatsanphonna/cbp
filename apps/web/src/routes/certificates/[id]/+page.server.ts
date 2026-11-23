import { resolve } from '$app/paths';
import { error, fail, redirect } from '@sveltejs/kit';
import { findCertificate, findCertificateDomain, findPreviousCertificateChain, listHostOptions, removeCertificate, updateCertificateChain } from '@cbp/database/inventory';
import { parseCertificateChain, readCertificateChain } from '#lib/server/certificate-chain.js';
import { deployCertificateAction, loadAgentDeployments } from '#lib/server/agent-deployment.js';
import { getDatabase } from '#lib/server/database.js';
import { dateFormatter } from '#lib/server/date-formatter.js';
import { linkDeploymentAction, removeDeploymentAction, updateDeploymentEndpointAction } from '#lib/server/deployment-actions.js';
import { displayCertificateDomain } from '../display-domain.js';
import { expiryStatus } from '../expiry.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies, depends, url }) => {
  depends('cbp:agent-deployments');
  const database = getDatabase();
  const certificate = await findCertificate(database, params.id);
  if (!certificate) error(404, 'Certificate not found');
  const format = dateFormatter(cookies.get('cbp-time-zone'));
  const [hosts, agentDeployments] = await Promise.all([
    listHostOptions(database), loadAgentDeployments(certificate.deployments.map(({ id }) => id), url)
  ]);
  return {
    agentDeployments,
    hostOptions: hosts.map(({ id, name, hostname }) => ({
      id, label: hostname && hostname !== name ? `${hostname} (${name})` : name
    })),
    certificate: {
      ...certificate,
      displayDomain: displayCertificateDomain(certificate.domain, certificate.sans),
      status: expiryStatus(certificate.validFrom, certificate.validUntil),
      validFrom: certificate.validFrom.toISOString(),
      validFromLabel: format.format(certificate.validFrom),
      validUntil: certificate.validUntil.toISOString(),
      validUntilLabel: format.format(certificate.validUntil)
    }
  };
};

export const actions: Actions = {
  deploy: (event) => deployCertificateAction(event, event.params.id),
  linkDeployment: ({ params, request }) => linkDeploymentAction(request, { certificateId: params.id }),
  updateEndpoint: ({ params, request }) => updateDeploymentEndpointAction(request, { certificateId: params.id }),
  removeDeployment: ({ params, request }) => removeDeploymentAction(request, { certificateId: params.id }),
  updateChain: async ({ params, request }) => {
    const database = getDatabase();
    const domain = await findCertificateDomain(database, params.id);
    if (!domain) error(404, 'Certificate not found');

    const chain = await readCertificateChain(await request.formData());
    if ('message' in chain) return fail(400, { message: chain.message });
    if (!chain.covers(domain)) {
      return fail(400, { message: 'The replacement certificate does not cover this hostname.' });
    }

    const updated = await updateCertificateChain(database, params.id, chain.metadata);
    if (updated === 'duplicate') return fail(409, { message: 'The replacement is already registered on another record.' });
    if (!updated) error(404, 'Certificate not found');
    redirect(303, resolve('/certificates/[id]', { id: params.id }));
  },
  restoreChain: async ({ params, request }) => {
    const revision = (await request.formData()).get('previousChainRevision');
    const database = getDatabase();
    const previous = await findPreviousCertificateChain(database, params.id);
    if (!previous) error(404, 'Certificate not found');
    if (!previous.fullchain) return fail(409, { restoreError: 'There is no previous fullchain to restore.' });
    if (revision !== previous.revision) return fail(409, { restoreError: 'The previous fullchain changed. Refresh the page and try again.' });
    const chain = parseCertificateChain(previous.fullchain);
    if ('message' in chain || !chain.covers(previous.domain)) {
      return fail(400, { restoreError: 'The saved fullchain is invalid for this hostname.' });
    }
    const restored = await updateCertificateChain(database, params.id, chain.metadata, previous.fullchain);
    if (restored === 'duplicate') return fail(409, { restoreError: 'The saved certificate is already registered on another record.' });
    if (restored === 'changed') return fail(409, { restoreError: 'The previous fullchain changed. Refresh the page and try again.' });
    if (!restored) error(404, 'Certificate not found');
    return { restoreMessage: 'Previous fullchain restored. Deploy it with its matching private key to update your hosts.' };
  },
  remove: async ({ params }) => {
    if (!(await removeCertificate(getDatabase(), params.id))) error(404, 'Certificate not found');
    redirect(303, resolve('/certificates'));
  }
};
