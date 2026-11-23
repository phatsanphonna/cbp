import { isIP } from "node:net";
import { listHosts } from "@cbp/database/inventory";
import { getDatabase } from "#lib/server/database.js";
import { dateFormatter } from "#lib/server/date-formatter.js";
import { hostIpAddress } from "#lib/server/host-address.js";
import { pingLabels } from "#lib/server/ping-host.js";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, depends }) => {
  depends("cbp:host-ping");
  const format = dateFormatter(cookies.get("cbp-time-zone"));
  const hosts = await listHosts(getDatabase());
  return {
    hosts: hosts.map((host) => ({
      id: host.id,
      name: host.name,
      hostname:
        host.hostname ?? host.fqdn ?? (isIP(host.name) ? null : host.name),
      ipAddress: hostIpAddress(host),
      ping: host.lastPingStatus
        ? pingLabels[host.lastPingStatus]
        : "Not checked",
      pingTime: host.lastPingAt ? format.format(host.lastPingAt) : null,
      method: host.agentManaged
        ? host.ansibleManaged
          ? "Both"
          : "Agent"
        : host.ansibleManaged
          ? "Ansible"
          : "Unmanaged",
      agent: host.agentManaged
        ? host.agentSeenAt
          ? format.format(host.agentSeenAt)
          : "Never checked in"
        : null,
      ansible: host.ansibleManaged
        ? host.ansibleRunAt
          ? `${host.ansibleSucceeded === false ? "Failed" : host.ansibleSucceeded ? "Succeeded" : "Result unknown"} · ${format.format(host.ansibleRunAt)}`
          : "Never run"
        : null,
      certificates: host.certificates,
    })),
  };
};
