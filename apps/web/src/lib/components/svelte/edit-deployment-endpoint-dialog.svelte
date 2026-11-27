<script lang="ts">
  import { enhance } from '$app/forms';
  import { toast } from 'svelte-sonner';
  import DeploymentEndpointFields from '#lib/components/svelte/deployment-endpoint-fields.svelte';
  import FormSelect from '#lib/components/svelte/form-select.svelte';
  import RemoveDeploymentDialog from '#lib/components/svelte/remove-deployment-dialog.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Dialog from '#lib/components/ui/dialog/index.ts';
  import { Field, FieldGroup, FieldLabel } from '#lib/components/ui/field/index.ts';
  import { Spinner } from '#lib/components/ui/spinner/index.ts';
  import { deploymentMethods, deploymentServices } from '#lib/deployment-services.js';

  let {
    deploymentId,
    endpoint,
    engine,
    method,
    message,
    removeMessage,
  }: {
    deploymentId: string;
    endpoint: string;
    engine: string | null;
    method: (typeof deploymentMethods)[number];
    message?: string;
    removeMessage?: string;
  } = $props();
  const id = $props.id();
  const legacyService = $derived(
    engine && !deploymentServices.some((service) => service === engine),
  );
  const serviceOptions = $derived([
    ...(legacyService && engine ? [{ value: 'keep', label: engine }] : []),
    { value: '', label: 'Not specified' },
    ...deploymentServices.map((value) => ({ value, label: value })),
  ]);
  const methodOptions = deploymentMethods.map((value) => ({
    value,
    label: value,
  }));
  const parts = $derived(/^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(endpoint));
  const host = $derived(parts?.[1] ?? parts?.[2] ?? endpoint);
  const port = $derived(parts ? Number(parts[3]) : 443);
  let open = $state(false);
  let pending = $state(false);
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="sm" aria-label={`Edit deployment at ${endpoint}`}>
        Edit deployment
      </Button>
    {/snippet}
  </Dialog.Trigger>
  <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Edit deployment</Dialog.Title>
      <Dialog.Description>
        Changing the address or port marks this deployment as pending verification.
      </Dialog.Description>
    </Dialog.Header>
    <form
      id="{id}-edit"
      method="POST"
      action="?/updateEndpoint"
      use:enhance={() => {
        pending = true;
        return async ({ result, update }) => {
          try {
            await update();
            if (result.type === 'success') {
              open = false;
              if (typeof result.data?.endpointMessage === 'string') {
                toast.success(result.data.endpointMessage);
              }
            } else if (
              result.type === 'failure' &&
              typeof result.data?.endpointError === 'string'
            ) {
              toast.error(result.data.endpointError);
            }
          } finally {
            pending = false;
          }
        };
      }}
    >
      <input type="hidden" name="deploymentId" value={deploymentId} />
      <FieldGroup>
        <DeploymentEndpointFields {host} {port} />
        <Field>
          <FieldLabel for={id}>Web service</FieldLabel>
          <FormSelect
            {id}
            name="engine"
            items={serviceOptions}
            value={legacyService ? 'keep' : (engine ?? '')}
            placeholder="Not specified"
          />
        </Field>
        <Field>
          <FieldLabel for="{id}-method" required>Deployment method</FieldLabel>
          <FormSelect
            id="{id}-method"
            name="method"
            items={methodOptions}
            value={method}
            required
          />
        </Field>
      </FieldGroup>
    </form>
    <Dialog.Footer class="sm:justify-between">
      <RemoveDeploymentDialog
        {deploymentId}
        {endpoint}
        message={removeMessage}
        disabled={pending}
      />
      <div class="flex flex-wrap justify-end gap-2">
        <Dialog.Close>
          {#snippet child({ props })}
            <Button {...props} type="button" variant="outline">Cancel</Button>
          {/snippet}
        </Dialog.Close>
        <Button type="submit" form="{id}-edit" disabled={pending} aria-busy={pending}>
          {#if pending}<Spinner data-icon="inline-start" aria-hidden="true" />{/if}
          Save deployment
        </Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
