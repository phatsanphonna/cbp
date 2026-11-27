import {
  appendDeploymentLog,
  claimDeployment,
  finishDeployment,
  listAnsibleDeploymentTargets,
  saveAnsibleHostReport,
} from '@cbp/database/deployment-jobs';
import { json } from '@sveltejs/kit';
import { unpackAnsibleDeployment } from '#lib/server/ansible-deployment-payload.js';
import { getAnsibleToken } from '#lib/server/controller-config.js';
import { takeDeploymentSecret } from '#lib/server/deployment-secrets.js';
import { validateHostReport } from '#lib/server/host-report.js';
import { parseServedCertificateExpiry } from '#lib/server/served-certificate.js';
import { hasTrustedTransport } from '#lib/server/trusted-transport.js';
import { controllerPost, validHostId } from '../controller/request.js';
import type { RequestHandler } from './$types';

const run = controllerPost(
  async (
    db,
    { operation, hostId, endpoint, jobId, succeeded, message, report, servedCertificateExpiresAt },
  ) => {
    if (operation === 'targets') {
      return json(await listAnsibleDeploymentTargets(db), {
        headers: { 'cache-control': 'no-store' },
      });
    }
    if (!validHostId(hostId) || typeof endpoint !== 'string' || !endpoint || endpoint.length > 300)
      return 400;
    const worker = { method: 'Ansible', endpoint } as const;
    if (operation === 'claim') {
      const job = await claimDeployment(db, hostId, worker, (row, collectHostFacts) => ({
        id: row.id,
        fullchain: row.fullchain,
        collectHostFacts,
      }));
      if (job === 'missing' || job === 'denied') return 404;
      if (!job) return 204;
      const payload = await takeDeploymentSecret(job.id).catch(() => null);
      if (!payload) {
        await finishDeployment(
          db,
          hostId,
          worker,
          job.id,
          'The deployment key could not be retrieved. Upload the private key and queue the deployment again.',
        );
        return 204;
      }
      return json(
        { ...job, ...unpackAnsibleDeployment(payload) },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    if (operation === 'report') {
      if (!validHostId(jobId)) return 400;
      const facts = validateHostReport(report);
      if (!facts?.operatingSystem || !facts.architecture) return 400;
      const { hostname, fqdn, operatingSystem, architecture, lastProbedAt } = facts;
      const result = await saveAnsibleHostReport(db, hostId, endpoint, jobId, {
        hostname,
        fqdn,
        operatingSystem,
        architecture,
        lastProbedAt,
      });
      return result === 'ok' ? 204 : 404;
    }
    if (operation === 'log') {
      if (
        !validHostId(jobId) ||
        typeof message !== 'string' ||
        !message.trim() ||
        Buffer.byteLength(message) > 1024 ||
        /\p{Cc}/u.test(message)
      )
        return 400;
      const result = await appendDeploymentLog(db, hostId, worker, jobId, message);
      return result === 'ok' ? 204 : 404;
    }
    if (operation !== 'finish' || !validHostId(jobId) || typeof succeeded !== 'boolean') return 400;
    const servedExpiry = parseServedCertificateExpiry(servedCertificateExpiresAt);
    if (servedCertificateExpiresAt !== undefined && (!succeeded || !servedExpiry)) return 400;
    const result = await finishDeployment(
      db,
      hostId,
      worker,
      jobId,
      succeeded
        ? null
        : 'The Ansible deployment failed. Check the runner and Nginx on the target host.',
      servedExpiry ?? undefined,
    );
    return result === 'ok' ? 204 : 404;
  },
  4096,
  getAnsibleToken,
);

export const POST: RequestHandler = (event) =>
  hasTrustedTransport(event) ? run(event) : new Response(null, { status: 403 });
