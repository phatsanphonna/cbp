<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import CertificateChainFields from '#lib/components/svelte/certificate-chain-fields.svelte';
  import CertificateGroupField from '#lib/components/svelte/certificate-group-field.svelte';
  import EditDeploymentEndpointDialog from '#lib/components/svelte/edit-deployment-endpoint-dialog.svelte';
  import LinkDeploymentDialog from '#lib/components/svelte/link-deployment-dialog.svelte';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Dialog from '#lib/components/ui/dialog/index.ts';
  import { FieldGroup } from '#lib/components/ui/field/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  let updateOpen = $state(false);
  const certificate = $derived(data.certificate);
  const verified = $derived(certificate.deployments.filter(({ status }) => status === 'Verified').length);
</script>

<svelte:head>
  <title>{certificate.displayDomain} | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="certificate-heading">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="grid gap-2">
      <h1 id="certificate-heading" class="font-heading text-xl font-semibold break-all">{certificate.displayDomain}</h1>
      <div class="flex flex-wrap items-center gap-3">
        <Badge variant={certificate.status.startsWith('Valid') ? 'secondary' : 'destructive'}>{certificate.status}</Badge>
      </div>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button href={resolve('/certificates')} variant="outline">Back to certificates</Button>
      <Dialog.Root bind:open={updateOpen}>
        <Dialog.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline">Update fullchain</Button>
          {/snippet}
        </Dialog.Trigger>
        <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <Dialog.Header>
            <Dialog.Title>Update fullchain</Dialog.Title>
            <Dialog.Description>
              Replace the public certificate chain in CBP. Deploy the replacement separately to your servers.
            </Dialog.Description>
          </Dialog.Header>
          <form
            method="POST"
            action="?/updateChain"
            enctype="multipart/form-data"
            use:enhance={() => async ({ result, update }) => {
              await update();
              if (result.type === 'redirect') updateOpen = false;
            }}
          >
            <FieldGroup>
              <CertificateChainFields />
              {#if form?.message}
                <p role="alert" class="text-xs text-destructive">{form.message}</p>
              {/if}
              <Dialog.Footer>
                <Dialog.Close>
                  {#snippet child({ props })}
                    <Button {...props} type="button" variant="outline">Cancel</Button>
                  {/snippet}
                </Dialog.Close>
                <Button type="submit">Save replacement</Button>
              </Dialog.Footer>
            </FieldGroup>
          </form>
        </Dialog.Content>
      </Dialog.Root>
      <AlertDialog.Root>
        <AlertDialog.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="destructive">Remove certificate</Button>
          {/snippet}
        </AlertDialog.Trigger>
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>Remove certificate?</AlertDialog.Title>
            <AlertDialog.Description class="wrap-anywhere">
              Remove {certificate.domain} and its deployment records from CBP. You can register the certificate again later.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <form method="POST" action="?/remove">
            <AlertDialog.Footer>
              <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
              <AlertDialog.Action type="submit" variant="destructive">Remove certificate</AlertDialog.Action>
            </AlertDialog.Footer>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  </header>

  <section class="mt-6 border" aria-labelledby="metadata-heading">
    <h2 id="metadata-heading" class="border-b bg-muted px-4 py-3 text-sm font-medium">Certificate details</h2>
    <dl class="grid gap-4 px-4 py-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
      <div><dt class="text-muted-foreground">Issuer</dt><dd class="mt-1">{certificate.issuer}</dd></div>
      <div><dt class="text-muted-foreground">Responsible group</dt><dd class="mt-1 wrap-anywhere">{certificate.groupName ?? 'Unassigned'}</dd></div>
      <div class="min-w-0">
        <dt class="text-muted-foreground">Serial number</dt>
        <dd class="mt-1 break-all">{certificate.serial}</dd>
      </div>
      {#if certificate.fingerprint}
        <div class="min-w-0">
          <dt class="text-muted-foreground">SHA-256 fingerprint</dt>
          <dd class="mt-1 break-all">{certificate.fingerprint}</dd>
        </div>
      {/if}
      <div><dt class="text-muted-foreground">Valid from</dt><dd class="mt-1"><time datetime={certificate.validFrom}>{certificate.validFromLabel}</time></dd></div>
      <div><dt class="text-muted-foreground">Expires</dt><dd class="mt-1"><time datetime={certificate.validUntil}>{certificate.validUntilLabel}</time></dd></div>
      <div>
        <dt class="text-muted-foreground">Subject alternative names</dt>
        <dd class="mt-1">
          <ul class="grid gap-1 break-all">
            {#each certificate.sans as name (name)}
              <li>{name}</li>
            {/each}
          </ul>
        </dd>
      </div>
    </dl>
    <form method="POST" action="?/assignGroup" class="border-t p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div class="min-w-56 max-w-full">
          <CertificateGroupField groups={data.groups} selected={certificate.groupId} />
        </div>
        <Button type="submit" variant="outline">Save group</Button>
      </div>
      {#if form?.groupMessage}
        <p role="alert" class="mt-2 text-xs text-destructive">{form.groupMessage}</p>
      {/if}
    </form>
  </section>

  <section class="mt-6" aria-labelledby="deployments-heading">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div class="grid gap-1">
        <h2 id="deployments-heading" class="text-sm font-medium">Deployments</h2>
        <p class="text-xs text-muted-foreground">{verified} of {certificate.deployments.length} verified</p>
      </div>
      {#if data.hostOptions.length}
        <LinkDeploymentDialog target="host" options={data.hostOptions} message={form?.linkError} />
      {:else}
        <Button href={resolve('/hosts/new')} variant="outline" size="sm">Add a host</Button>
      {/if}
    </div>
    {#if form?.linkMessage || form?.endpointMessage}
      <p class="mb-3 text-xs" role="status">{form.linkMessage ?? form.endpointMessage}</p>
    {/if}
    <div class="border">
      <Table.Root>
        <Table.Caption class="sr-only">Certificate deployment endpoints</Table.Caption>
        <Table.Header class="bg-muted">
          <Table.Row>
            <Table.Head scope="col">Endpoint</Table.Head>
            <Table.Head scope="col">Host</Table.Head>
            <Table.Head scope="col">Method</Table.Head>
            <Table.Head scope="col">Verification</Table.Head>
            <Table.Head scope="col" class="text-right">Actions</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each certificate.deployments as deployment (deployment.id)}
            <Table.Row>
              <Table.Head scope="row">{deployment.endpoint}</Table.Head>
              <Table.Cell>
                {#if deployment.hostId && deployment.hostName}
                  <a href={resolve('/hosts/[id]', { id: deployment.hostId })} class="text-primary underline underline-offset-4">{deployment.hostName}</a>
                {:else}
                  <span class="text-muted-foreground">Unlinked</span>
                {/if}
              </Table.Cell>
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
            <Table.Row><Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">No deployments recorded for this certificate.</Table.Cell></Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  </section>

</section>
