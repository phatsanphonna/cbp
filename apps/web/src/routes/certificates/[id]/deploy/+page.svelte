<script lang="ts">
  import { resolve } from '$app/paths';
  import { Button } from '#lib/components/ui/button/index.ts';
  import DeployCertificateForm from '#lib/components/svelte/deploy-certificate-form.svelte';
  import { deploymentServices } from '#lib/deployment-services.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const certificate = $derived(data.certificate);
  const hostLabels = $derived(new Map(data.hostOptions.map(({ id, label }) => [id, label])));
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
  const agentTargets = $derived(
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
  const canDeployAnsible = $derived(
    data.agentDeployments.ansibleEnabled && !data.agentDeployments.httpsRequired,
  );
</script>

<svelte:head>
  <title>Deploy {certificate.displayDomain} | CBP</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="deploy-heading">
  <div class="mx-auto grid w-full gap-6">
    <header class="grid gap-3">
      <Button
        href={resolve('/certificates/[id]', { id: certificate.id })}
        variant="ghost"
        size="sm"
        class="w-fit px-0"
      >
        Back to certificate
      </Button>
      <div class="grid gap-1">
        <h1 id="deploy-heading" class="font-heading text-xl font-semibold">Deploy certificate</h1>
        <p class="text-sm text-muted-foreground">
          Choose linked endpoints and credentials for {certificate.displayDomain}.
        </p>
      </div>
    </header>

    {#if data.savedCredentials.error}
      <p
        class="border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        role="alert"
      >
        Could not load saved credentials from Vault.
      </p>
    {/if}
    {#if data.agentDeployments.httpsRequired && (agentTargets.length || ansibleTargets.length)}
      <p class="border px-3 py-2 text-xs text-muted-foreground">
        Private-key uploads require a trusted HTTPS connection.
      </p>
    {/if}
    {#if ansibleTargets.length && !data.agentDeployments.ansibleEnabled}
      <p class="border px-3 py-2 text-xs text-muted-foreground">
        Configure the Ansible runner token to enable Ansible deployments.
      </p>
    {/if}

    <DeployCertificateForm
      certificateId={certificate.id}
      {agentTargets}
      {ansibleTargets}
      canDeployAgent={!data.agentDeployments.blocked}
      {canDeployAnsible}
      hasRenewalKey={certificate.hasRenewalKey && data.canManageCredentials}
      savedCredentials={data.savedCredentials}
      boundCredentials={data.boundCredentials}
    />
  </div>
</section>
