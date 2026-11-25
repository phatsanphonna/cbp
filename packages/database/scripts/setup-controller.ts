import { openDatabase } from "../src/index.js";
import { sql } from "drizzle-orm";
import { fileURLToPath } from 'node:url';

const webPassword = Bun.env.CBP_DATABASE_WEB_PASSWORD;
if (webPassword !== undefined && !/^[A-Za-z0-9_-]{32,128}$/.test(webPassword)) {
  throw new Error(
    "CBP_DATABASE_WEB_PASSWORD must be 32 to 128 URL-safe characters",
  );
}

const db = openDatabase();
try {
  const [schema] = await db.$client`
    select count(*)::int as present
    from unnest(array[
      'cbp_auth_user', 'cbp_auth_session', 'cbp_auth_account', 'cbp_auth_verification',
      'cbp_hosts', 'cbp_certificates', 'cbp_deployments'
    ]) as core(name)
    where to_regclass('public.' || name) is not null
  `;
  if (schema.present === 0) {
    const bootstrap = Bun.spawn([process.execPath, 'run', 'db:push'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if (await bootstrap.exited !== 0) throw new Error('Could not initialize the CBP database.');
  } else if (schema.present !== 7) {
    throw new Error('The CBP database has an incomplete base schema. Restore a complete database before upgrading.');
  }

  await db.$client`
    create table if not exists cbp_audit_events (
      id uuid primary key default gen_random_uuid(),
      occurred_at timestamp with time zone not null default now(),
      actor_id text,
      actor_name text,
      action text not null,
      route text not null,
      target_id text,
      status integer not null
    )
  `;
  await db.$client`
    create index if not exists cbp_audit_events_occurred_at_idx on cbp_audit_events (occurred_at, id)
  `;
  await db.$client`
    alter table cbp_certificates add column if not exists previous_fullchain text
  `;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table cbp_hosts
        add column if not exists allowed_deployment_services text[],
        add column if not exists deployment_service_versions jsonb,
        add column if not exists consecutive_ping_failures integer not null default 0,
        add column if not exists appliance_type text`,
    );
    await tx.execute(sql`alter table cbp_deployments
      add column if not exists listener_status text,
      add column if not exists listener_address text,
      add column if not exists listener_checked_at timestamp with time zone,
      add column if not exists listener_fingerprint text,
      add column if not exists served_certificate_expires_at timestamp with time zone,
      add column if not exists served_certificate_observed_at timestamp with time zone,
      add column if not exists expected_fingerprint text`);
    await tx.execute(sql`create unique index if not exists cbp_deployments_certificate_id_endpoint_unique
      on cbp_deployments (certificate_id, endpoint)`);
    await tx.execute(sql`update cbp_deployments deployment
      set expected_fingerprint = certificate.fingerprint
      from cbp_certificates certificate
      where deployment.certificate_id = certificate.id
        and deployment.expected_fingerprint is null`);
    await tx.execute(sql`update cbp_deployments
      set listener_status = null, listener_address = null, listener_checked_at = null,
          listener_fingerprint = null
      where method = 'Ansible'
        and (listener_status is not null or listener_address is not null or listener_checked_at is not null or listener_fingerprint is not null)`);
  });
  await db.$client`
    create table if not exists cbp_host_agents (
      host_id uuid primary key,
      invite_hash text,
      invite_expires_at timestamp with time zone,
      token_hash text,
      constraint cbp_host_agents_host_id_cbp_hosts_id_fk
        foreign key (host_id) references cbp_hosts(id) on delete cascade
    )
  `;
  await db.$client`
    create table if not exists cbp_controller_status (
      id integer primary key,
      last_seen_at timestamp with time zone not null
    )
  `;
  await db.$client`
    create table if not exists cbp_alerts (
      id uuid primary key default gen_random_uuid(),
      severity text not null,
      message text not null,
      target text not null,
      detected_at timestamp with time zone not null default now(),
      resolved_at timestamp with time zone
    )
  `;
  await db.$client`
    alter table cbp_alerts
      add column if not exists rule_key text,
      add column if not exists target_id text,
      add column if not exists cleared_at timestamp with time zone
  `;
  await db.$client`
    create unique index if not exists cbp_alerts_open_rule_idx
      on cbp_alerts (rule_key) where resolved_at is null
  `;
  await db.$client`
    create table if not exists cbp_notification_channels (
      id integer primary key generated always as identity,
      provider text not null,
      destination text not null,
      severity text not null,
      enabled boolean not null default true,
      constraint cbp_notification_channels_provider_destination_unique unique (provider, destination)
    )
  `;
  await db.$client`
    alter table cbp_notification_channels
      add column if not exists encrypted_settings text,
      add column if not exists certificate_ids uuid[]
  `;
  await db.$client`
    create table if not exists cbp_alert_deliveries (
      alert_id uuid not null constraint cbp_alert_deliveries_alert_id_cbp_alerts_id_fk
        references cbp_alerts(id) on delete cascade,
      channel_id integer not null constraint cbp_alert_deliveries_channel_id_cbp_notification_channels_id_fk
        references cbp_notification_channels(id) on delete cascade,
      severity text not null,
      attempts integer not null,
      next_attempt_at timestamp with time zone not null,
      delivered_at timestamp with time zone,
      primary key (alert_id, channel_id, severity)
    )
  `;
  await db.$client`
    create table if not exists cbp_deployment_jobs (
      id uuid primary key default gen_random_uuid(),
      deployment_id uuid references cbp_deployments(id) on delete set null,
      host_id uuid references cbp_hosts(id) on delete set null,
      host_name text not null default 'Unknown host',
      recovery boolean not null default false,
      agent_hash text not null,
      endpoint text not null,
      engine text not null,
      fullchain text not null,
      status text not null,
      detail text,
      started_at timestamp with time zone,
      finished_at timestamp with time zone,
      expires_at timestamp with time zone not null
    )
  `;
  await db.transaction(async (tx) => {
    await tx.execute(sql`create table if not exists cbp_deployment_runs (
      id uuid primary key default gen_random_uuid(),
      slug text,
      certificate_id uuid references cbp_certificates(id) on delete set null,
      certificate_name text not null default 'Unknown certificate',
      certificate_sans text[] not null default '{}',
      certificate_fingerprint text,
      submitted_at timestamp with time zone default now()
    )`);
    await tx.execute(
      sql`alter table cbp_deployment_runs add column if not exists slug text`,
    );
    await tx.execute(sql`alter table cbp_deployment_runs
      add column if not exists certificate_name text not null default 'Unknown certificate',
      add column if not exists certificate_sans text[] not null default '{}',
      add column if not exists certificate_fingerprint text`);
    await tx.execute(sql`update cbp_deployment_runs run
      set certificate_name = certificate.domain,
          certificate_sans = certificate.sans,
          certificate_fingerprint = certificate.fingerprint
      from cbp_certificates certificate
      where run.certificate_id = certificate.id
        and run.certificate_name = 'Unknown certificate'`);
    await tx.execute(
      sql`alter table cbp_deployment_runs alter column slug drop not null`,
    );
    await tx.execute(sql`alter table cbp_deployment_jobs add column if not exists run_id uuid
      references cbp_deployment_runs(id) on delete cascade`);
    await tx.execute(sql`alter table cbp_deployment_jobs
      add column if not exists host_name text not null default 'Unknown host',
      add column if not exists recovery boolean not null default false,
      add column if not exists started_at timestamp with time zone,
      add column if not exists finished_at timestamp with time zone,
      add column if not exists log text not null default ''`);
    await tx.execute(sql`alter table cbp_deployment_jobs drop column if exists sealed_key`);
    await tx.execute(sql`update cbp_deployment_jobs job set host_name = host.name
      from cbp_hosts host where job.host_id = host.id and job.host_name = 'Unknown host'`);
    await tx.execute(sql`insert into cbp_deployment_runs (id, certificate_id, submitted_at)
      select job.id, deployment.certificate_id, null
      from cbp_deployment_jobs job join cbp_deployments deployment on deployment.id = job.deployment_id
      where job.run_id is null on conflict (id) do nothing`);
    await tx.execute(
      sql`update cbp_deployment_jobs set run_id = id where run_id is null`,
    );
    await tx.execute(sql`with previous as (
      select coalesce(max(substring(slug from '^deployment-([0-9]+)$')::bigint), 0) as last_number
      from cbp_deployment_runs
    ), numbered as (
      select id, row_number() over (order by id) as number from cbp_deployment_runs where slug is null
    )
    update cbp_deployment_runs run set slug = 'deployment-' || (previous.last_number + numbered.number)
    from previous, numbered where run.id = numbered.id`);
    await tx.execute(
      sql`alter table cbp_deployment_runs alter column slug set not null`,
    );
    await tx.execute(sql`do $$ begin
      if not exists (select 1 from pg_constraint where conrelid = 'cbp_deployment_runs'::regclass
        and conname = 'cbp_deployment_runs_slug_unique') then
        alter table cbp_deployment_runs add constraint cbp_deployment_runs_slug_unique unique (slug);
      end if;
    end $$`);
    await tx.execute(sql`alter table cbp_deployment_jobs
      add column if not exists method text not null default 'Agent',
      alter column agent_hash drop not null,
      alter column run_id set not null,
      drop constraint if exists cbp_deployment_jobs_deployment_id_key,
      drop constraint if exists cbp_deployment_jobs_deployment_id_unique`);
    await tx.execute(sql`alter table cbp_deployment_runs
      alter column certificate_id drop not null,
      drop constraint if exists cbp_deployment_runs_certificate_id_cbp_certificates_id_fk,
      drop constraint if exists cbp_deployment_runs_certificate_id_fkey,
      add constraint cbp_deployment_runs_certificate_id_cbp_certificates_id_fk
        foreign key (certificate_id) references cbp_certificates(id) on delete set null`);
    await tx.execute(sql`alter table cbp_deployment_jobs
      alter column deployment_id drop not null,
      alter column host_id drop not null,
      drop constraint if exists cbp_deployment_jobs_deployment_id_cbp_deployments_id_fk,
      drop constraint if exists cbp_deployment_jobs_deployment_id_fkey,
      drop constraint if exists cbp_deployment_jobs_host_id_cbp_hosts_id_fk,
      drop constraint if exists cbp_deployment_jobs_host_id_fkey,
      add constraint cbp_deployment_jobs_deployment_id_cbp_deployments_id_fk
        foreign key (deployment_id) references cbp_deployments(id) on delete set null,
      add constraint cbp_deployment_jobs_host_id_cbp_hosts_id_fk
        foreign key (host_id) references cbp_hosts(id) on delete set null`);
    await tx.execute(sql`create index if not exists cbp_deployment_runs_submitted_idx
      on cbp_deployment_runs (submitted_at desc nulls last, id desc)`);
    await tx.execute(
      sql`create index if not exists cbp_deployment_jobs_run_idx on cbp_deployment_jobs (run_id)`,
    );
    await tx.execute(
      sql`create index if not exists cbp_deployment_jobs_deployment_idx on cbp_deployment_jobs (deployment_id)`,
    );
    await tx.execute(
      sql`create index if not exists cbp_deployment_jobs_host_idx on cbp_deployment_jobs (host_id)`,
    );
    await tx.execute(sql`create or replace function cbp_notify_deployment_update() returns trigger language plpgsql as $$
      begin
        perform pg_notify('cbp_deployment_updates', '');
        return null;
      end;
    $$`);
    await tx.execute(sql`create or replace trigger cbp_deployment_updates
      after insert or update of status, detail, log or delete on cbp_deployment_jobs
      for each row execute function cbp_notify_deployment_update()`);
  });
  if (webPassword) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('cbp.web_password', ${webPassword}, true)`,
      );
      await tx.execute(sql`do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'cbp_web') then
          create role cbp_web;
        end if;
        execute format('alter role cbp_web login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password %L',
          current_setting('cbp.web_password'));
      end $$`);
      await tx.execute(sql`grant usage on schema public to cbp_web`);
      await tx.execute(sql`grant select, insert, update, delete on
        public.cbp_auth_user, public.cbp_auth_session, public.cbp_auth_account, public.cbp_auth_verification,
        public.cbp_hosts, public.cbp_host_agents, public.cbp_certificates, public.cbp_deployments
        to cbp_web`);
      await tx.execute(sql`grant select, insert, update on public.cbp_controller_status,
        public.cbp_deployment_jobs, public.cbp_notification_channels to cbp_web`);
      await tx.execute(sql`grant delete on public.cbp_deployment_jobs, public.cbp_deployment_runs to cbp_web`);
      await tx.execute(
        sql`grant select, insert on public.cbp_deployment_runs, public.cbp_audit_events to cbp_web`,
      );
      await tx.execute(sql`grant select, insert, update on public.cbp_alerts to cbp_web`);
      await tx.execute(sql`grant select, insert, update on public.cbp_alert_deliveries to cbp_web`);
      await tx.execute(sql`grant delete on public.cbp_notification_channels to cbp_web`);
    });
  }
} finally {
  await db.$client.close();
}
