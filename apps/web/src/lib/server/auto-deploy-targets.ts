import { deploymentServices } from '../deployment-services.js';

type Deployment = {
  id: string;
  hostId: string | null;
  endpoint: string;
  engine: string | null;
  method: string;
};

// Agent only: Ansible jobs need SSH credentials supplied per deployment.
export function pickAutoDeployTargets(deployments: Deployment[]) {
  const hosts = new Set<string>();
  const targets: (Deployment & { hostId: string; engine: string })[] = [];
  const skipped: string[] = [];
  for (const deployment of deployments) {
    const { hostId, engine } = deployment;
    if (
      deployment.method !== 'Agent' ||
      !hostId ||
      !engine ||
      !deploymentServices.some((service) => service === engine) ||
      hosts.has(hostId)
    ) {
      if (deployment.method !== 'Manual') skipped.push(deployment.endpoint);
      continue;
    }
    hosts.add(hostId);
    targets.push({ ...deployment, hostId, engine });
  }
  return { targets, skipped };
}
