import { isIP } from 'node:net';
import { listHosts } from '@cbp/database/inventory';
import { getDatabase } from '#lib/server/database.js';
import { dateFormatter } from '#lib/server/date-formatter.js';
import { hostIpAddress } from '#lib/server/host-address.js';
import { pingLabels } from '#lib/server/ping-host.js';
import type { PageServerLoad } from './$types';
import { assetViewer, hasPermission } from '#lib/server/access-control.js';

export const load: PageServerLoad = async ({ cookies, depends, locals }) => {
  depends('cbp:host-ping');
  const format = dateFormatter(cookies.get('cbp-time-zone'));
  const hosts = await listHosts(getDatabase(), assetViewer(locals.user));
  return {
    canManageHosts: hasPermission(locals.user, 'hosts.manage'),
    hosts: hosts.map((host) => ({
      id: host.id,
      name: host.name,
      applianceType: host.applianceType,
      hostname: host.hostname ?? host.fqdn ?? (isIP(host.name) ? null : host.name),
      ipAddress: hostIpAddress(host),
      pingStatus: host.lastPingStatus,
      ping: host.lastPingStatus ? pingLabels[host.lastPingStatus] : 'Not checked',
      pingTime: host.lastPingAt ? format.format(host.lastPingAt) : null,
      method: host.agentManaged
        ? host.ansibleManaged
          ? 'Both'
          : 'Agent'
        : host.ansibleManaged
          ? 'Ansible'
          : 'Unmanaged',
      agent: host.agentManaged
        ? host.agentSeenAt
          ? `Checked in ${format.format(host.agentSeenAt)}`
          : 'Never checked in'
        : null,
      ansible: host.ansibleManaged
        ? host.ansibleRunAt
          ? `${host.ansibleSucceeded === false ? 'Failed' : host.ansibleSucceeded ? 'Succeeded' : 'Result unknown'} ${format.format(host.ansibleRunAt)}`
          : 'Never run'
        : null,
      certificates: host.certificates,
    })),
  };
};
