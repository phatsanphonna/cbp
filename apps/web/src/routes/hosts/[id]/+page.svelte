<script lang="ts">
  import { enhance } from '$app/forms';
  import { asset, resolve } from '$app/paths';
  import AgentEnrollment from '#lib/components/svelte/agent-enrollment.svelte';
  import EditDeploymentEndpointDialog from '#lib/components/svelte/edit-deployment-endpoint-dialog.svelte';
  import LinkDeploymentDialog from '#lib/components/svelte/link-deployment-dialog.svelte';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Dialog from '#lib/components/ui/dialog/index.ts';
  import { Field, FieldLabel } from '#lib/components/ui/field/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  let pingPending = $state(false);
  let importOpen = $state(false);
  const host = $derived(data.host);
  const facts = $derived([
    { label: 'Discovered hostname', value: host.hostname },
    { label: 'IP address', value: host.ipAddress },
    { label: 'Operating system', value: host.operatingSystem },
    { label: 'Architecture', value: host.architecture }
  ]);
</script>

<svelte:head>
  <title>{host.name} | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="host-heading">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="grid min-w-0 gap-2">
      <h1 id="host-heading" class="font-heading text-xl font-semibold wrap-anywhere">{host.name}</h1>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Management methods">
        {#if host.agentManaged}<Badge variant="secondary">Agent</Badge>{/if}
        {#if host.ansibleManaged}<Badge variant="secondary">Ansible</Badge>{/if}
        {#if !host.agentManaged && !host.ansibleManaged}<Badge variant="outline">Unmanaged</Badge>{/if}
      </div>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button href={resolve('/hosts')} variant="outline">Back to hosts</Button>
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
              Remove {host.name} from CBP. Its certificate deployments will stay in the certificate inventory without a linked host.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <form method="POST" action="?/remove">
            <AlertDialog.Footer>
              <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
              <AlertDialog.Action type="submit" variant="destructive">Remove host</AlertDialog.Action>
            </AlertDialog.Footer>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  </header>

  <section class="mt-6 border" aria-labelledby="facts-heading">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b bg-muted px-4 py-3">
      <h2 id="facts-heading" class="text-sm font-medium">Host information</h2>
      <Dialog.Root bind:open={importOpen}>
        <Dialog.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline">Import host report</Button>
          {/snippet}
        </Dialog.Trigger>
        <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <Dialog.Header>
            <Dialog.Title>Import host report</Dialog.Title>
            <Dialog.Description>Run the collector on {host.name} and paste its JSON output.</Dialog.Description>
          </Dialog.Header>
          <div class="flex flex-wrap items-center gap-3 text-xs">
            <a href={asset('/tools/probe-host.py')} download class="text-primary underline underline-offset-4">Download collector</a>
            <code class="bg-muted px-2 py-1">python3 probe-host.py</code>
          </div>
          <form method="POST" action="?/importReport" class="grid gap-3" use:enhance={() => async ({ result, update }) => {
            await update();
            if (result.type === 'success') importOpen = false;
          }}>
            <Field>
              <FieldLabel for="host-report">Host report JSON</FieldLabel>
              <textarea id="host-report" name="report" class="min-h-36 w-full resize-y border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring" required maxlength={24576} spellcheck="false"></textarea>
            </Field>
            {#if form?.importError}
              <p class="text-xs text-destructive" role="alert">{form.importError}</p>
            {/if}
            <Dialog.Footer>
              <Dialog.Close>
                {#snippet child({ props })}
                  <Button {...props} type="button" variant="outline">Cancel</Button>
                {/snippet}
              </Dialog.Close>
              <Button type="submit">Import report</Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Root>
    </div>
    {#if form?.importMessage}
      <p class="px-4 pt-4 text-xs" role="status">{form.importMessage}</p>
    {/if}
    <dl class="grid gap-4 p-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
      {#each facts as fact (fact.label)}
        <div class="min-w-0">
          <dt class="text-muted-foreground">{fact.label}</dt>
          <dd class="mt-1 wrap-anywhere">{fact.value ?? 'Not collected'}</dd>
        </div>
      {/each}
      <div>
        <dt class="text-muted-foreground">Last successful probe</dt>
        <dd class="mt-1">{@render timestamp(host.lastProbedAt, 'No probe recorded')}</dd>
      </div>
    </dl>
    {#if host.httpsListeners !== null}
      <div class="border-t p-4 text-xs">
        <h3 class="font-medium">HTTPS listeners on port 443</h3>
        {#if host.httpsListeners}
          <pre class="mt-2 overflow-x-auto text-muted-foreground">{host.httpsListeners}</pre>
        {:else}
          <p class="mt-2 text-muted-foreground">No TCP listeners were reported on port 443.</p>
        {/if}
      </div>
    {/if}
  </section>

  <section class="mt-6 border" aria-labelledby="reachability-heading">
    <div class="flex flex-wrap items-center justify-between gap-3 p-4">
      <div class="grid gap-1">
        <h2 id="reachability-heading" class="text-sm font-medium">Network reachability</h2>
        <p class="text-xs text-muted-foreground">Send one ICMP ping from the CBP server to {host.name}.</p>
      </div>
      <form method="POST" action="?/ping" use:enhance={() => {
        pingPending = true;
        return async ({ update }) => {
          try {
            await update();
          } finally {
            pingPending = false;
          }
        };
      }}>
        <Button type="submit" variant="outline" disabled={pingPending}>{pingPending ? 'Pinging…' : 'Ping host'}</Button>
      </form>
    </div>
    <div class="grid gap-1 border-t p-4 text-xs" role="status">
      <p>
        <span class="font-medium">{host.lastPingLabel}</span>
        {#if host.lastPingAt}
          <span class="text-muted-foreground"> · <time datetime={host.lastPingAt.iso}>{host.lastPingAt.label}</time></span>
        {/if}
        {#if host.lastPingAddress}
          <span class="text-muted-foreground"> · {host.lastPingAddress}</span>
        {/if}
      </p>
      {#if form?.ping}
        <p class="text-muted-foreground">{form.ping.message}</p>
      {/if}
    </div>
  </section>

  <section class="mt-6 border" aria-labelledby="management-heading">
    <h2 id="management-heading" class="border-b bg-muted px-4 py-3 text-sm font-medium">Management status</h2>
    <dl class="grid gap-4 p-4 text-xs sm:grid-cols-2">
      <div>
        <dt class="text-muted-foreground">Last agent check-in</dt>
        <dd class="mt-1">{@render timestamp(host.agentSeenAt, host.agentManaged ? 'No check-in recorded' : 'Agent not configured')}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Last Ansible run</dt>
        <dd class="mt-1">
          {@render timestamp(host.ansibleRunAt, host.ansibleManaged ? 'No run recorded' : 'Ansible not configured')}
          {#if host.ansibleRunAt && host.ansibleSucceeded !== null}
            <span class:text-destructive={!host.ansibleSucceeded}> · {host.ansibleSucceeded ? 'Succeeded' : 'Failed'}</span>
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
      <h2 id="host-deployments-heading" class="text-sm font-medium">Certificate deployments</h2>
      {#if data.certificateOptions.length}
        <LinkDeploymentDialog target="certificate" options={data.certificateOptions} message={form?.linkError} />
      {:else}
        <Button href={resolve('/certificates/new')} variant="outline" size="sm">Register a certificate</Button>
      {/if}
    </div>
    {#if form?.linkMessage || form?.endpointMessage}
      <p class="mb-3 text-xs" role="status">{form.linkMessage ?? form.endpointMessage}</p>
    {/if}
    <div class="border">
      <Table.Root>
        <Table.Caption class="sr-only">Certificates deployed on this host</Table.Caption>
        <Table.Header class="bg-muted">
          <Table.Row>
            <Table.Head scope="col">Endpoint</Table.Head>
            <Table.Head scope="col">Certificate</Table.Head>
            <Table.Head scope="col">Server engine</Table.Head>
            <Table.Head scope="col">Method</Table.Head>
            <Table.Head scope="col">Verification</Table.Head>
            <Table.Head scope="col" class="text-right">Actions</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each host.deployments as deployment (deployment.id)}
            <Table.Row>
              <Table.Head scope="row">{deployment.endpoint}</Table.Head>
              <Table.Cell>
                <a href={resolve('/certificates/[id]', { id: deployment.certificateId })} class="text-primary underline underline-offset-4">{deployment.domain}</a>
              </Table.Cell>
              <Table.Cell>{deployment.engine ?? 'Not collected'}</Table.Cell>
              <Table.Cell>{deployment.method}</Table.Cell>
              <Table.Cell><span class:text-destructive={deployment.status === 'Failed'}>{deployment.status}</span></Table.Cell>
              <Table.Cell class="text-right">
                <EditDeploymentEndpointDialog
                  deploymentId={deployment.id}
                  endpoint={deployment.endpoint}
                  message={form?.deploymentId === deployment.id ? form?.endpointError : undefined}
                />
              </Table.Cell>
            </Table.Row>
          {:else}
            <Table.Row><Table.Cell colspan={6} class="py-8 text-center text-muted-foreground">No certificate deployments recorded for this host.</Table.Cell></Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  </section>
</section>

{#snippet timestamp(value: { iso: string; label: string } | null, fallback: string)}
  {#if value}
    <time datetime={value.iso}>{value.label}</time>
  {:else}
    {fallback}
  {/if}
{/snippet}
