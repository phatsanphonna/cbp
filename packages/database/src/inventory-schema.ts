import { boolean, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth-schema.js';

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const userGroups = pgTable('cbp_user_groups', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull().unique()
});

export const userGroupMembers = pgTable('cbp_user_group_members', {
  groupId: integer('group_id').notNull().references(() => userGroups.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' })
}, (table) => [primaryKey({ columns: [table.groupId, table.userId] })]);

export const hosts = pgTable('cbp_hosts', {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull().unique(),
  hostname: text(),
  fqdn: text(),
  operatingSystem: text('operating_system'),
  architecture: text(),
  httpsListeners: text('https_listeners'),
  lastProbedAt: instant('last_probed_at'),
  lastPingAt: instant('last_ping_at'),
  lastPingStatus: text('last_ping_status', { enum: ['reachable', 'no-reply', 'unavailable'] }),
  lastPingAddress: text('last_ping_address'),
  agentManaged: boolean('agent_managed').notNull().default(false),
  ansibleManaged: boolean('ansible_managed').notNull().default(false),
  agentSeenAt: instant('agent_seen_at'),
  ansibleRunAt: instant('ansible_run_at'),
  ansibleSucceeded: boolean('ansible_succeeded')
});

export const hostAgents = pgTable('cbp_host_agents', {
  hostId: uuid('host_id').primaryKey().references(() => hosts.id, { onDelete: 'cascade' }),
  inviteHash: text('invite_hash'),
  inviteExpiresAt: instant('invite_expires_at'),
  tokenHash: text('token_hash')
});

export const controllerStatus = pgTable('cbp_controller_status', {
  id: integer().primaryKey(),
  lastSeenAt: instant('last_seen_at').notNull()
});

export const certificates = pgTable('cbp_certificates', {
  id: uuid().defaultRandom().primaryKey(),
  domain: text().notNull(),
  issuer: text().notNull(),
  owner: text(),
  groupId: integer('group_id').references(() => userGroups.id, { onDelete: 'set null' }),
  validFrom: instant('valid_from').notNull(),
  validUntil: instant('valid_until').notNull(),
  serial: text().notNull(),
  fingerprint: text().unique(),
  fullchain: text(),
  sans: text().array().notNull().default([])
});

export const deployments = pgTable('cbp_deployments', {
  id: uuid().defaultRandom().primaryKey(),
  certificateId: uuid('certificate_id').notNull().references(() => certificates.id, { onDelete: 'cascade' }),
  hostId: uuid('host_id').references(() => hosts.id, { onDelete: 'set null' }),
  endpoint: text().notNull(),
  engine: text(),
  method: text({ enum: ['Agent', 'Ansible', 'Manual'] }).notNull(),
  status: text({ enum: ['Pending', 'Verified', 'Failed'] }).notNull().default('Pending')
}, (table) => [unique().on(table.certificateId, table.endpoint)]);

export const alerts = pgTable('cbp_alerts', {
  id: uuid().defaultRandom().primaryKey(),
  severity: text({ enum: ['Info', 'Warning', 'High', 'Critical'] }).notNull(),
  message: text().notNull(),
  target: text().notNull(),
  detectedAt: instant('detected_at').notNull().defaultNow(),
  resolvedAt: instant('resolved_at')
});

export const channels = pgTable('cbp_notification_channels', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  provider: text({ enum: ['Slack', 'LINE', 'Telegram', 'Email', 'Webhook'] }).notNull(),
  destination: text().notNull(),
  severity: text({ enum: ['Info', 'Warning', 'High', 'Critical'] }).notNull(),
  enabled: boolean().notNull().default(true)
}, (table) => [unique().on(table.provider, table.destination)]);
