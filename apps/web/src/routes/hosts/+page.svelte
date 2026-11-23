<script lang="ts">
  import { resolve } from '$app/paths';
  import { Button } from '#lib/components/ui/button/index.ts';
  import type { PageProps } from './$types';
  import DataTable from '#lib/components/svelte/data-table.svelte';
  import { createColumnHelper, renderSnippet } from '@tanstack/svelte-table';
  import type { DataTableFeatures } from '#lib/components/svelte/data-table-features.js';


  let { data }: PageProps = $props();
  type Host = PageProps['data']['hosts'][number];
  const column = createColumnHelper<DataTableFeatures, Host>();
  const columns = column.columns([
    column.accessor(({ name, hostname, ipAddress }) => [name, hostname, ipAddress].filter(Boolean).join(' '), {
      id: 'name',
      header: 'Hostname',
      filterFn: 'includesString',
      cell: ({ row }) => renderSnippet(hostLink, row.original)
    }),
    column.accessor('ipAddress', { header: 'IP address', cell: ({ getValue }) => getValue() ?? '—' }),
    column.accessor('ping', {
      header: 'Ping result',
      cell: ({ row }) => renderSnippet(pingResult, row.original)
    }),
    column.accessor('method', { header: 'Management' }),
    column.accessor('agent', {
      header: 'Agent',
      cell: ({ getValue }) => renderSnippet(status, getValue(), 'Stale')
    }),
    column.accessor('ansible', {
      header: 'Ansible',
      cell: ({ getValue }) => renderSnippet(status, getValue(), 'Failed')
    }),
    column.accessor('certificates', {
      header: () => renderSnippet(rightAligned, 'Certificates'),
      cell: ({ getValue }) => renderSnippet(rightAligned, getValue() ?? 'Unknown')
    })
  ]);
</script>

<svelte:head>
  <title>Hosts | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="hosts-heading">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="grid gap-1">
      <h1 id="hosts-heading" class="font-heading text-xl font-semibold">Hosts</h1>
      <p class="text-xs text-muted-foreground">Agent check-ins and Ansible runs across your servers.</p>
    </div>
    <Button href={resolve('/hosts/new')}>Add host</Button>
  </header>

  <div class="mt-6">
    <DataTable
      caption="Managed host inventory"
      {columns}
      data={data.hosts}
      rowKey={(host) => host.id}
      rowHeader="name"
      filter={{ column: 'name', label: 'Filter by hostname or IP' }}
      emptyMessage={data.hosts.length ? 'No hosts match that hostname or IP.' : 'No hosts have been added yet.'}
      tableClass="min-w-[44rem]"
    />
  </div>
</section>

{#snippet hostLink(host: Host)}
  <a href={resolve('/hosts/[id]', { id: host.id })} aria-label={`View host ${host.hostname ?? host.name}`} class="text-primary underline underline-offset-4">
    {host.hostname ?? 'Not collected'}
  </a>
{/snippet}

{#snippet pingResult(host: Host)}
  <span>{host.ping}</span>
  {#if host.pingTime}
    <span class="block text-muted-foreground">{host.pingTime}</span>
  {/if}
{/snippet}

{#snippet status(value: string | null, warning: string)}
  <span class:text-destructive={value?.startsWith(warning)}>{value ?? '—'}</span>
{/snippet}

{#snippet rightAligned(value: string | number)}
  <span class="block text-right tabular-nums">{value}</span>
{/snippet}
