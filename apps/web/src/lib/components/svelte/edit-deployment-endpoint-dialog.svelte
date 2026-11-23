<script lang="ts">
  import { enhance } from '$app/forms';
  import DeploymentEndpointFields from '#lib/components/svelte/deployment-endpoint-fields.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Dialog from '#lib/components/ui/dialog/index.ts';
  import { FieldGroup } from '#lib/components/ui/field/index.ts';
  import { Spinner } from '#lib/components/ui/spinner/index.ts';

  let { deploymentId, endpoint, message }: { deploymentId: string; endpoint: string; message?: string } = $props();
  const parts = $derived(/^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(endpoint));
  const host = $derived(parts?.[1] ?? parts?.[2] ?? endpoint);
  const port = $derived(parts ? Number(parts[3]) : 443);
  let open = $state(false);
  let pending = $state(false);
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="sm" aria-label={`Edit endpoint ${endpoint}`}>Edit endpoint</Button>
    {/snippet}
  </Dialog.Trigger>
  <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Edit endpoint</Dialog.Title>
      <Dialog.Description>Changing the address or port marks this deployment as pending verification.</Dialog.Description>
    </Dialog.Header>
    <form method="POST" action="?/updateEndpoint" use:enhance={() => {
      pending = true;
      return async ({ result, update }) => {
        try {
          await update();
          if (result.type === 'success') open = false;
        } finally {
          pending = false;
        }
      };
    }}>
      <input type="hidden" name="deploymentId" value={deploymentId} />
      <FieldGroup>
        <DeploymentEndpointFields {host} {port} />
        {#if message}
          <p class="text-xs text-destructive" role="alert">{message}</p>
        {/if}
        <Dialog.Footer>
          <Dialog.Close>
            {#snippet child({ props })}
              <Button {...props} type="button" variant="outline">Cancel</Button>
            {/snippet}
          </Dialog.Close>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {#if pending}
              <Spinner data-icon="inline-start" aria-hidden="true" />
            {/if}
            Save endpoint
          </Button>
        </Dialog.Footer>
      </FieldGroup>
    </form>
  </Dialog.Content>
</Dialog.Root>
