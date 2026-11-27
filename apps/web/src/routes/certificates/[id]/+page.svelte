<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { createColumnHelper, renderSnippet } from '@tanstack/svelte-table';
  import { toast } from 'svelte-sonner';
  import { notifyFormResult } from '#lib/components/svelte/form-feedback.js';
  import { resolve } from '$app/paths';
  import { ChevronDown } from '@lucide/svelte';
  import AssetOwners from '#lib/components/svelte/asset-owners.svelte';
  import CertificateChainFields from '#lib/components/svelte/certificate-chain-fields.svelte';
  import EditDeploymentEndpointDialog from '#lib/components/svelte/edit-deployment-endpoint-dialog.svelte';
  import DeploymentStatusBadge from '#lib/components/svelte/deployment-status-badge.svelte';
  import LinkDeploymentDialog from '#lib/components/svelte/link-deployment-dialog.svelte';
  import ServedCertificateExpiry from '#lib/components/svelte/served-certificate-expiry.svelte';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Dialog from '#lib/components/ui/dialog/index.ts';
  import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
  import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
  } from '#lib/components/ui/field/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import { Separator } from '#lib/components/ui/separator/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import DataTable from '#lib/components/svelte/data-table.svelte';
  import type { DataTableFeatures } from '#lib/components/svelte/data-table-features.js';
  import { deploymentServices } from '#lib/deployment-services.js';
  import {
    nextDeploymentExpiry,
    watchDeploymentUpdates,
  } from '#lib/hooks/watch-deployment-updates.svelte.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  type CertificateDeployment = PageProps['data']['certificate']['deployments'][number];
  const deploymentColumn = createColumnHelper<DataTableFeatures, CertificateDeployment>();
  const deploymentColumns = deploymentColumn.columns([
    deploymentColumn.accessor(({ id }) => data.agentDeployments.statuses[id]?.status ?? '—', {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => renderSnippet(deploymentJobStatus, row.original),
    }),
    deploymentColumn.accessor(
      ({ id, endpoint, hostId, hostName, engine, method, status }) =>
        [
          endpoint,
          hostId ? (hostLabels.get(hostId) ?? hostName ?? '') : '',
          engine ?? '',
          method,
          status,
          data.agentDeployments.statuses[id]?.status ?? '',
        ].join(' '),
      {
        id: 'endpoint',
        header: 'Endpoint',
        filterFn: 'includesString',
        cell: ({ row }) => renderSnippet(deploymentEndpoint, row.original),
      },
    ),
    deploymentColumn.accessor(
      ({ hostId, hostName }) =>
        hostId ? (hostLabels.get(hostId) ?? hostName ?? 'Unlinked') : 'Unlinked',
      {
        id: 'host',
        header: 'Host',
        cell: ({ row }) => renderSnippet(deploymentHost, row.original),
      },
    ),
    deploymentColumn.accessor(({ engine }) => engine ?? 'Not specified', {
      id: 'service',
      header: 'Web service',
    }),
    deploymentColumn.accessor('method', { header: 'Method' }),
    deploymentColumn.accessor('status', {
      id: 'verification',
      header: 'Verification',
      cell: ({ row }) => renderSnippet(deploymentVerification, row.original),
    }),
    deploymentColumn.accessor(
      ({ servedCertificateExpiresAt }) => servedCertificateExpiresAt?.label ?? 'Not reported',
      {
        id: 'expiry',
        header: 'Served certificate expiry',
        cell: ({ row }) => renderSnippet(deploymentExpiry, row.original),
      },
    ),
    deploymentColumn.display({
      id: 'actions',
      header: () => renderSnippet(deploymentActionsHeader),
      cell: ({ row }) => renderSnippet(deploymentActions, row.original),
    }),
  ]);
  let updateOpen = $state(false);
  let restoreOpen = $state(false);
  let restoreVersion = $state<PageProps['data']['certificate']['versions'][number] | null>(null);
  let removeOpen = $state(false);
  let deleteKeyOpen = $state(false);
  let deleteKeyPending = $state(false);
  let restorePending = $state(false);
  let renewalPending = $state(false);
  type RenewalResult = {
    privateKey?: string;
    warning?: string;
  };
  // Initial values only: a no-JS form post reopens the dialog; enhanced submits update it below.
  let manualRenewOpen = $state(untrack(() => Boolean(form?.renewalResult)));
  let renewalComplete = $state<RenewalResult | null>(untrack(() => form?.renewalResult ?? null));
  const certificate = $derived(data.certificate);
  // Renewing from the stored key requires credentials.manage on the server.
  const canUseStoredKey = $derived(certificate.hasRenewalKey && data.canManageCredentials);
  const hostLabels = $derived(new Map(data.hostOptions.map(({ id, label }) => [id, label])));
  const verified = $derived(
    certificate.deployments.filter(({ status }) => status === 'Verified').length,
  );
  const busyHosts = $derived(
    new Set(
      certificate.deployments
        .filter(({ id }) => {
          const status = data.agentDeployments.statuses[id]?.status;
          return status === 'Queued' || status === 'Running';
        })
        .map(({ hostId }) => hostId),
    ),
  );
  const ansibleTargets = $derived(
    certificate.deployments.flatMap(
      ({ id, hostId, hostName, endpoint, engine, method, ansibleManaged }) =>
        method === 'Ansible' &&
        ansibleManaged &&
        hostId &&
        hostName &&
        engine === 'Nginx' &&
        !busyHosts.has(hostId)
          ? [
              {
                id,
                hostId,
                hostLabel: hostLabels.get(hostId) ?? hostName,
                endpoint,
                engine,
              },
            ]
          : [],
    ),
  );
  const deploymentTargets = $derived(
    certificate.deployments.flatMap(
      ({ id, hostId, hostName, endpoint, engine, method, agentEnrolled }) =>
        method === 'Agent' &&
        hostId &&
        hostName &&
        agentEnrolled &&
        !busyHosts.has(hostId) &&
        engine &&
        deploymentServices.some((service) => service === engine)
          ? [
              {
                id,
                hostId,
                hostLabel: hostLabels.get(hostId) ?? hostName,
                endpoint,
                engine,
              },
            ]
          : [],
    ),
  );
  function focusCertificateActions(event: Event) {
    const trigger = document.getElementById('certificate-actions');
    if (!trigger) return;
    event.preventDefault();
    trigger.focus();
  }

  watchDeploymentUpdates(() => nextDeploymentExpiry(Object.values(data.agentDeployments.statuses)));
