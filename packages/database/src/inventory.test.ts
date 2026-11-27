import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { enrollHostAgent, inviteHostAgent, revokeHostAgent } from './host-agents.js';
import { openDatabase } from './index.js';
import { findHost, listHosts, registerHost } from './inventory.js';
import { certificates, deployments, hosts } from './inventory-schema.js';

const databaseURL = Bun.env.CBP_TEST_DATABASE_URL;

test.skipIf(!databaseURL)(
  'host inventory stores appliance types and supports unclassified hosts',
  async () => {
    const db = openDatabase(databaseURL);
    const applianceName = `${randomUUID()}.example.test`;
    const legacyName = `${randomUUID()}.example.test`;
    try {
      const [appliance] = await registerHost(db, {
        name: applianceName,
        applianceType: 'Other',
        ansibleManaged: true,
      });
      const [legacy] = await registerHost(db, { name: legacyName });
      expect((await findHost(db, appliance.id))?.applianceType).toBe('Other');
      expect((await findHost(db, legacy.id))?.applianceType).toBeNull();
      expect((await listHosts(db)).find(({ id }) => id === appliance.id)?.applianceType).toBe(
        'Other',
      );
    } finally {
      try {
        await db.delete(hosts).where(inArray(hosts.name, [applianceName, legacyName]));
      } finally {
        await db.$client.close();
      }
    }
  },
);

test.skipIf(!databaseURL)(
  'host details hide old Ansible readiness while preserving agent readiness',
  async () => {
    const db = openDatabase(databaseURL);
    const hostId = randomUUID();
    const ansibleCertificateId = randomUUID();
    const agentCertificateId = randomUUID();
    const endpoint = 'listener.example.test:443';
    try {
      await db.insert(hosts).values({
        id: hostId,
        name: `${hostId}.example.test`,
        agentManaged: true,
        ansibleManaged: true,
      });
      await db.insert(certificates).values(
        [ansibleCertificateId, agentCertificateId].map((id) => ({
          id,
          domain: 'listener.example.test',
          issuer: 'test',
          serial: id,
          validFrom: new Date(0),
          validUntil: new Date('2099-01-01'),
        })),
      );
      await db.insert(deployments).values([
        {
          certificateId: ansibleCertificateId,
          hostId,
          endpoint,
          method: 'Ansible',
          listenerStatus: 'tls-error',
          listenerAddress: endpoint,
          listenerCheckedAt: new Date(),
        },
        {
          certificateId: agentCertificateId,
          hostId,
          endpoint,
          method: 'Agent',
          listenerStatus: 'ready',
        },
      ]);

      const readTargets = async () => {
        const rows = (await findHost(db, hostId))?.deployments ?? [];
        return {
          ansible: rows.find(({ method }) => method === 'Ansible'),
          agent: rows.find(({ method }) => method === 'Agent'),
        };
      };
      expect(await readTargets()).toMatchObject({
        ansible: {
          listenerStatus: null,
          listenerAddress: null,
          listenerCheckedAt: null,
          status: 'Pending',
        },
        agent: { listenerStatus: 'ready' },
      });
      expect(await revokeHostAgent(db, hostId)).toBe('ok');
      expect(await readTargets()).toMatchObject({
        ansible: { listenerStatus: null },
        agent: { listenerStatus: null },
      });
    } finally {
      try {
        await db
          .delete(certificates)
          .where(inArray(certificates.id, [ansibleCertificateId, agentCertificateId]));
        await db.delete(hosts).where(eq(hosts.id, hostId));
      } finally {
        await db.$client.close();
      }
    }
  },
);

test.skipIf(!databaseURL)('only Linux hosts can start or complete agent enrollment', async () => {
  const db = openDatabase(databaseURL);
  const linuxId = randomUUID();
  const applianceId = randomUUID();
  const legacyId = randomUUID();
  try {
    await db.insert(hosts).values([
      {
        id: linuxId,
        name: `${linuxId}.example.test`,
        applianceType: 'Linux',
      },
      {
        id: applianceId,
        name: `${applianceId}.example.test`,
        applianceType: 'Other',
      },
      { id: legacyId, name: `${legacyId}.example.test` },
    ]);
    expect(await inviteHostAgent(db, applianceId, 'invite', { enableAgent: true })).toBe(
      'unsupported',
    );
    expect(await inviteHostAgent(db, legacyId, 'invite', { enableAgent: true })).toBe(
      'unsupported',
    );
    expect(await inviteHostAgent(db, linuxId, 'invite', { enableAgent: true })).toBe('ok');
    await db.update(hosts).set({ applianceType: 'Other' }).where(eq(hosts.id, linuxId));
    expect(await enrollHostAgent(db, linuxId, 'invite', 'token')).toBe('unsupported');
  } finally {
    try {
      await db.delete(hosts).where(inArray(hosts.id, [linuxId, applianceId, legacyId]));
    } finally {
      await db.$client.close();
    }
  }
});
