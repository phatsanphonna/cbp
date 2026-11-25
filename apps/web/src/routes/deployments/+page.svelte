<script lang="ts">
  import { resolve } from "$app/paths";
  import { createColumnHelper, renderSnippet } from "@tanstack/svelte-table";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Spinner } from "#lib/components/ui/spinner/index.ts";
  import DataTable from "#lib/components/svelte/data-table.svelte";
  import type { DataTableFeatures } from "#lib/components/svelte/data-table-features.js";
  import { watchDeploymentUpdates } from "#lib/hooks/watch-deployment-updates.svelte.js";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
  type Run = PageProps["data"]["runs"][number];
  const column = createColumnHelper<DataTableFeatures, Run>();
  const columns = column.columns([
    column.accessor(({ slug, certificateName }) => `${slug} ${certificateName}`, {
      id: "deployment",
      header: "Job ID",
      filterFn: "includesString",
      cell: ({ row }) => renderSnippet(deploymentLink, row.original),
    }),
    column.accessor("certificateName", {
      header: "Certificate",
      cell: ({ row }) => renderSnippet(certificateLink, row.original),
    }),
    column.accessor(({ submittedLabel }) => submittedLabel ?? "—", {
      id: "submitted",
      header: "Submitted",
      cell: ({ row }) => renderSnippet(submitted, row.original),
    }),
    column.accessor(({ deployed, targets }) => `${deployed} of ${targets}`, {
      id: "hosts",
      header: "Hosts deployed",
      cell: ({ row }) => renderSnippet(hostCount, row.original),
    }),
    column.accessor(
      (run) => run.active
        ? "In progress"
        : !run.targets
          ? "Targets unavailable"
          : run.deployed === run.targets
            ? "Deployed"
            : "Needs attention",
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => renderSnippet(runStatus, row.original),
      },
    ),
  ]);

  watchDeploymentUpdates(() =>
    Math.min(...data.runs.map(({ nextExpiryIn }) => nextExpiryIn ?? Infinity)),
  );
</script>

<svelte:head>
  <title>Deployments | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="deployments-heading">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div class="grid gap-1">
        <h1 id="deployments-heading" class="font-heading text-xl font-semibold">
          Deployments
        </h1>
        <p class="text-xs text-muted-foreground">
          Review deployment activity and recovery status.
        </p>
      </div>
    </header>

    <div class="mt-6">
      <DataTable
        caption="Certificate deployment history"
        {columns}
        data={data.runs}
        rowKey={(run) => run.id}
        rowHeader="deployment"
        filter={{ column: "deployment", label: "Search deployments" }}
        emptyMessage={data.runs.length
          ? "No deployments match your search."
          : "No deployment runs have been recorded yet."}
        tableClass="min-w-[56rem]"
      />
    </div>

    {#if data.page > 1 || data.hasNext}
      <nav
        aria-label="Deployment pages"
        class="mt-4 flex items-center justify-end gap-2"
      >
        {#if data.page > 1}
          <Button
            href={`${resolve("/deployments")}?page=${data.page - 1}`}
            variant="outline"
            size="sm">Previous</Button
          >
        {/if}
        <span class="px-2 text-xs text-muted-foreground">Page {data.page}</span>
        {#if data.hasNext}
          <Button
            href={`${resolve("/deployments")}?page=${data.page + 1}`}
            variant="outline"
            size="sm">Next</Button
          >
        {/if}
      </nav>
    {/if}
</section>

{#snippet deploymentLink(run: Run)}
  <a
    href={resolve("/deployments/[id]", { id: run.slug })}
    class="font-medium text-primary underline underline-offset-4 wrap-anywhere"
  >{run.slug}</a>
{/snippet}

{#snippet certificateLink(run: Run)}
  {#if run.certificateId}
    <a
      href={resolve("/certificates/[id]", { id: run.certificateId })}
      class="text-primary underline underline-offset-4 wrap-anywhere"
    >{run.certificateName}</a>
  {:else}
    {run.certificateName} <span class="text-muted-foreground">(removed)</span>
  {/if}
{/snippet}

{#snippet submitted(run: Run)}
  {#if run.submittedAt}
    <time datetime={run.submittedAt}>{run.submittedLabel}</time>
  {:else}
    <span class="text-muted-foreground">—</span>
  {/if}
{/snippet}

{#snippet hostCount(run: Run)}
  <span class="tabular-nums">{run.deployed} of {run.targets}</span>
{/snippet}

{#snippet runStatus(run: Run)}
  {#if run.active}
    <Badge variant="outline"><Spinner data-icon="inline-start" aria-hidden="true" />In progress</Badge>
  {:else if !run.targets}
    <Badge variant="outline">Targets unavailable</Badge>
  {:else if run.deployed === run.targets}
    <Badge variant="secondary">Deployed</Badge>
  {:else}
    <Badge variant="destructive">Needs attention</Badge>
  {/if}
{/snippet}
