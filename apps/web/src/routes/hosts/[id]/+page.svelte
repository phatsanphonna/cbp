<script lang="ts">
  import { Info } from "@lucide/svelte";
  import { resolve } from "$app/paths";
  import AgentEnrollment from "#lib/components/svelte/agent-enrollment.svelte";
  import DeploymentStatusBadge from "#lib/components/svelte/deployment-status-badge.svelte";
  import EditDeploymentEndpointDialog from "#lib/components/svelte/edit-deployment-endpoint-dialog.svelte";
  import LinkDeploymentDialog from "#lib/components/svelte/link-deployment-dialog.svelte";
  import * as AlertDialog from "#lib/components/ui/alert-dialog/index.ts";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Table from "#lib/components/ui/table/index.ts";
  import * as Tooltip from "#lib/components/ui/tooltip/index.ts";
  import { refreshHostPing } from "#lib/hooks/refresh-host-ping.js";
  import {
    nextDeploymentExpiry,
    watchDeploymentUpdates,
  } from "#lib/hooks/watch-deployment-updates.svelte.js";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();
  refreshHostPing();
  const host = $derived(data.host);
  const hostname = $derived(host.hostname || host.name);
  const hostTitle = $derived(
    host.ipAddress && host.ipAddress !== hostname
      ? `${hostname} (${host.ipAddress})`
      : hostname,
  );
  const facts = $derived([
    { label: "Discovered hostname", value: host.hostname },
    { label: "IP address", value: host.ipAddress },
    { label: "Operating system", value: host.operatingSystem },
    { label: "Architecture", value: host.architecture },
  ]);
  const listenerLabels = {
    ready: "TLS ready",
    unreachable: "Listener unreachable",
    "tls-error": "TLS handshake failed",
    "not-allowed": "Target not enabled",
  } as const;

  watchDeploymentUpdates(() =>
    nextDeploymentExpiry(Object.values(data.agentDeployments.statuses)),
  );
</script>

