<script lang="ts">
  import { Info } from "@lucide/svelte";
  import { resolve } from "$app/paths";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Tooltip from "#lib/components/ui/tooltip/index.ts";
  import type { PageProps } from "./$types";
  import DataTable from "#lib/components/svelte/data-table.svelte";
  import { createColumnHelper, renderSnippet } from "@tanstack/svelte-table";
  import type { DataTableFeatures } from "#lib/components/svelte/data-table-features.js";
  import { refreshHostPing } from "#lib/hooks/refresh-host-ping.js";

  let { data }: PageProps = $props();
  refreshHostPing();
  type Host = PageProps["data"]["hosts"][number];
  const column = createColumnHelper<DataTableFeatures, Host>();
  const columns = column.columns([
    column.accessor(
      ({ name, hostname, ipAddress, applianceType, method }) =>
        [name, hostname, ipAddress, applianceType, method]
          .filter(Boolean)
          .join(" "),
      {
        id: "host",
        header: "Host",
        filterFn: "includesString",
        cell: ({ row }) => renderSnippet(hostIdentity, row.original),
      },
    ),
    column.accessor("ping", {
      header: () => renderSnippet(reachabilityHeader),
      cell: ({ row }) => renderSnippet(networkStatus, row.original),
    }),
    column.accessor("method", {
      header: () => renderSnippet(managementHeader),
      cell: ({ row }) => renderSnippet(managementStatus, row.original),
    }),
    column.accessor("certificates", {
      header: () => renderSnippet(rightAligned, "Certificates"),
      cell: ({ row }) => renderSnippet(certificateCount, row.original),
    }),
  ]);
</script>

<svelte:head>
  <title>Hosts | CBP</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="hosts-heading">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="grid gap-1">
      <h1 id="hosts-heading" class="font-heading text-xl font-semibold">
        Hosts
      </h1>
      <p class="text-xs text-muted-foreground">
        Reachability, management activity, and certificate coverage in one
        place.
      </p>
    </div>
    {#if data.canManageHosts}
      <Button href={resolve("/hosts/new")}>Add host</Button>
    {/if}
  </header>

  <div class="mt-6">
    <DataTable
      caption="Host inventory"
      {columns}
      data={data.hosts}
      rowKey={(host) => host.id}
      rowHeader="host"
      filter={{ column: "host", label: "Search hosts" }}
      emptyMessage={data.hosts.length
        ? "No hosts match your search."
        : "No hosts yet. Add a host to start tracking it."}
      tableClass="min-w-[36rem]"
    />
  </div>
</section>

{#snippet hostIdentity(host: Host)}
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-normal">
    <a
      href={resolve("/hosts/[id]", { id: host.id })}
      class="font-medium text-primary underline underline-offset-4 wrap-anywhere"
      >{host.hostname ?? host.name}</a
    >
    {#if host.ipAddress && host.ipAddress !== (host.hostname ?? host.name)}
      <span class="text-muted-foreground">({host.ipAddress})</span>
    {/if}
    <Badge variant="outline">{host.applianceType ?? "Not specified"}</Badge>
  </div>
{/snippet}

{#snippet networkStatus(host: Host)}
  <div class="grid justify-items-start gap-1.5 whitespace-normal">
    <Tooltip.Root>
      <Tooltip.Trigger
        class="inline-flex cursor-help focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`${host.ping}. Show reachability details`}
      >
        <Badge
          variant={host.pingStatus === "no-reply"
            ? "destructive"
            : host.pingStatus === "reachable"
              ? "secondary"
              : "outline"}
        >
          {host.ping}
          <Info data-icon="inline-end" aria-hidden="true" />
        </Badge>
      </Tooltip.Trigger>
      <Tooltip.Content sideOffset={4} class="max-w-xs whitespace-normal">
        {#if host.pingTime}
          Checked {host.pingTime}
        {:else}
          This host has not been checked yet.
        {/if}
      </Tooltip.Content>
    </Tooltip.Root>
  </div>
{/snippet}

{#snippet reachabilityHeader()}
  <span>Reachability</span>
{/snippet}

{#snippet managementStatus(host: Host)}
  <div class="flex flex-wrap gap-2">
    {#if host.method === "Unmanaged"}
      <Tooltip.Root>
        <Tooltip.Trigger
          class="inline-flex cursor-help focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Unmanaged. Show management details"
        >
          <Badge variant="outline">
            Unmanaged <Info data-icon="inline-end" aria-hidden="true" />
          </Badge>
        </Tooltip.Trigger>
        <Tooltip.Content sideOffset={4} class="max-w-xs whitespace-normal">
          Agent and Ansible management are not configured for this host.
        </Tooltip.Content>
      </Tooltip.Root>
    {:else}
      {#if host.agent}
        <Tooltip.Root>
          <Tooltip.Trigger
            class="inline-flex cursor-help focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Agent. Show last check-in"
          >
            <Badge
              variant={host.agent === "Never checked in"
                ? "outline"
                : "secondary"}
            >
              Agent <Info data-icon="inline-end" aria-hidden="true" />
            </Badge>
          </Tooltip.Trigger>
          <Tooltip.Content sideOffset={4} class="max-w-xs whitespace-normal">
            {host.agent}
          </Tooltip.Content>
        </Tooltip.Root>
      {/if}
      {#if host.ansible}
        <Tooltip.Root>
          <Tooltip.Trigger
            class="inline-flex cursor-help focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={host.ansible.startsWith("Failed")
              ? "Ansible failed. Show last run"
              : "Ansible. Show last run"}
          >
            <Badge
              variant={host.ansible.startsWith("Failed")
                ? "destructive"
                : host.ansible === "Never run"
                  ? "outline"
                  : "secondary"}
            >
              Ansible{host.ansible.startsWith("Failed") ? " failed" : ""}
              <Info data-icon="inline-end" aria-hidden="true" />
            </Badge>
          </Tooltip.Trigger>
          <Tooltip.Content sideOffset={4} class="max-w-xs whitespace-normal">
            {host.ansible}
          </Tooltip.Content>
        </Tooltip.Root>
      {/if}
    {/if}
  </div>
{/snippet}

{#snippet managementHeader()}
  <span>Management</span>
{/snippet}

{#snippet certificateCount(host: Host)}
  <a
    href={`${resolve("/hosts/[id]", { id: host.id })}#host-deployments-heading`}
    aria-label={`View ${host.certificates} certificate deployments for ${host.name}`}
    class="block text-right tabular-nums text-primary underline underline-offset-4"
    >{host.certificates}</a
  >
{/snippet}

{#snippet rightAligned(value: string)}
  <span class="block text-right tabular-nums">{value}</span>
{/snippet}