</script>

<svelte:head>
  <title>{certificate.displayDomain} | CBP</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="certificate-heading">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="grid gap-2">
      <h1 id="certificate-heading" class="font-heading text-xl font-semibold break-all">
        {certificate.displayDomain}
      </h1>
      <Badge variant={certificate.status.startsWith('Valid') ? 'secondary' : 'destructive'}>
        {certificate.status}
      </Badge>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button href={resolve('/certificates')} variant="outline">Back to certificates</Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button {...props} id="certificate-actions" variant="outline">
              Actions <ChevronDown data-icon="inline-end" aria-hidden="true" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          align="end"
          class="min-w-48"
          onCloseAutoFocus={(event) => {
            if (updateOpen || removeOpen || deleteKeyOpen) event.preventDefault();
          }}
        >
          <DropdownMenu.Group>
            <DropdownMenu.Item>
              {#snippet child({ props })}
                <a
                  {...props}
                  href={resolve('/alerts/channels') +
                    `?certificate=${encodeURIComponent(certificate.id)}`}
                >
                  Notification channels
                </a>
              {/snippet}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            {#if data.canDownloadPrivateKey || (data.canManageCredentials && data.savedCredentials.key)}
              {#if data.canDownloadPrivateKey}
                <DropdownMenu.Item>
                  {#snippet child({ props })}
                    <a
                      {...props}
                      data-sveltekit-preload-data="off"
                      href={resolve('/certificates/[id]/private-key', {
                        id: certificate.id,
                      })}
                    >
                      Download private key
                    </a>
                  {/snippet}
                </DropdownMenu.Item>
              {/if}
              {#if data.canManageCredentials && data.savedCredentials.key}
                <DropdownMenu.Item variant="destructive" onSelect={() => (deleteKeyOpen = true)}>
                  Remove key from Vault
                </DropdownMenu.Item>
              {/if}
              <DropdownMenu.Separator />
            {/if}
            {#if data.canManageCertificates}
              <DropdownMenu.Item onSelect={() => (updateOpen = true)}>
                Update fullchain
              </DropdownMenu.Item>
              <DropdownMenu.Item variant="destructive" onSelect={() => (removeOpen = true)}>
                Remove certificate
              </DropdownMenu.Item>
            {/if}
          </DropdownMenu.Group>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <AlertDialog.Root bind:open={deleteKeyOpen}>
        <AlertDialog.Content onCloseAutoFocus={focusCertificateActions}>
          <AlertDialog.Header>
            <AlertDialog.Title>Remove key from Vault?</AlertDialog.Title>
            <AlertDialog.Description class="wrap-anywhere">
              {#if certificate.hasRenewalKey}
                CBP will keep the key stored with this certificate. You can still download it or use
                it to deploy the certificate.
              {:else}
                After removing the key from Vault, you’ll need to supply it for future deployments.
                Download a copy first if you need one.
              {/if}
            </AlertDialog.Description>
          </AlertDialog.Header>
          <form
            method="POST"
            action="?/deleteCredential"
            use:enhance={() => {
              deleteKeyPending = true;
              return async ({ result, update }) => {
                try {
                  await update();
                  if (result.type === 'success') deleteKeyOpen = false;
                  notifyFormResult(result, {
                    success: 'credentialMessage',
                    error: 'credentialError',
                  });
                } finally {
                  deleteKeyPending = false;
                }
              };
            }}
          >
            <input type="hidden" name="kind" value="certificate" />
            <AlertDialog.Footer>
              <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
              <AlertDialog.Action type="submit" variant="destructive" disabled={deleteKeyPending}>
                Remove from Vault
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Root>
      <Dialog.Root bind:open={updateOpen}>
        <Dialog.Content
          class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
          onCloseAutoFocus={focusCertificateActions}
        >
          <Dialog.Header>
            <Dialog.Title>Update fullchain</Dialog.Title>
            <Dialog.Description>
              CBP keeps the last 3 versions and their private keys for rollback. Deploy the
              replacement separately to your servers.
            </Dialog.Description>
          </Dialog.Header>
          <form
            method="POST"
            action="?/updateChain"
            enctype="multipart/form-data"
            use:enhance={() =>
              async ({ result, update }) => {
                await update();
                if (result.type === 'redirect') {
                  updateOpen = false;
                  toast.success('Certificate chain updated.');
                } else notifyFormResult(result, {});
              }}
          >
            <FieldGroup>
              <CertificateChainFields />
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
      {#if restoreVersion}
        <AlertDialog.Root bind:open={restoreOpen}>
          <AlertDialog.Content>
            <AlertDialog.Header>
              <AlertDialog.Title class="wrap-anywhere">
                Restore certificate {restoreVersion.validUntilLabel
                  ? `expiring ${restoreVersion.validUntilLabel}`
                  : ''} (serial {restoreVersion.serial})?
              </AlertDialog.Title>
              <AlertDialog.Description>
                The current certificate (expiring {certificate.validUntilLabel}) moves to previous
                versions.
                {restoreVersion.hasKey
                  ? 'Its saved private key is restored too.'
                  : 'No private key is saved for this version, so supply it when deploying.'}
                Deploy afterwards to update your hosts.
              </AlertDialog.Description>
            </AlertDialog.Header>
            <form
              method="POST"
              action="?/restoreChain"
              use:enhance={() => {
                restorePending = true;
                return async ({ result, update }) => {
                  try {
                    await update();
                    if (result.type === 'success') restoreOpen = false;
                    notifyFormResult(result, { success: 'restoreMessage', error: 'restoreError' });
                  } finally {
                    restorePending = false;
                  }
                };
              }}
            >
              <input type="hidden" name="versionId" value={restoreVersion.id} />
              <AlertDialog.Footer>
                <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
                <Button type="submit" disabled={restorePending}>Restore this version</Button>
              </AlertDialog.Footer>
            </form>
          </AlertDialog.Content>
        </AlertDialog.Root>
      {/if}
      <AlertDialog.Root bind:open={removeOpen}>
        <AlertDialog.Content onCloseAutoFocus={focusCertificateActions}>
          <AlertDialog.Header>
            <AlertDialog.Title>Remove certificate?</AlertDialog.Title>
            <AlertDialog.Description class="wrap-anywhere">
              Remove {certificate.domain} and its deployment records from CBP. You can register the certificate
              again later.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <form
            method="POST"
            action="?/remove"
            use:enhance={() =>
              async ({ result, update }) => {
                await update();
                if (result.type === 'redirect') toast.success('Certificate removed.');
                else notifyFormResult(result, {});
              }}
          >
            <AlertDialog.Footer>
              <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
              <AlertDialog.Action type="submit" variant="destructive">
                Remove certificate
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  </header>

  <section class="mt-6 border" aria-labelledby="renewal-heading">
    <div class="grid gap-4 p-4 sm:p-5">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="grid gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="renewal-heading" class="text-sm font-medium">Renewal</h2>
            {#if certificate.renewal.provider}
              <Badge
                variant={certificate.autoRenew && certificate.renewal.canAutoRenew
                  ? 'secondary'
                  : 'outline'}
              >
                {certificate.autoRenew
                  ? certificate.renewal.available && certificate.renewal.canAutoRenew
                    ? 'Automatic renewal on'
                    : 'Renewal paused'
                  : 'Automatic renewal off'}
              </Badge>
            {/if}
          </div>
          <p class="text-xs text-muted-foreground">
            {certificate.renewal.provider
              ? `${certificate.renewal.provider} certificate`
              : 'This certificate issuer does not support renewal.'}
          </p>
        </div>
        {#if certificate.autoRenew && certificate.renewal.nextAttempt}
          <div class="grid gap-1 text-left text-xs sm:text-right">
            <span class="text-muted-foreground">Next automatic attempt</span>
            <time datetime={certificate.renewal.nextAttempt} class="font-medium">
              {certificate.renewal.nextAttemptLabel}
            </time>
          </div>
        {/if}
      </header>

      {#if certificate.renewal.provider}
        <div class="grid gap-2 text-xs">
          {#if certificate.renewal.error}
            <p class="max-w-2xl text-destructive" role="alert">
              {certificate.renewal.error}
            </p>
          {/if}
          {#if !certificate.renewal.eligible}
            <p class="max-w-2xl text-muted-foreground">
              {certificate.renewal.provider === 'Self-signed'
                ? 'This certificate is not a valid CBP self-signed certificate.'
                : 'This fullchain is not eligible for Let’s Encrypt renewal.'}
            </p>
          {:else if certificate.renewal.provider === 'Self-signed' && !certificate.renewal.canAutoRenew}
            <p class="max-w-2xl text-muted-foreground">
              Automatic renewal needs a private key saved during creation. You can still renew
              manually with its matching key.
            </p>
          {:else if !certificate.renewal.available}
            <p class="max-w-2xl text-muted-foreground">
              {certificate.renewal.provider === 'Self-signed'
                ? 'Set BETTER_AUTH_SECRET to at least 32 characters to enable renewal.'
                : 'Configure CBP_LETS_ENCRYPT_EMAIL to enable renewal.'}
            </p>
          {/if}
          <p class="max-w-2xl text-muted-foreground">
            Renewing marks linked deployments pending. Deploy the renewed certificate from this
            page.
          </p>
        </div>
      {/if}

      {#if data.canManageRenewals && certificate.renewal.provider && (certificate.renewal.eligible || certificate.autoRenew)}
        <Separator />
        <div
          class={certificate.renewal.eligible ? 'grid gap-5 sm:grid-cols-2 sm:gap-6' : 'grid gap-5'}
        >
          {#if certificate.renewal.eligible || certificate.autoRenew}
            <div class="grid content-start justify-items-start gap-2">
              <h3 class="text-xs font-medium">Automatic renewal</h3>
              <p class="max-w-sm text-xs text-muted-foreground">
                {certificate.autoRenew
                  ? 'CBP will renew this certificate before it expires.'
                  : 'Renew automatically before this certificate expires.'}
              </p>
              {#if certificate.autoRenew}
                <form
                  method="POST"
                  action="?/disableRenewal"
                  use:enhance={() => {
                    renewalPending = true;
                    return async ({ result, update }) => {
                      try {
                        await update();
                        if (result.type === 'redirect')
                          toast.success('Automatic renewal disabled.');
                        else notifyFormResult(result, { error: 'renewalError' });
                      } finally {
                        renewalPending = false;
                      }
                    };
                  }}
                >
                  <Button type="submit" variant="outline" size="sm" disabled={renewalPending}>
                    Disable automatic renewal
                  </Button>
                </form>
              {:else}
                <form
                  method="POST"
                  action="?/enableRenewal"
                  use:enhance={() => {
                    renewalPending = true;
                    return async ({ result, update }) => {
                      try {
                        await update();
                        if (result.type === 'redirect') toast.success('Automatic renewal enabled.');
                        else notifyFormResult(result, { error: 'renewalError' });
                      } finally {
                        renewalPending = false;
                      }
                    };
                  }}
                >
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    disabled={renewalPending ||
                      !certificate.renewal.canAutoRenew ||
                      !certificate.renewal.available}
                  >
                    Enable automatic renewal
                  </Button>
                </form>
              {/if}
              {#if data.canManageDeployments && data.canManageCredentials}
                <h3 class="mt-3 text-xs font-medium">Deploy after renewal</h3>
                <p class="max-w-sm text-xs text-muted-foreground">
                  {certificate.autoDeploy
                    ? 'Each renewal is queued to agent-managed endpoints, one per host. Ansible endpoints still need a manual deploy.'
                    : 'Queue renewed certificates to agent-managed endpoints automatically.'}
                </p>
                <form
                  method="POST"
                  action={certificate.autoDeploy ? '?/disableAutoDeploy' : '?/enableAutoDeploy'}
                  use:enhance={() => {
                    renewalPending = true;
                    return async ({ result, update }) => {
                      try {
                        await update();
                        if (result.type === 'redirect')
                          toast.success(
                            certificate.autoDeploy
                              ? 'Deploy after renewal enabled.'
                              : 'Deploy after renewal disabled.',
                          );
                        else notifyFormResult(result, { error: 'renewalError' });
                      } finally {
                        renewalPending = false;
                      }
                    };
                  }}
                >
                  <Button type="submit" variant="outline" size="sm" disabled={renewalPending}>
                    {certificate.autoDeploy
                      ? 'Disable deploy after renewal'
                      : 'Enable deploy after renewal'}
                  </Button>
                </form>
              {/if}
            </div>
          {/if}

          {#if certificate.renewal.eligible}
            <div class="grid content-start justify-items-start gap-2">
              <h3 class="text-xs font-medium">Manual renewal</h3>
              <p class="max-w-sm text-xs text-muted-foreground">
                {certificate.autoDeploy
                  ? 'Renew now and queue the new certificate to agent endpoints.'
                  : 'Renew now and review the new certificate before deploying it.'}
              </p>
              {#if renewalComplete?.privateKey}
                <Button
                  href={`data:application/x-pem-file;charset=utf-8,${encodeURIComponent(renewalComplete.privateKey)}`}
                  download={`${certificate.domain.replace(/^\*\./, 'wildcard.')}.key.pem`}
                  size="sm"
                >
                  Download rotated key
                </Button>
              {:else}
                <Button
                  type="button"
                  size="sm"
                  disabled={renewalPending || !certificate.renewal.available}
                  onclick={() => {
                    renewalComplete = null;
                    manualRenewOpen = true;
                  }}
                >
                  Renew now
                </Button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </section>

  {#if data.canManageRenewals && certificate.renewal.provider && certificate.renewal.eligible}
    <Dialog.Root bind:open={manualRenewOpen}>
      <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <Dialog.Header>
          <Dialog.Title>Renew certificate</Dialog.Title>
          <Dialog.Description>
            {certificate.renewal.provider === 'Self-signed'
              ? 'Renewal creates a new private key. Download it after the certificate is renewed.'
              : 'CBP will issue a new certificate and keep its private key encrypted for deployment.'}
          </Dialog.Description>
        </Dialog.Header>
        {#if renewalComplete}
          <div class="grid gap-3" role="status">
            {#if renewalComplete.privateKey}
              <p class="text-xs text-muted-foreground">
                The certificate and private key were rotated. Download the new key now.
              </p>
              <Button
                href={`data:application/x-pem-file;charset=utf-8,${encodeURIComponent(renewalComplete.privateKey)}`}
                download={`${certificate.domain.replace(/^\*\./, 'wildcard.')}.key.pem`}
                class="w-fit"
              >
                Download rotated private key
              </Button>
            {:else}
              <p class="text-xs text-muted-foreground">
                Certificate renewed. Its private key is stored encrypted for deployment.
              </p>
            {/if}
            {#if renewalComplete.warning}
              <p class="text-xs text-destructive" role="alert">
                {renewalComplete.warning}
              </p>
            {/if}
            <Dialog.Footer>
              <Dialog.Close>
                {#snippet child({ props })}
                  <Button {...props} type="button" variant="outline">Done</Button>
                {/snippet}
              </Dialog.Close>
            </Dialog.Footer>
          </div>
        {:else}
          <form
            class="grid gap-5"
            method="POST"
            action="?/renewNow"
            enctype="multipart/form-data"
            use:enhance={() => {
              renewalPending = true;
              return async ({ result, update }) => {
                try {
                  await update();
                  if (result.type === 'success') {
                    const outcome = result.data as {
                      renewalResult?: { privateKey?: string; warning?: string };
                    };
                    renewalComplete = outcome.renewalResult ?? {};
                    toast.success(
                      'Certificate renewed. Deploy the updated certificate to linked hosts.',
                    );
                  } else {
                    notifyFormResult(result, { error: 'renewalError' });
                  }
                } finally {
                  renewalPending = false;
                }
              };
            }}
          >
            {#if certificate.renewal.provider === 'Self-signed'}
              <FieldGroup class="gap-3">
                <Field>
                  <FieldLabel for="renewal-private-key" required={!canUseStoredKey}>
                    Matching private key
                  </FieldLabel>
                  <Input
                    id="renewal-private-key"
                    type="file"
                    name="privateKey"
                    accept=".pem,.key"
                    required={!canUseStoredKey}
                  />
                  <FieldDescription>
                    {canUseStoredKey
                      ? 'The stored key is used by default. Upload its matching key only if the stored copy cannot be read.'
                      : 'Upload the key matching the current certificate. The renewed certificate will use a new key.'}
                  </FieldDescription>
                </Field>
              </FieldGroup>
            {/if}
            <Dialog.Footer>
              <Dialog.Close>
                {#snippet child({ props })}
                  <Button {...props} type="button" variant="outline" disabled={renewalPending}>
                    Cancel
                  </Button>
                {/snippet}
              </Dialog.Close>
              <Button type="submit" disabled={renewalPending || !certificate.renewal.available}>
                {renewalPending ? 'Renewing…' : 'Renew certificate'}
              </Button>
            </Dialog.Footer>
          </form>
        {/if}
      </Dialog.Content>
    </Dialog.Root>
  {/if}

  <section class="mt-6 border" aria-labelledby="owners-heading">
    <h2 id="owners-heading" class="border-b bg-muted px-4 py-3 text-sm font-medium">Owners</h2>
    <div class="p-4">
      <AssetOwners id="certificate-owners" owners={data.owners} options={data.ownerOptions} />
    </div>
  </section>

  <section class="mt-6 border" aria-labelledby="metadata-heading">
    <h2 id="metadata-heading" class="border-b bg-muted px-4 py-3 text-sm font-medium">
      Certificate details
    </h2>
    <dl class="grid gap-4 px-4 py-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <dt class="text-muted-foreground">Issuer</dt>
        <dd class="mt-1">{certificate.issuer}</dd>
      </div>
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
      <div>
        <dt class="text-muted-foreground">Valid from</dt>
        <dd class="mt-1">
          <time datetime={certificate.validFrom}>{certificate.validFromLabel}</time>
        </dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Expires</dt>
        <dd class="mt-1">
          <time datetime={certificate.validUntil}>{certificate.validUntilLabel}</time>
        </dd>
      </div>
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
  </section>

  {#if certificate.versions.length}
    <section class="mt-6 border" aria-labelledby="versions-heading">
      <div class="border-b bg-muted px-4 py-3">
        <h2 id="versions-heading" class="text-sm font-medium">Previous versions</h2>
        <p class="text-xs text-muted-foreground">CBP keeps the last 3 replaced certificates.</p>
      </div>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Replaced</Table.Head>
            <Table.Head>Serial number</Table.Head>
            <Table.Head>Expires</Table.Head>
            <Table.Head>SHA-256 fingerprint</Table.Head>
            <Table.Head>Private key</Table.Head>
            {#if data.canManageCertificates}
              <Table.Head><span class="sr-only">Actions</span></Table.Head>
            {/if}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each certificate.versions as version (version.id)}
            <Table.Row>
              <Table.Cell>{version.replacedAtLabel}</Table.Cell>
              <Table.Cell class="break-all whitespace-normal">{version.serial}</Table.Cell>
              <Table.Cell>{version.validUntilLabel ?? '—'}</Table.Cell>
              <Table.Cell>
                {#if version.fingerprint}
                  <span title={version.fingerprint}>{version.fingerprint.slice(0, 23)}…</span>
                {:else}
                  —
                {/if}
              </Table.Cell>
              <Table.Cell>
                <Badge variant={version.hasKey ? 'secondary' : 'outline'}>
                  {version.hasKey ? 'Saved' : 'Not saved'}
                </Badge>
              </Table.Cell>
              {#if data.canManageCertificates}
                <Table.Cell class="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!version.validUntilLabel}
                    onclick={() => {
                      restoreVersion = version;
                      restoreOpen = true;
                    }}
                  >
                    Restore
                  </Button>
                </Table.Cell>
              {/if}
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </section>
  {/if}

  <section class="mt-6" aria-labelledby="deployments-heading">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div class="grid gap-1">
        <h2 id="deployments-heading" class="text-sm font-medium">Deployments</h2>
        <p class="text-xs text-muted-foreground">
          {verified} of {certificate.deployments.length} verified
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        {#if data.canManageDeployments && (deploymentTargets.length || ansibleTargets.length)}
          <Button
            href={resolve('/certificates/[id]/deploy', { id: certificate.id })}
            variant="outline"
            size="sm"
          >
            Deploy
          </Button>
        {/if}
        {#if data.canManageDeployments && data.hostOptions.length}
          <LinkDeploymentDialog
            target="host"
            options={data.hostOptions}
            message={form?.linkError}
          />
        {/if}
        {#if !data.hostOptions.length && data.canManageHosts}
          <Button href={resolve('/hosts/new')} variant="outline" size="sm">Add a host</Button>
        {/if}
      </div>
    </div>
    {#if data.canManageCredentials && data.savedCredentials.ansible}
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <span class="text-xs text-muted-foreground">Saved Ansible credentials:</span>
        <form
          method="POST"
          action="?/deleteCredential"
          use:enhance={() =>
            async ({ result, update }) => {
              await update();
              notifyFormResult(result, { success: 'credentialMessage', error: 'credentialError' });
            }}
        >
          <input type="hidden" name="kind" value="ansible" />
          <Button type="submit" variant="outline" size="sm">
            Delete saved Ansible credentials
          </Button>
        </form>
      </div>
    {/if}
    {#if data.savedCredentials.error}
      <p class="mb-3 text-xs text-destructive" role="alert">
        Could not load saved credentials from Vault.
      </p>
    {/if}
    {#if data.agentDeployments.httpsRequired && (deploymentTargets.length || ansibleTargets.length)}
      <p class="mb-3 text-xs text-muted-foreground">
        Private-key uploads require a trusted HTTPS connection.
      </p>
    {/if}
    {#if data.canManageCredentials && ansibleTargets.length && !data.agentDeployments.ansibleEnabled}
      <p class="mb-3 text-xs text-muted-foreground">
        Configure the Ansible runner token to enable Ansible deployments.
      </p>
    {/if}
    <div class="mt-3">
      <DataTable
        caption="Certificate deployment endpoints"
        columns={deploymentColumns}
        data={certificate.deployments}
        rowKey={(deployment) => deployment.id}
        rowHeader="endpoint"
        filter={{ column: 'endpoint', label: 'Search deployments' }}
        emptyMessage={certificate.deployments.length
          ? 'No deployments match your search.'
          : 'No deployments recorded for this certificate.'}
        tableClass="min-w-[68rem]"
      />
    </div>
  </section>
</section>

{#snippet deploymentEndpoint(deployment: CertificateDeployment)}
  {deployment.endpoint}
{/snippet}

{#snippet deploymentJobStatus(deployment: CertificateDeployment)}
  {@const job = data.agentDeployments.statuses[deployment.id]}
  <div aria-live="polite">
    {#if job}
      <DeploymentStatusBadge
        status={job.status}
        detail={job.detail}
        href={resolve('/deployments/[id]', { id: job.runSlug })}
        linkLabel={`View deployment ${job.runSlug}`}
      />
    {:else}
      <span class="text-muted-foreground">—</span>
    {/if}
  </div>
{/snippet}

{#snippet deploymentHost(deployment: CertificateDeployment)}
  {#if deployment.hostId && deployment.hostName}
    <a
      href={resolve('/hosts/[id]', { id: deployment.hostId })}
      class="text-primary underline underline-offset-4"
    >
      {hostLabels.get(deployment.hostId) ?? deployment.hostName}
    </a>
  {:else}
    <span class="text-muted-foreground">Unlinked</span>
  {/if}
{/snippet}

{#snippet deploymentVerification(deployment: CertificateDeployment)}
  <Badge
    variant={deployment.status === 'Failed'
      ? 'destructive'
      : deployment.status === 'Verified'
        ? 'secondary'
        : 'outline'}
  >
    {deployment.status}
  </Badge>
{/snippet}

{#snippet deploymentExpiry(deployment: CertificateDeployment)}
  <ServedCertificateExpiry
    expiry={deployment.servedCertificateExpiresAt}
    observedAt={deployment.servedCertificateObservedAt}
  />
{/snippet}

{#snippet deploymentActionsHeader()}
  <span class="block text-right">Actions</span>
{/snippet}

{#snippet deploymentActions(deployment: CertificateDeployment)}
  <div class="flex justify-end">
    {#if data.canManageDeployments}
      <EditDeploymentEndpointDialog
        deploymentId={deployment.id}
        endpoint={deployment.endpoint}
        engine={deployment.engine}
        method={deployment.method}
        message={form?.deploymentId === deployment.id ? form?.endpointError : undefined}
        removeMessage={form?.deploymentId === deployment.id
          ? form.removeDeploymentError
          : undefined}
      />
    {/if}
  </div>
{/snippet}
