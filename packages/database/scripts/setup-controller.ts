import { openDatabase } from "../src/index.js";
import { sql } from "drizzle-orm";

const webPassword = Bun.env.CBP_DATABASE_WEB_PASSWORD;
if (webPassword !== undefined && !/^[A-Za-z0-9_-]{32,128}$/.test(webPassword)) {
  throw new Error(
    "CBP_DATABASE_WEB_PASSWORD must be 32 to 128 URL-safe characters",
  );
}

const db = openDatabase();
try {
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
      sql`alter table cbp_hosts add column if not exists allowed_deployment_services text[]`,
    );
    await tx.execute(sql`alter table cbp_deployments
      add column if not exists listener_status text,
      add column if not exists listener_address text,
      add column if not exists listener_checked_at timestamp with time zone`);
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
    create table if not exists cbp_deployment_jobs (
      id uuid primary key default gen_random_uuid(),
      deployment_id uuid not null references cbp_deployments(id) on delete cascade,
      host_id uuid not null references cbp_hosts(id) on delete cascade,
      agent_hash text not null,
      endpoint text not null,
      engine text not null,
      fullchain text not null,
      sealed_key text,
      status text not null,
      detail text,
      expires_at timestamp with time zone not null
    )
  `;
  await db.transaction(async (tx) => {
    await tx.execute(sql`create table if not exists cbp_deployment_runs (
      id uuid primary key default gen_random_uuid(),
      slug text,
      certificate_id uuid not null references cbp_certificates(id) on delete cascade,
      submitted_at timestamp with time zone default now()
    )`);
    await tx.execute(
      sql`alter table cbp_deployment_runs add column if not exists slug text`,
    );
    await tx.execute(
      sql`alter table cbp_deployment_runs alter column slug drop not null`,
    );
    await tx.execute(sql`alter table cbp_deployment_jobs add column if not exists run_id uuid
      references cbp_deployment_runs(id) on delete cascade`);
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
      alter column run_id set not null,
      drop constraint if exists cbp_deployment_jobs_deployment_id_key,
      drop constraint if exists cbp_deployment_jobs_deployment_id_unique`);
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
      after insert or update of status, detail or delete on cbp_deployment_jobs
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
      await tx.execute(
        sql`grant select, insert on public.cbp_deployment_runs, public.cbp_audit_events to cbp_web`,
      );
      await tx.execute(sql`grant select on public.cbp_alerts to cbp_web`);
    });
  }
} finally {
  await db.$client.close();
}
