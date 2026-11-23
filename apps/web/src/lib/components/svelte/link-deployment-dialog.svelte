<script lang="ts">
  import { enhance } from '$app/forms';
  import DeploymentEndpointFields from '#lib/components/svelte/deployment-endpoint-fields.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Dialog from '#lib/components/ui/dialog/index.ts';
  import { Field, FieldGroup, FieldLabel } from '#lib/components/ui/field/index.ts';
  import { deploymentMethods, deploymentServices } from '#lib/deployment-services.js';

  let { target, options, message }: {
    target: 'host' | 'certificate';
    options: { id: string; label: string }[];
    message?: string;
  } = $props();

  const id = $props.id();
  const label = $derived(target === 'host' ? 'Host' : 'Certificate');
  let open = $state(false);
  let pending = $state(false);
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="outline" size="sm">Link {target}</Button>
    {/snippet}
  </Dialog.Trigger>
  <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Link {target}</Dialog.Title>
      <Dialog.Description>Add the endpoint to CBP’s deployment inventory so you can track its verification status.</Dialog.Description>
    </Dialog.Header>
    <form method="POST" action="?/linkDeployment" use:enhance={() => {
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
      <FieldGroup>
        <Field>
          <FieldLabel for="{id}-target" required>{label}</FieldLabel>
          <select id="{id}-target" name={target === 'host' ? 'hostId' : 'certificateId'} class="h-8 w-full border border-input bg-background px-2 text-xs" required>
            <option value="">Choose a {target}</option>
            {#each options as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
        </Field>
        <DeploymentEndpointFields useHostAddress />
        <Field>
          <FieldLabel for="{id}-engine">Web service</FieldLabel>
          <select id="{id}-engine" name="engine" class="h-8 w-full border border-input bg-background px-2 text-xs">
            <option value="">Not specified</option>
            {#each deploymentServices as service (service)}
              <option value={service}>{service}</option>
            {/each}
          </select>
        </Field>
        <Field>
          <FieldLabel for="{id}-method" required>Deployment method</FieldLabel>
          <select id="{id}-method" name="method" class="h-8 w-full border border-input bg-background px-2 text-xs" required>
            {#each deploymentMethods as method (method)}
              <option value={method}>{method}</option>
            {/each}
          </select>
        </Field>
        {#if message}
          <p class="text-xs text-destructive" role="alert">{message}</p>
        {/if}
        <Dialog.Footer>
          <Dialog.Close>
            {#snippet child({ props })}
              <Button {...props} type="button" variant="outline">Cancel</Button>
            {/snippet}
          </Dialog.Close>
          <Button type="submit" disabled={pending}>{pending ? 'Linking…' : `Link ${target}`}</Button>
        </Dialog.Footer>
      </FieldGroup>
    </form>
  </Dialog.Content>
</Dialog.Root>
