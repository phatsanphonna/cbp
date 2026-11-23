import { defineConfig } from 'drizzle-kit';

const url = Bun.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/auth-schema.ts', './src/inventory-schema.ts'],
  dbCredentials: { url },
  tablesFilter: ['cbp_auth_*', 'cbp_hosts', 'cbp_host_agents', 'cbp_controller_status', 'cbp_certificates', 'cbp_deployments', 'cbp_deployment_runs', 'cbp_deployment_jobs', 'cbp_audit_events', 'cbp_alerts', 'cbp_notification_channels', 'cbp_user_groups', 'cbp_user_group_members']
});
