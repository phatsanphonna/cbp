import { resolve } from '$app/paths';
import { error, fail, redirect } from '@sveltejs/kit';
import { assignCertificateGroup, findCertificate, findCertificateDomain, listHostOptions, removeCertificate, updateCertificateChain } from '@cbp/database/inventory';
import { groupExists, listGroups } from '@cbp/database/groups';
import { readCertificateChain } from '#lib/server/certificate-chain.js';
import { getDatabase } from '#lib/server/database.js';
import { dateFormatter } from '#lib/server/date-formatter.js';
import { linkDeploymentAction, updateDeploymentEndpointAction } from '#lib/server/deployment-actions.js';
import { parseGroupId } from '#lib/server/group-id.js';
import { displayCertificateDomain } from '../display-domain.js';
import { expiryStatus } from '../expiry.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies }) => {
  const database = getDatabase();
  const certificate = await findCertificate(database, params.id);
  if (!certificate) error(404, 'Certificate not found');
  const format = dateFormatter(cookies.get('cbp-time-zone'));
  const [groups, hosts] = await Promise.all([listGroups(database), listHostOptions(database)]);
  return {
    groups,
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
  linkDeployment: ({ params, request }) => linkDeploymentAction(request, { certificateId: params.id }),
  updateEndpoint: ({ params, request }) => updateDeploymentEndpointAction(request, { certificateId: params.id }),
  assignGroup: async ({ params, request }) => {
    const database = getDatabase();
    const selected = (await request.formData()).get('groupId');
    const groupId = parseGroupId(selected);
    if (selected !== '' && (groupId === null || !(await groupExists(database, groupId)))) {
      return fail(400, { groupMessage: 'Choose an existing group or leave the certificate unassigned.' });
    }
    if (!(await assignCertificateGroup(database, params.id, groupId))) error(404, 'Certificate not found');
    redirect(303, resolve('/certificates/[id]', { id: params.id }));
  },
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
  remove: async ({ params }) => {
    if (!(await removeCertificate(getDatabase(), params.id))) error(404, 'Certificate not found');
    redirect(303, resolve('/certificates'));
  }
};
