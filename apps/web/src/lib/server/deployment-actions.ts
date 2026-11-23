import { findHostAddress, linkDeployment, updateDeploymentEndpoint } from '@cbp/database/inventory';
import { fail } from '@sveltejs/kit';
import { getDatabase } from './database.js';
import { normalizeHostAddress } from './host-address.js';

type DeploymentOwner = { hostId: string } | { certificateId: string };

export async function linkDeploymentAction(request: Request, current: DeploymentOwner) {
  const fields = await request.formData();
  const hostId = 'hostId' in current ? current.hostId : fields.get('hostId');
  const certificateId = 'certificateId' in current ? current.certificateId : fields.get('certificateId');
  const method = fields.get('method');

  if (typeof hostId !== 'string' || !hostId || typeof certificateId !== 'string' || !certificateId) {
    return fail(400, { linkError: 'Choose a host and certificate.' });
  }
  if (method !== 'Manual' && method !== 'Agent' && method !== 'Ansible') {
    return fail(400, { linkError: 'Choose a deployment method.' });
  }
  const database = getDatabase();
  const hostAddress = await findHostAddress(database, hostId);
  if (!hostAddress) return fail(404, { linkError: 'The selected host no longer exists.' });

  const parsed = parseEndpoint(fields, hostAddress);
  if ('message' in parsed) return fail(400, { linkError: parsed.message });
  const { endpoint } = parsed;
  const result = await linkDeployment(database, { hostId, certificateId, endpoint, method });
  if (result === 'missing') return fail(404, { linkError: 'The selected host or certificate no longer exists.' });
  if (result === 'duplicate') return fail(409, { linkError: 'This certificate already has a linked deployment at that endpoint.' });
  return { linkMessage: `Deployment linked at ${endpoint}.` };
}

export async function updateDeploymentEndpointAction(request: Request, owner: DeploymentOwner) {
  const fields = await request.formData();
  const deploymentId = fields.get('deploymentId');
  if (typeof deploymentId !== 'string' || !deploymentId) {
    return fail(400, { endpointError: 'Choose a deployment.' });
  }

  const parsed = parseEndpoint(fields);
  if ('message' in parsed) return fail(400, { deploymentId, endpointError: parsed.message });

  const result = await updateDeploymentEndpoint(getDatabase(), owner, deploymentId, parsed.endpoint);
  if (result === 'missing') return fail(404, { deploymentId, endpointError: 'This deployment could not be found.' });
  if (result === 'duplicate') return fail(409, { deploymentId, endpointError: 'This certificate already has a deployment at that endpoint.' });
  return { endpointMessage: `Endpoint saved as ${parsed.endpoint}.` };
}

function parseEndpoint(fields: FormData, fallback = '') {
  const value = fields.get('endpointHost');
  const port = fields.get('port');
  if (typeof port !== 'string' || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    return { message: 'Enter a port from 1 to 65535.' } as const;
  }

  const host = typeof value === 'string' ? value.trim() : value === null ? '' : null;
  const address = host === null ? null : normalizeHostAddress(host || fallback);
  if (!address) return { message: 'Enter an endpoint hostname or IP address without a port.' } as const;
  return { endpoint: `${address.includes(':') ? `[${address}]` : address}:${Number(port)}` } as const;
}
