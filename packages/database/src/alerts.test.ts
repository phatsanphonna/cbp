import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { reconcileAlerts } from './alerts.js';
import { openDatabase } from './index.js';
import { alerts, certificates, deployments } from './inventory-schema.js';

const databaseURL = Bun.env.CBP_TEST_DATABASE_URL;

test.skipIf(!databaseURL)('drifted listeners raise an alert that resolves once fixed', async () => {
  const db = openDatabase(databaseURL);
  const certificateId = randomUUID();
  const domain = `${randomUUID()}.example.test`;
  try {
    await db.insert(certificates).values({
      id: certificateId,
      domain,
      issuer: 'test',
      serial: certificateId,
      validFrom: new Date(0),
      validUntil: new Date('2099-01-01'),
    });
    const [deployment] = await db
      .insert(deployments)
      .values({
        certificateId,
        endpoint: domain,
        method: 'Agent',
        listenerStatus: 'drifted',
      })
      .returning({ id: deployments.id });
    const ruleKey = `listener-drift:${deployment.id}`;
    const open = () =>
      db
        .select()
        .from(alerts)
        .where(eq(alerts.ruleKey, ruleKey))
        .then(([alert]) => alert);

    await reconcileAlerts(db);
    const raised = await open();
    expect(raised).toMatchObject({
      severity: 'High',
      targetId: certificateId,
      resolvedAt: null,
    });

    await db
      .update(deployments)
      .set({ listenerStatus: 'ready' })
      .where(eq(deployments.id, deployment.id));
    await reconcileAlerts(db);
    expect((await open())?.resolvedAt).toBeInstanceOf(Date);
  } finally {
    try {
      await db.delete(alerts).where(eq(alerts.targetId, certificateId));
      await db.delete(certificates).where(eq(certificates.id, certificateId));
    } finally {
      await db.$client.close();
    }
  }
});
