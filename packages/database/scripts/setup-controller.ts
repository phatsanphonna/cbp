import { openDatabase } from '../src/index.js';

const db = openDatabase();
try {
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
} finally {
  await db.$client.close();
}
