import { randomUUID } from 'node:crypto';
import { queueDeployments } from '@cbp/database/deployment-jobs';
import { findCertificate } from '@cbp/database/inventory';
import { pickAutoDeployTargets } from './auto-deploy-targets.js';
import { getControllerToken } from './controller-config.js';
import type { getDatabase } from './database.js';
import { discardDeploymentSecret, keepDeploymentSecret } from './deployment-secrets.js';

// Returns a warning listing endpoints that were not queued, or undefined.
export async function autoDeployRenewal(
  db: ReturnType<typeof getDatabase>,
  certificateId: string,
  privateKey: string,
) {
  const certificate = await findCertificate(db, certificateId);
  if (!certificate?.autoDeploy || !certificate.fullchain) return undefined;
  const { targets, skipped } = pickAutoDeployTargets(certificate.deployments);
  if (targets.length && !getControllerToken())
    skipped.push(...targets.splice(0).map(({ endpoint }) => endpoint));
  // One host per call so a busy or unenrolled host does not block the others.
  for (const target of targets) {
    const id = randomUUID();
    try {
      await keepDeploymentSecret(id, privateKey);
      const result = await queueDeployments(db, { certificateId }, [
        {
          id,
          deploymentId: target.id,
          hostId: target.hostId,
          endpoint: target.endpoint,
          engine: target.engine,
          fullchain: certificate.fullchain,
          method: 'Agent',
        },
      ]);
      if (result.status === 'queued') continue;
    } catch {
      console.error('Could not queue automatic deployment', {
        certificateId,
        endpoint: target.endpoint,
      });
    }
    await Promise.allSettled([discardDeploymentSecret(id)]);
    skipped.push(target.endpoint);
  }
  return skipped.length ? `Automatic deployment skipped: ${skipped.join(', ')}.` : undefined;
}
