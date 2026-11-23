import { saveControllerHeartbeat } from '@cbp/database/controller-status';
import { expireDeploymentJobs } from '@cbp/database/deployment-jobs';
import { deploymentEncryptionKey } from '#lib/server/controller-config.js';
import { controllerPost } from '../request.js';

export const POST = controllerPost(async (db) => {
  await saveControllerHeartbeat(db);
  if (deploymentEncryptionKey()) await expireDeploymentJobs(db);
  return 204;
});
