<script lang="ts">
  import { resolve } from "$app/paths";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Table from "#lib/components/ui/table/index.ts";
  import { refreshHostPing } from "#lib/hooks/refresh-host-ping.js";
  import { expiryFilters } from "./certificates/expiry.js";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
  refreshHostPing();
  const inventory = resolve("/certificates");
  const counts = $derived([
    {
      label: "Total certificates",
      value: data.counts.total,
      href: inventory,
      urgent: false,
    },
    {
      label: expiryFilters.expired.label,
      value: data.counts.expired,
      href: inventory + "?expiry=expired",
      urgent: data.counts.expired > 0,
    },
    {
      label: expiryFilters["7d"].label,
      value: data.counts.week,
      href: inventory + "?expiry=7d",
      urgent: false,
    },
    {
      label: expiryFilters["30d"].label,
      value: data.counts.month,
      href: inventory + "?expiry=30d",
      urgent: false,
    },
  ]);
  const reachability = $derived([
    { label: "Reachable", value: data.reachability.reachable },
    { label: "No reply", value: data.reachability.noReply },
    { label: "Unavailable", value: data.reachability.unavailable },
    { label: "Stale checks", value: data.reachability.stale },
    { label: "Not checked", value: data.reachability.unchecked },
  ]);
</script>

<svelte:head>
  <title>Overview | Certified by Pat</title>
</svelte:head>

<section
  class="grid gap-6 px-5 py-6 md:px-8"
  aria-labelledby="overview-heading"
>
  <h1 id="overview-heading" class="font-heading text-xl font-semibold">
    Overview
  </h1>

  <nav
    aria-label="Certificate health"
    class="grid grid-cols-2 gap-px border bg-border lg:grid-cols-4"
  >
    {#each counts as item (item.label)}
      <a
        href={item.href}
        class="grid gap-2 bg-background p-4 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span class="text-xs text-muted-foreground">{item.label}</span>
        <span
          class="text-2xl font-semibold tabular-nums"
          class:text-destructive={item.urgent}>{item.value}</span
        >
      </a>
    {/each}
  </nav>

  <section class="min-w-0 border" aria-labelledby="attention-heading">
    <div class="border-b px-4 py-3">
      <h2 id="attention-heading" class="text-sm font-medium">
        Needs attention
      </h2>
    </div>
    <Table.Root>
      <Table.Caption class="sr-only"
        >Expiring certificates and failed deployments</Table.Caption
      >
      <Table.Header class="bg-muted">
        <Table.Row>
          <Table.Head scope="col" class="px-4">Certificate</Table.Head>
          <Table.Head scope="col" class="px-4">Issue</Table.Head>
          <Table.Head scope="col" class="px-4">Expires</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.attention as item (item.id)}
          <Table.Row>
            <Table.Head scope="row" class="px-4">
              <a
                href={resolve("/certificates/[id]", { id: item.id })}
                class="text-primary underline underline-offset-4"
                >{item.domain}</a
              >
            </Table.Head>
            <Table.Cell class="px-4">
              <div class="flex flex-wrap gap-1.5">
                {#if item.expired}
                  <Badge variant="destructive">Expired</Badge>
                {:else if item.expiring}
                  <Badge variant="outline">Expiring</Badge>
                {/if}
                {#if item.failedDeployments}
                  <Badge variant="destructive"
                    >{item.failedDeployments} failed {item.failedDeployments ===
                    1
                      ? "deployment"
                      : "deployments"}</Badge
                  >
                {/if}
              </div>
            </Table.Cell>
            <Table.Cell class="px-4"
              ><time datetime={item.expiry.iso}>{item.expiry.label}</time
              ></Table.Cell
            >
          </Table.Row>
        {:else}
          <Table.Row>
            <Table.Cell
              colspan={3}
              class="px-4 py-6 text-center text-muted-foreground"
            >
              {data.counts.total
                ? "No expiry or deployment issues need attention."
                : "No certificates have been registered yet."}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </section>

  <div class="grid gap-6 xl:grid-cols-2">
    <section class="min-w-0 border" aria-labelledby="reachability-heading">
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"
      >
        <div class="grid gap-1">
          <h2 id="reachability-heading" class="text-sm font-medium">
            Host reachability
          </h2>
          <p class="text-xs text-muted-foreground">
            Ping results older than 24 hours are stale.
          </p>
        </div>
        <Button href={resolve("/hosts")} variant="outline" size="sm"
          >View hosts</Button
        >
      </div>
      <dl
        class="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-5 xl:grid-cols-3 2xl:grid-cols-5"
      >
        {#each reachability as item (item.label)}
          <div class="grid gap-1 bg-background p-3">
            <dt class="text-xs text-muted-foreground">{item.label}</dt>
            <dd class="text-lg font-semibold tabular-nums">{item.value}</dd>
          </div>
        {/each}
      </dl>
      {#if data.recentPings.length}
        <ul class="divide-y divide-border" aria-label="Latest ping checks">
          {#each data.recentPings as ping (ping.id)}
            <li
              class="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-xs"
            >
              <a
                href={resolve("/hosts/[id]", { id: ping.id })}
                class="font-medium text-primary underline underline-offset-4 wrap-anywhere"
                >{ping.name}</a
              >
              <div class="grid gap-1 sm:text-right">
                <span>{ping.stale ? "Stale · " : ""}{ping.status}</span>
                <time datetime={ping.checked.iso} class="text-muted-foreground"
                  >{ping.checked.label}</time
                >
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="px-4 py-5 text-xs text-muted-foreground">
          No hosts have been checked yet.
        </p>
      {/if}
    </section>

    <section class="min-w-0 border" aria-labelledby="open-alerts-heading">
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"
      >
        <h2 id="open-alerts-heading" class="text-sm font-medium">
          Open alerts
        </h2>
        <Button
          href={resolve("/alerts") + "?status=open"}
          variant="outline"
          size="sm">View open alerts</Button
        >
      </div>
      {#if data.openAlerts.length}
        <ul class="divide-y divide-border">
          {#each data.openAlerts as alert (alert.id)}
            <li class="grid gap-2 px-4 py-3 text-xs">
              <div class="flex flex-wrap items-center gap-2">
                <Badge
                  variant={alert.severity === "Critical" ||
                  alert.severity === "High"
                    ? "destructive"
                    : "outline"}>{alert.severity}</Badge
                >
                <span class="font-medium wrap-anywhere">{alert.message}</span>
              </div>
              <div
                class="flex flex-wrap justify-between gap-2 text-muted-foreground"
              >
                <span class="wrap-anywhere">{alert.target}</span>
                <time datetime={alert.detected.iso}>{alert.detected.label}</time
                >
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="px-4 py-5 text-xs text-muted-foreground">No open alerts.</p>
      {/if}
    </section>
  </div>
</section>
