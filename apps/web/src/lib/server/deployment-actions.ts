import { findHostAddress, linkDeployment, removeDeployment, updateDeploymentEndpoint } from '@cbp/database/inventory';
import { fail } from '@sveltejs/kit';
import { deploymentMethods, deploymentServices } from '#lib/deployment-services.js';
import { getDatabase } from './database.js';
import { normalizeHostAddress } from './host-address.js';

type DeploymentOwner = { hostId: string } | { certificateId: string };

export async function linkDeploymentAction(request: Request, current: DeploymentOwner) {
  const fields = await request.formData();
  const hostId = 'hostId' in current ? current.hostId : fields.get('hostId');
  const certificateId = 'certificateId' in current ? current.certificateId : fields.get('certificateId');
  const method = deploymentMethods.find((value) => value === fields.get('method'));
  const selectedService = fields.get('engine');
  const engine = deploymentServices.find((service) => service === selectedService) ?? null;

  if (typeof hostId !== 'string' || !hostId || typeof certificateId !== 'string' || !certificateId) {
    return fail(400, { linkError: 'Choose a host and certificate.' });
  }
  if (!method) {
    return fail(400, { linkError: 'Choose a deployment method.' });
  }
  if (selectedService !== null && selectedService !== '' && !engine) {
    return fail(400, { linkError: 'Choose a web service or leave it unspecified.' });
  }
  const database = getDatabase();
  const hostAddress = await findHostAddress(database, hostId);
  if (!hostAddress) return fail(404, { linkError: 'The selected host no longer exists.' });

  const parsed = parseEndpoint(fields, hostAddress);
  if ('message' in parsed) return fail(400, { linkError: parsed.message });
  const { endpoint } = parsed;
  const result = await linkDeployment(database, { hostId, certificateId, endpoint, method, engine });
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

  const service = fields.get('engine');
  const engine = service === '' ? null : deploymentServices.find((value) => value === service);
  if (service !== null && service !== 'keep' && engine === undefined) {
    return fail(400, { deploymentId, endpointError: 'Choose a supported web service.' });
  }
  const selectedMethod = fields.get('method');
  const method = deploymentMethods.find((value) => value === selectedMethod);
  if (selectedMethod !== null && !method) {
    return fail(400, { deploymentId, endpointError: 'Choose a deployment method.' });
  }
  const result = await updateDeploymentEndpoint(getDatabase(), owner, deploymentId, parsed.endpoint, engine, method);
  if (result === 'missing') return fail(404, { deploymentId, endpointError: 'This deployment could not be found.' });
  if (result === 'duplicate') return fail(409, { deploymentId, endpointError: 'This certificate already has a deployment at that endpoint.' });
  return { endpointMessage: `Deployment saved at ${parsed.endpoint}.` };
}

export async function removeDeploymentAction(request: Request, owner: DeploymentOwner) {
  const deploymentId = (await request.formData()).get('deploymentId');
  if (typeof deploymentId !== 'string' || !deploymentId) {
    return fail(400, { removeDeploymentError: 'Choose an endpoint to delete.' });
  }
  const result = await removeDeployment(getDatabase(), owner, deploymentId);
  if (result === 'missing') return fail(404, { deploymentId, removeDeploymentError: 'This endpoint could not be found.' });
  if (result === 'changed') return fail(409, { deploymentId, removeDeploymentError: 'This endpoint changed. Refresh the page and try again.' });
  if (result === 'busy') return fail(409, { deploymentId, removeDeploymentError: 'Wait for the current deployment to finish before deleting this endpoint.' });
  return { removeDeploymentMessage: 'Endpoint deleted.' };
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
