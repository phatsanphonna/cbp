<script lang="ts">
  import { resolve } from "$app/paths";
  import DeploymentStatusBadge from "#lib/components/svelte/deployment-status-badge.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Table from "#lib/components/ui/table/index.ts";
  import {
    nextDeploymentExpiry,
    watchDeploymentUpdates,
  } from "#lib/hooks/watch-deployment-updates.svelte.js";
  import type { formatDeploymentTargets } from "./deployment-view.server.js";

  let {
    id,
    certificateName,
    jobs,
    submittedAt,
    submittedLabel,
    missing = 0,
  }: {
    id?: string;
    certificateName?: string;
    jobs: ReturnType<typeof formatDeploymentTargets>;
    submittedAt?: string;
    submittedLabel?: string;
    missing?: number;
  } = $props();
  const title = $derived(
    certificateName
      ? `Deployment status for ${certificateName}`
      : "Deployment status",
  );
  const queued = $derived(jobs.some(({ status }) => status === "Queued"));
  const active = $derived(
    queued || jobs.some(({ status }) => status === "Running"),
  );

  watchDeploymentUpdates(() => nextDeploymentExpiry(jobs));
</script>

<svelte:head>
  <title>{title} | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="deployments-heading">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="grid min-w-0 gap-1">
      <h1
        id="deployments-heading"
        class="font-heading text-xl font-semibold wrap-anywhere"
      >
        {title}
      </h1>
      {#if id}<p class="text-xs text-muted-foreground wrap-anywhere">
          Job ID <code>{id}</code>
        </p>{/if}
      {#if submittedAt}
        <p class="text-xs text-muted-foreground">
          Submitted <time datetime={submittedAt}>{submittedLabel}</time>
        </p>
      {:else if id}
        <p class="text-xs text-muted-foreground">Submission time unavailable</p>
      {/if}
      {#if active}<p class="text-xs text-muted-foreground">
          Updates automatically.
        </p>{/if}
    </div>
    <Button href={resolve("/deployments")} variant="outline" size="sm"
      >All deployments</Button
    >
  </header>

  {#if queued}
    <p class="mt-4 text-sm text-muted-foreground">
      Agents request jobs after check-in. If a job stays queued, check that <code
        >cbp-agent</code
      >
      is running and <code>deploymentServices</code> is configured in its YAML
      file.
      <a
        href={`${resolve("/docs/agent")}#deploy`}
        class="text-primary underline underline-offset-4">Agent setup</a
      >
    </p>
  {/if}
  {#if missing}
    <p class="mt-4 text-sm text-muted-foreground" role="status">
      {missing}
      {missing === 1 ? "target is" : "targets are"} no longer available.
    </p>
  {/if}

  <div class="mt-4 border">
    <Table.Root>
      <Table.Caption class="sr-only">Agent deployment jobs</Table.Caption>
      <Table.Header class="bg-muted">
        <Table.Row>
          <Table.Head scope="col">Endpoint</Table.Head>
          <Table.Head scope="col">Certificate</Table.Head>
          <Table.Head scope="col">Host</Table.Head>
          <Table.Head scope="col">Last agent check-in</Table.Head>
          <Table.Head scope="col">Status</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each jobs as job (job.id)}
          <Table.Row>
            <Table.Head
              scope="row"
              class="max-w-72 whitespace-normal wrap-anywhere"
            >
              {job.endpoint}
              <span class="block font-normal text-muted-foreground"
                >{job.engine}</span
              >
            </Table.Head>
            <Table.Cell class="max-w-60 whitespace-normal wrap-anywhere">
              <a
                href={resolve("/certificates/[id]", { id: job.certificateId })}
                class="text-primary underline underline-offset-4"
                >{job.certificateName}</a
              >
            </Table.Cell>
            <Table.Cell class="max-w-48 whitespace-normal wrap-anywhere">
              <a
                href={resolve("/hosts/[id]", { id: job.hostId })}
                class="text-primary underline underline-offset-4"
                >{job.hostName}</a
              >
            </Table.Cell>
            <Table.Cell>
              {#if job.agentSeenAt}
                <time datetime={job.agentSeenAt}>{job.agentSeenLabel}</time>
              {:else}
                <span class="text-muted-foreground">Never</span>
              {/if}
            </Table.Cell>
            <Table.Cell class="min-w-48 whitespace-normal">
              <div aria-live="polite">
                <DeploymentStatusBadge
                  status={job.status}
                  detail={job.detail}
                />
              </div>
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row
            ><Table.Cell
              colspan={5}
              class="py-8 text-center text-muted-foreground"
              >No deployment targets are available.</Table.Cell
            ></Table.Row
          >
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</section>
