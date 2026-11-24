<script lang="ts">
  import { resolve } from "$app/paths";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Spinner } from "#lib/components/ui/spinner/index.ts";
  import * as Table from "#lib/components/ui/table/index.ts";
  import { watchDeploymentUpdates } from "#lib/hooks/watch-deployment-updates.svelte.js";
  import DeploymentJobDetails from "./deployment-job-details.svelte";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  watchDeploymentUpdates(() =>
    data.legacy
      ? null
      : Math.min(
          ...data.runs.map(({ nextExpiryIn }) => nextExpiryIn ?? Infinity),
        ),
  );
</script>

<svelte:head>
  {#if !data.legacy}<title>Deployments | Certified by Pat</title>{/if}
</svelte:head>

{#if data.legacy}
  <DeploymentJobDetails {...data.legacy} />
{:else}
  <section class="px-5 py-6 md:px-8" aria-labelledby="deployments-heading">
    <h1 id="deployments-heading" class="font-heading text-xl font-semibold">
      Deployments
    </h1>
    <div class="mt-4 border">
      <Table.Root>
        <Table.Caption class="sr-only"
          >Certificate deployment jobs</Table.Caption
        >
        <Table.Header class="bg-muted">
          <Table.Row>
            <Table.Head scope="col">Job ID</Table.Head>
            <Table.Head scope="col">Certificate</Table.Head>
            <Table.Head scope="col">Submitted</Table.Head>
            <Table.Head scope="col">Hosts deployed</Table.Head>
            <Table.Head scope="col">Status</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each data.runs as run (run.id)}
            <Table.Row>
              <Table.Head scope="row">
                <a
                  href={resolve("/deployments/[id]", { id: run.slug })}
                  class="text-primary underline underline-offset-4"
                  >{run.slug}</a
                >
              </Table.Head>
              <Table.Cell class="max-w-60 whitespace-normal wrap-anywhere">
                {#if run.certificateId}
                  <a href={resolve("/certificates/[id]", { id: run.certificateId })}
                    class="text-primary underline underline-offset-4">{run.certificateName}</a>
                {:else}
                  {run.certificateName} <span class="text-muted-foreground">(removed)</span>
                {/if}
              </Table.Cell>
              <Table.Cell>
                {#if run.submittedAt}<time datetime={run.submittedAt}
                    >{run.submittedLabel}</time
                  >{:else}—{/if}
              </Table.Cell>
              <Table.Cell>{run.deployed} of {run.targets}</Table.Cell>
              <Table.Cell>
                {#if run.active}
                  <Badge variant="outline"
                    ><Spinner data-icon="inline-start" aria-hidden="true" />In
                    progress</Badge
                  >
                {:else if !run.targets}
                  <Badge variant="outline">Targets unavailable</Badge>
                {:else if run.deployed === run.targets}
                  <Badge variant="secondary">Deployed</Badge>
                {:else}
                  <Badge variant="destructive">Needs attention</Badge>
                {/if}
              </Table.Cell>
            </Table.Row>
          {:else}
            <Table.Row
              ><Table.Cell
                colspan={5}
                class="py-8 text-center text-muted-foreground"
                >No deployment jobs on this page.</Table.Cell
              ></Table.Row
            >
          {/each}
        </Table.Body>
      </Table.Root>
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
{/if}
