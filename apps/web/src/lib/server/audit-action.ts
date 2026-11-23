import { recordAuditEvent } from '@cbp/database/audit';
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { getDatabase } from './database.js';

const deploymentActions = {
  linkDeployment: 'Link deployment',
  updateEndpoint: 'Edit deployment',
  removeDeployment: 'Delete endpoint'
};
const actionLabels: Record<string, Record<string, string>> = {
  '/signin': { default: 'Sign in' },
  '/signout': { default: 'Sign out' },
  '/hosts/new': { default: 'Add host' },
  '/hosts/[id]': {
    ...deploymentActions, inviteAgent: 'Generate enrollment code', resetAgent: 'Reset enrollment',
    importReport: 'Import host report', ping: 'Ping host', remove: 'Remove host'
  },
  '/certificates/new': { default: 'Register certificate' },
  '/certificates/[id]': {
    ...deploymentActions, deploy: 'Deploy certificate', updateChain: 'Update fullchain',
    restoreChain: 'Restore fullchain', remove: 'Remove certificate'
  },
  '/alerts/channels': { add: 'Add notification channel', setEnabled: 'Change notification channel status' }
};

export async function auditUserAction(event: RequestEvent, resolve: () => Response | Promise<Response>) {
  const route = event.route.id;
  if (!route || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.request.method)) return resolve();

  const key = [...event.url.searchParams.keys()].find((key) => key.startsWith('/'))?.slice(1) ?? 'default';
  const labels = actionLabels[route];
  const action = labels && Object.hasOwn(labels, key) ? labels[key] : 'Submit form';
  const record = async (status: number) => {
    const actor = event.locals.auditActor;
    const id = event.locals.auditTargetId ?? event.params.id;
    const targetId = id && /^(?:[0-9]+|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i.test(id) ? id : null;
    try {
      await recordAuditEvent(getDatabase(), { actorId: actor?.id, actorName: actor?.name, action, route, targetId, status });
    } catch {
      console.error('Could not store web audit event', { action, route });
    }
  };

  try {
    const response = await resolve();
    await record(response.status);
    return response;
  } catch (error) {
    await record(isHttpError(error) || isRedirect(error) ? error.status : 500);
    throw error;
  }
}
