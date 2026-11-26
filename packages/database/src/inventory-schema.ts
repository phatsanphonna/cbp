import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const userGroups = pgTable("cbp_user_groups", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull().unique(),
});

export const userGroupMembers = pgTable(
  "cbp_user_group_members",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => userGroups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] })],
);

export const hosts = pgTable("cbp_hosts", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull().unique(),
  applianceType: text("appliance_type"),
  hostname: text(),
  fqdn: text(),
  operatingSystem: text("operating_system"),
  architecture: text(),
  httpsListeners: text("https_listeners"),
  lastProbedAt: instant("last_probed_at"),
  lastPingAt: instant("last_ping_at"),
  consecutivePingFailures: integer("consecutive_ping_failures")
    .notNull()
    .default(0),
  lastPingStatus: text("last_ping_status", {
    enum: ["reachable", "no-reply", "unavailable"],
  }),
  lastPingAddress: text("last_ping_address"),
  allowedDeploymentServices: text("allowed_deployment_services").array(),
  deploymentServiceVersions: jsonb("deployment_service_versions").$type<
    Record<string, string>
  >(),
  agentManaged: boolean("agent_managed").notNull().default(false),
  ansibleManaged: boolean("ansible_managed").notNull().default(false),
  agentSeenAt: instant("agent_seen_at"),
  ansibleRunAt: instant("ansible_run_at"),
  ansibleSucceeded: boolean("ansible_succeeded"),
});

export const hostAgents = pgTable("cbp_host_agents", {
  hostId: uuid("host_id")
    .primaryKey()
    .references(() => hosts.id, { onDelete: "cascade" }),
  inviteHash: text("invite_hash"),
  inviteExpiresAt: instant("invite_expires_at"),
  tokenHash: text("token_hash"),
});

export const controllerStatus = pgTable("cbp_controller_status", {
  id: integer().primaryKey(),
  lastSeenAt: instant("last_seen_at").notNull(),
});

export const certificates = pgTable("cbp_certificates", {
  id: uuid().defaultRandom().primaryKey(),
  domain: text().notNull(),
  issuer: text().notNull(),
  owner: text(),
  groupId: integer("group_id").references(() => userGroups.id, {
    onDelete: "set null",
  }),
  validFrom: instant("valid_from").notNull(),
  validUntil: instant("valid_until").notNull(),
  serial: text().notNull(),
  fingerprint: text().unique(),
  fullchain: text(),
  previousFullchain: text("previous_fullchain"),
  sans: text().array().notNull().default([]),
  autoRenew: boolean('auto_renew').notNull().default(false),
  renewalRetryAt: instant('renewal_retry_at'),
  renewalError: text('renewal_error'),
  renewalKey: text('renewal_key'),
  previousRenewalKey: text('previous_renewal_key'),
});

export const acmeAccounts = pgTable('cbp_acme_accounts', {
  id: text().primaryKey(),
  encryptedKey: text('encrypted_key').notNull(),
});

export const acmeChallenges = pgTable('cbp_acme_challenges', {
  token: text().primaryKey(),
  authorization: text('key_authorization').notNull(),
  expiresAt: instant('expires_at').notNull(),
});

export const deployments = pgTable(
  "cbp_deployments",
  {
    id: uuid().defaultRandom().primaryKey(),
    certificateId: uuid("certificate_id")
      .notNull()
      .references(() => certificates.id, { onDelete: "cascade" }),
    hostId: uuid("host_id").references(() => hosts.id, {
      onDelete: "set null",
    }),
    endpoint: text().notNull(),
    engine: text(),
    method: text({ enum: ["Agent", "Ansible", "Manual"] }).notNull(),
    status: text({ enum: ["Pending", "Verified", "Failed"] })
      .notNull()
      .default("Pending"),
    listenerStatus: text("listener_status", {
      enum: ["ready", "drifted", "unreachable", "tls-error", "not-allowed"],
    }),
    listenerAddress: text("listener_address"),
    listenerCheckedAt: instant("listener_checked_at"),
    listenerFingerprint: text("listener_fingerprint"),
    servedCertificateExpiresAt: instant("served_certificate_expires_at"),
    servedCertificateObservedAt: instant("served_certificate_observed_at"),
    expectedFingerprint: text("expected_fingerprint"),
  },
  (table) => [unique().on(table.certificateId, table.endpoint)],
);