<svelte:head>
  <title>{hostTitle} | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="host-heading">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="grid min-w-0 gap-2">
      <h1
        id="host-heading"
        class="font-heading text-xl font-semibold wrap-anywhere"
      >
        {hostTitle}
      </h1>
      <div
        class="flex flex-wrap gap-2"
        role="group"
        aria-label="Management methods"
      >
        {#if host.agentManaged}<Badge variant="secondary">Agent</Badge>{/if}
        {#if host.ansibleManaged}<Badge variant="secondary">Ansible</Badge>{/if}
        {#if !host.agentManaged && !host.ansibleManaged}<Badge variant="outline"
            >Unmanaged</Badge
          >{/if}
      </div>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button href={resolve("/hosts")} variant="outline">Back to hosts</Button>
      <AlertDialog.Root>
        <AlertDialog.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="destructive">Remove host</Button>
          {/snippet}
        </AlertDialog.Trigger>
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>Remove host?</AlertDialog.Title>
            <AlertDialog.Description class="wrap-anywhere">
              Remove {host.name} from CBP. Its certificate deployments will stay in
              the certificate inventory without a linked host.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <form method="POST" action="?/remove">
            <AlertDialog.Footer>
              <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
              <AlertDialog.Action type="submit" variant="destructive"
                >Remove host</AlertDialog.Action
              >
            </AlertDialog.Footer>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  </header>

  <section class="mt-6 border" aria-labelledby="facts-heading">
    <h2
      id="facts-heading"
      class="border-b bg-muted px-4 py-3 text-sm font-medium"
    >
      Host information
    </h2>
    <dl class="grid gap-4 p-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
      {#each facts as fact (fact.label)}
        <div class="min-w-0">
          <dt class="text-muted-foreground">{fact.label}</dt>
          <dd class="mt-1 wrap-anywhere">{fact.value ?? "Not collected"}</dd>
        </div>
      {/each}
      <div>
        <dt class="text-muted-foreground">Network reachability</dt>
        <dd class="mt-1" aria-live="polite">
          <span class:text-destructive={host.lastPingStatus === "no-reply"}
            >{host.lastPingLabel}</span
          >
          {#if host.lastPingAt}
            · <time datetime={host.lastPingAt.iso}>{host.lastPingAt.label}</time
            >
          {/if}
        </dd>
      </div>
    </dl>
  </section>

  <section class="mt-6 border" aria-labelledby="management-heading">
    <h2
      id="management-heading"
      class="border-b bg-muted px-4 py-3 text-sm font-medium"
    >
      Management status
    </h2>
    <dl class="grid gap-4 p-4 text-xs sm:grid-cols-2">
      <div>
        <dt class="text-muted-foreground">Last agent check-in</dt>
        <dd class="mt-1">
          {@render timestamp(
            host.agentSeenAt,
            host.agentManaged ? "No check-in recorded" : "Agent not configured",
          )}
        </dd>
      </div>
      {#if host.agentManaged}
        <div>
          <dt class="text-muted-foreground">Allowed deployment services</dt>
          <dd class="mt-1 flex flex-wrap gap-1">
            {#if host.allowedDeploymentServices === null}
              <span>Not reported</span>
            {:else}
              {#each host.allowedDeploymentServices as service (service)}
                <Badge variant="secondary">{service}</Badge>
              {:else}
                <span>None enabled</span>
              {/each}
            {/if}
          </dd>
        </div>
      {/if}
      <div>
        <dt class="text-muted-foreground">Last Ansible run</dt>
        <dd class="mt-1">
          {@render timestamp(
            host.ansibleRunAt,
            host.ansibleManaged ? "No run recorded" : "Ansible not configured",
          )}
          {#if host.ansibleRunAt && host.ansibleSucceeded !== null}
            <span class:text-destructive={!host.ansibleSucceeded}>
              · {host.ansibleSucceeded ? "Succeeded" : "Failed"}</span
            >
          {/if}
        </dd>
      </div>
    </dl>
    {#key host.id}
      <AgentEnrollment
        hostId={host.id}
        agentManaged={host.agentManaged}
        {...data.enrollment}
        code={form?.enrollmentCode}
        command={form?.enrollmentCommand}
        error={form?.enrollmentError}
        message={form?.enrollmentMessage}
      />
    {/key}
  </section>

  <section class="mt-6" aria-labelledby="host-deployments-heading">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 id="host-deployments-heading" class="text-sm font-medium">
        Certificate deployments
      </h2>
      {#if data.certificateOptions.length}
        <LinkDeploymentDialog
          target="certificate"
          options={data.certificateOptions}
          message={form?.linkError}
        />
      {:else}
        <Button href={resolve("/certificates/new")} variant="outline" size="sm"
          >Register a certificate</Button
        >
      {/if}
    </div>
    {#if form?.linkMessage || form?.endpointMessage || form?.removeDeploymentMessage}
      <p class="mb-3 text-xs" role="status">
        {form.linkMessage ??
          form.endpointMessage ??
          form.removeDeploymentMessage}
      </p>
    {/if}
    <div class="border">
      <Table.Root>
        <Table.Caption class="sr-only"
          >Certificates deployed on this host</Table.Caption
        >
        <Table.Header class="bg-muted">
          <Table.Row>
            <Table.Head scope="col">Status</Table.Head>
            <Table.Head scope="col">Endpoint</Table.Head>
            <Table.Head scope="col">Certificate</Table.Head>
            <Table.Head scope="col">Web service</Table.Head>
            <Table.Head scope="col">Method</Table.Head>
            <Table.Head scope="col">Listener readiness</Table.Head>
            <Table.Head scope="col">Verification</Table.Head>
            <Table.Head scope="col" class="text-right">Actions</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each host.deployments as deployment (deployment.id)}
            {@const job = data.agentDeployments.statuses[deployment.id]}
            <Table.Row>
              <Table.Cell>
                <div role="status">
                  {#if job}
                    <DeploymentStatusBadge
                      status={job.status}
                      detail={job.detail}
                    />
                  {:else}
                    <span class="text-muted-foreground">—</span>
                  {/if}
                </div>
              </Table.Cell>
              <Table.Head scope="row">{deployment.endpoint}</Table.Head>
              <Table.Cell>
                <a
                  href={resolve("/certificates/[id]", {
                    id: deployment.certificateId,
                  })}
                  class="text-primary underline underline-offset-4"
                  >{deployment.domain}</a
                >
              </Table.Cell>
              <Table.Cell>{deployment.engine ?? "Not specified"}</Table.Cell>
              <Table.Cell>{deployment.method}</Table.Cell>
              <Table.Cell>
                {#if deployment.listenerStatus}
                  {#if deployment.listenerStatus === "ready"}
                    <Tooltip.Root>
                      <Tooltip.Trigger
                        class="inline-flex cursor-help focus-visible:outline-2 focus-visible:outline-ring"
                        aria-label="TLS ready. Show listener details"
                      >
                        <Badge variant="secondary">
                          {listenerLabels.ready}
                          <Info data-icon="inline-end" aria-hidden="true" />
                        </Badge>
                      </Tooltip.Trigger>
                      <Tooltip.Content sideOffset={4} class="max-w-xs">
                        {#if deployment.listenerAddress}<p class="font-mono">
                            {deployment.listenerAddress}
                          </p>{/if}
                        {#if deployment.listenerCheckedAt}
                          <time
                            class="block"
                            datetime={deployment.listenerCheckedAt.iso}
                            >{deployment.listenerCheckedAt.label}</time
                          >
                        {:else if !deployment.listenerAddress}
                          Listener details unavailable.
                        {/if}
                      </Tooltip.Content>
                    </Tooltip.Root>
                  {:else}
                    <Badge variant="outline"
                      >{listenerLabels[deployment.listenerStatus]}</Badge
                    >
                    {#if deployment.listenerAddress}
                      <p class="text-muted-foreground">
                        {deployment.listenerAddress}
                      </p>
                    {/if}
                    {#if deployment.listenerCheckedAt}
                      <time
                        class="text-muted-foreground"
                        datetime={deployment.listenerCheckedAt.iso}
                        >{deployment.listenerCheckedAt.label}</time
                      >
                    {/if}
                  {/if}
                {:else}
                  <span class="text-muted-foreground"
                    >{deployment.method === "Agent" && deployment.engine
                      ? "Not reported"
                      : "—"}</span
                  >
                {/if}
              </Table.Cell>
              <Table.Cell
                ><span class:text-destructive={deployment.status === "Failed"}
                  >{deployment.status}</span
                ></Table.Cell
              >
              <Table.Cell class="text-right">
                <EditDeploymentEndpointDialog
                  deploymentId={deployment.id}
                  endpoint={deployment.endpoint}
                  engine={deployment.engine}
                  method={deployment.method}
                  message={form?.deploymentId === deployment.id
                    ? form?.endpointError
                    : undefined}
                  removeMessage={form?.deploymentId === deployment.id
                    ? form.removeDeploymentError
                    : undefined}
                />
              </Table.Cell>
            </Table.Row>
          {:else}
            <Table.Row
              ><Table.Cell
                colspan={8}
                class="py-8 text-center text-muted-foreground"
                >No certificate deployments recorded for this host.</Table.Cell
              ></Table.Row
            >
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  </section>
</section>

{#snippet timestamp(
  value: { iso: string; label: string } | null,
  fallback: string,
)}
  {#if value}
    <time datetime={value.iso}>{value.label}</time>
  {:else}
    {fallback}
  {/if}
{/snippet}
