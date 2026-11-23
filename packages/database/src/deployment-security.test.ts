import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { findAuthUserId, user } from "./auth-schema.js";
import { expireDeploymentJobs } from "./deployment-jobs.js";
import { revokeHostAgent } from "./host-agents.js";
import { openDatabase } from "./index.js";
import {
  certificates,
  deploymentJobs,
  deploymentRuns,
  deployments,
  hostAgents,
  hosts,
} from "./inventory-schema.js";

const databaseURL = Bun.env.CBP_TEST_DATABASE_URL;

test.skipIf(!databaseURL)(
  "deployment expiry and enrollment revocation clear queued keys",
  async () => {
    const db = openDatabase(databaseURL);
    const hostId = randomUUID();
    const certificateId = randomUUID();
    const endpoint = `${hostId}.example.test:443`;
    const expiredId = randomUUID();
    const queuedId = randomUUID();
    const agentHash = "agent-hash";

    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(hosts)
          .values({ id: hostId, name: endpoint, agentManaged: true });
        await tx.insert(hostAgents).values({ hostId, tokenHash: agentHash });
        await tx.insert(certificates).values({
          id: certificateId,
          domain: endpoint,
          issuer: "test",
          serial: certificateId,
          validFrom: new Date(0),
          validUntil: new Date("2099-01-01"),
        });
        const [deployment] = await tx
          .insert(deployments)
          .values({
            certificateId,
            hostId,
            endpoint,
            engine: "Nginx",
            method: "Agent",
          })
          .returning({ id: deployments.id });
        const [run] = await tx
          .insert(deploymentRuns)
          .values({ slug: hostId, certificateId })
          .returning({ id: deploymentRuns.id });
        const job = {
          deploymentId: deployment.id,
          runId: run.id,
          hostId,
          agentHash,
          endpoint,
          engine: "Nginx",
          fullchain: "chain",
          status: "Queued",
          sealedKey: "sealed-test-key",
        } as const;
        await tx.insert(deploymentJobs).values([
          { ...job, id: expiredId, expiresAt: new Date(0) },
          { ...job, id: queuedId, expiresAt: new Date(Date.now() + 600_000) },
        ]);
      });
      const readJobs = async () =>
        Object.fromEntries(
          (
            await db
              .select({
                id: deploymentJobs.id,
                status: deploymentJobs.status,
                sealedKey: deploymentJobs.sealedKey,
              })
              .from(deploymentJobs)
              .where(inArray(deploymentJobs.id, [expiredId, queuedId]))
          ).map((job) => [job.id, job]),
        );

      await expireDeploymentJobs(db);
      expect((await readJobs())[expiredId]).toMatchObject({
        status: "Expired",
        sealedKey: null,
      });
      expect(await revokeHostAgent(db, hostId, "different-token")).toBe(
        "denied",
      );
      expect((await readJobs())[queuedId]).toMatchObject({
        status: "Queued",
        sealedKey: "sealed-test-key",
      });
      expect(await revokeHostAgent(db, hostId, agentHash)).toBe("ok");
      expect((await readJobs())[queuedId]).toMatchObject({
        status: "Failed",
        sealedKey: null,
      });
    } finally {
      try {
        await db.delete(certificates).where(eq(certificates.id, certificateId));
        await db.delete(hosts).where(eq(hosts.id, hostId));
      } finally {
        await db.$client.close();
      }
    }
  },
);

test.skipIf(!databaseURL)(
  "email and username resolve to the same account ID",
  async () => {
    const db = openDatabase(databaseURL);
    const id = randomUUID();
    const email = `${id}@example.test`;
    try {
      await db
        .insert(user)
        .values({ id, name: "Test account", username: id, email });
      expect(await findAuthUserId(db, email)).toBe(id);
      expect(await findAuthUserId(db, id)).toBe(id);
      expect(await findAuthUserId(db, `missing-${email}`)).toBeUndefined();
    } finally {
      try {
        await db.delete(user).where(eq(user.id, id));
      } finally {
        await db.$client.close();
      }
    }
  },
);
