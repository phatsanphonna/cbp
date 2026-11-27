import { finishDeployment } from '@cbp/database/deployment-jobs';
import { controllerPost, digest, validAgentToken, validHostId } from '../request.js';

const messages = {
  configuration:
    'The agent rejected the target. Check its allowed services, local endpoint overrides, and file permissions.',
  certificate:
    'The agent could not validate the certificate and key. Check the hostname, validity, complete chain, and trusted CA.',
  install: 'The agent could not install the certificate and key.',
  reload: 'Service validation or reload failed. The agent restored the previous files.',
  verify:
    'The endpoint did not serve the expected trusted certificate chain. The agent restored the previous files.',
  rollback: 'Deployment failed and rollback was incomplete. Check the service on the host.',
} as const;

export const POST = controllerPost(async (db, { hostId, token, jobId, outcome, diagnostic }) => {
  if (
    !validHostId(hostId) ||
    !validAgentToken(token) ||
    !validHostId(jobId) ||
    typeof outcome !== 'string'
  )
    return 400;
  if (outcome !== 'ok' && !Object.hasOwn(messages, outcome)) return 400;
  let detail: string | null =
    outcome === 'ok' ? null : messages[outcome as keyof typeof messages];
  if (
    (outcome === 'certificate' || outcome === 'verify') &&
    typeof diagnostic === 'string' &&
    diagnostic.trim() &&
    Buffer.byteLength(diagnostic) <= 512 &&
    !/\p{Cc}/u.test(diagnostic)
  ) {
    detail = diagnostic;
  }
  const result = await finishDeployment(db, hostId, digest(token).toString('hex'), jobId, detail);
  return result === 'denied' ? 403 : result === 'missing' ? 404 : 204;
});
