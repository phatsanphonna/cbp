<script lang="ts">
  import type { PageProps } from "./$types";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import AlertSeverityBadge from "#lib/components/svelte/alert-severity-badge.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { createColumnHelper, renderSnippet } from "@tanstack/svelte-table";
  import DataTable from "#lib/components/svelte/data-table.svelte";
  import type { DataTableFeatures } from "#lib/components/svelte/data-table-features.js";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";

  let { data, form }: PageProps = $props();
  $effect(() => {
    const result = form;
    untrack(() => {
      if (result?.success) toast.success(result.success);
      else if (result?.message) toast.error(result.message);
    });
  });
  const column = createColumnHelper<
    DataTableFeatures,
    PageProps["data"]["alerts"][number]
  >();
  const columns = $derived(
    column.columns([
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
      ...(data.canManageAlerts
        ? [
            column.accessor("id", {
              header: "Actions",
              enableSorting: false,
              cell: ({ row }) => renderSnippet(clearButton, row.original),
            }),
          ]
        : []),
    ]),
  );
</script>

<svelte:head>
  <title>Alerts | CBP</title>
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

{#snippet status(value: PageProps["data"]["alerts"][number]["severity"])}
  <AlertSeverityBadge severity={value} />
{/snippet}

{#snippet clearButton(alert: PageProps["data"]["alerts"][number])}
  {#if alert.status === "Open"}
    <form method="POST" action="?/clear" use:enhance>
      <input type="hidden" name="id" value={alert.id} />
      <Button
        type="submit"
        variant="outline"
        size="xs"
        aria-label={`Clear alert for ${alert.target}`}>Clear</Button
      >
    </form>
  {/if}
{/snippet}
