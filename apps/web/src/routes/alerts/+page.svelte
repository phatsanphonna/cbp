<script lang="ts">
  import type { PageProps } from "./$types";
  import { resolve } from "$app/paths";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { createColumnHelper, renderSnippet } from "@tanstack/svelte-table";
  import DataTable from "#lib/components/svelte/data-table.svelte";
  import type { DataTableFeatures } from "#lib/components/svelte/data-table-features.js";

  let { data }: PageProps = $props();
  const column = createColumnHelper<
    DataTableFeatures,
    PageProps["data"]["alerts"][number]
  >();
  const columns = column.columns([
    column.accessor("severity", {
      header: "Severity",
      cell: ({ getValue }) => renderSnippet(status, getValue()),
    }),
    column.accessor("message", { header: "Alert" }),
    column.accessor("target", {
      header: "Affected target",
      filterFn: "includesString",
    }),
    column.accessor("detected", { header: "Detected" }),
    column.accessor("status", { header: "Status" }),
  ]);
</script>

<svelte:head>
  <title>Alerts | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="alerts-heading">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="grid gap-1">
      <h1 id="alerts-heading" class="font-heading text-xl font-semibold">
        Alerts
      </h1>
      <p class="text-xs text-muted-foreground">
        Review certificate and host issues that need attention.
      </p>
    </div>
    <div class="flex items-center gap-3">
      <Button href={resolve("/alerts/channels")} variant="outline"
        >Notification channels</Button
      >
    </div>
  </header>

  {#if data.openOnly}
    <div class="mt-4 flex flex-wrap items-center gap-3 text-xs">
      <span class="font-medium">Open alerts</span>
      <Button href={resolve("/alerts")} variant="ghost" size="sm"
        >Show all alerts</Button
      >
    </div>
  {/if}

  <div class="mt-6">
    <DataTable
      caption="Certificate and host alerts"
      {columns}
      data={data.alerts}
      rowKey={(item) => item.id}
      rowHeader="message"
      filter={{ column: "target", label: "Filter by affected target" }}
      emptyMessage={data.alerts.length
        ? "No alerts match that target."
        : data.openOnly
          ? "No open alerts."
          : "No alerts have been recorded."}
      tableClass="min-w-[48rem]"
    />
  </div>
</section>

{#snippet status(value: string)}
  <span
    class="font-medium"
    class:text-destructive={value === "Critical" || value === "High"}
    >{value}</span
  >
{/snippet}