export const deploymentRuns = pgTable(
  "cbp_deployment_runs",
  {
    id: uuid().defaultRandom().primaryKey(),
    slug: text().notNull().unique(),
    certificateId: uuid("certificate_id").references(() => certificates.id, {
      onDelete: "set null",
    }),
    certificateName: text("certificate_name")
      .notNull()
      .default("Unknown certificate"),
    certificateSans: text("certificate_sans").array().notNull().default([]),
    certificateFingerprint: text("certificate_fingerprint"),
    submittedAt: instant("submitted_at").defaultNow(),
  },
  (table) => [
    index("cbp_deployment_runs_submitted_idx").on(
      table.submittedAt.desc().nullsLast(),
      table.id.desc(),
    ),
  ],
);

export const deploymentJobs = pgTable(
  "cbp_deployment_jobs",
  {
    id: uuid().defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => deploymentRuns.id, { onDelete: "cascade" }),
    deploymentId: uuid("deployment_id").references(() => deployments.id, {
      onDelete: "set null",
    }),
    hostId: uuid("host_id").references(() => hosts.id, {
      onDelete: "set null",
    }),
    hostName: text("host_name").notNull().default("Unknown host"),
    agentHash: text("agent_hash"),
    method: text({ enum: ["Agent", "Ansible"] })
      .notNull()
      .default("Agent"),
    recovery: boolean().notNull().default(false),
    endpoint: text().notNull(),
    engine: text().notNull(),
    fullchain: text().notNull(),
    status: text({
      enum: ["Queued", "Running", "Deployed", "Failed", "Expired"],
    }).notNull(),
    detail: text(),
    log: text().notNull().default(""),
    startedAt: instant("started_at"),
    finishedAt: instant("finished_at"),
    expiresAt: instant("expires_at").notNull(),
  },
  (table) => [
    index("cbp_deployment_jobs_run_idx").on(table.runId),
    index("cbp_deployment_jobs_deployment_idx").on(table.deploymentId),
    index("cbp_deployment_jobs_host_idx").on(table.hostId),
  ],
);

export const auditEvents = pgTable(
  "cbp_audit_events",
  {
    id: uuid().defaultRandom().primaryKey(),
    occurredAt: instant("occurred_at").notNull().defaultNow(),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    action: text().notNull(),
    route: text().notNull(),
    targetId: text("target_id"),
    status: integer().notNull(),
  },
  (table) => [
    index("cbp_audit_events_occurred_at_idx").on(table.occurredAt, table.id),
  ],
);

export const alerts = pgTable(
  "cbp_alerts",
  {
    id: uuid().defaultRandom().primaryKey(),
    ruleKey: text("rule_key"),
    targetId: text("target_id"),
    severity: text({ enum: ["Info", "Warning", "High", "Critical"] }).notNull(),
    message: text().notNull(),
    target: text().notNull(),
    detectedAt: instant("detected_at").notNull().defaultNow(),
    resolvedAt: instant("resolved_at"),
    clearedAt: instant("cleared_at"),
  },
  (table) => [
    uniqueIndex("cbp_alerts_open_rule_idx")
      .on(table.ruleKey)
      .where(sql`${table.resolvedAt} is null`),
  ],
);

export const channels = pgTable(
  "cbp_notification_channels",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    provider: text({
      enum: [
        "Slack",
        "LINE",
        "Telegram",
        "Email",
        "Webhook",
        "Microsoft Teams",
        "Discord",
      ],
    }).notNull(),
    destination: text().notNull(),
    encryptedSettings: text("encrypted_settings"),
    certificateIds: uuid("certificate_ids").array(),
    severity: text({ enum: ["Info", "Warning", "High", "Critical"] }).notNull(),
    enabled: boolean().notNull().default(true),
  },
  (table) => [unique().on(table.provider, table.destination)],
);

export const alertDeliveries = pgTable(
  "cbp_alert_deliveries",
  {
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    severity: text().notNull(),
    attempts: integer().notNull(),
    nextAttemptAt: instant("next_attempt_at").notNull(),
    deliveredAt: instant("delivered_at"),
  },
  (table) => [
    primaryKey({
      name: "cbp_alert_deliveries_pkey",
      columns: [table.alertId, table.channelId, table.severity],
    }),
  ],
);
