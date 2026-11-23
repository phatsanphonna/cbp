<script lang="ts">
  import { enhance } from '$app/forms';
  import { toast } from 'svelte-sonner';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Dialog from '#lib/components/ui/dialog/index.ts';
  import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '#lib/components/ui/field/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';

  let { targets, canDeploy }: {
    targets: { id: string; hostId: string; hostName: string; endpoint: string; engine: string }[];
    canDeploy: boolean;
  } = $props();
  const id = $props.id();
  let pending = $state(false);
  let selected = $state<string[]>([]);
  const choices = $derived(targets.map((target) => ({
    ...target,
    value: JSON.stringify([target.id, target.endpoint, target.hostId, target.engine])
  })));
  const selectedChoices = $derived(choices.filter(({ value }) => selected.includes(value)));
  const selectedHosts = $derived(new Set(selectedChoices.map(({ hostId }) => hostId)));
</script>

<Dialog.Root>
  {#if canDeploy && choices.length}
    <Dialog.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="outline" size="sm">Deploy</Button>
      {/snippet}
    </Dialog.Trigger>
  {/if}
  <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Deploy certificate</Dialog.Title>
      <Dialog.Description>Select one linked endpoint per host and provide the matching private key once.</Dialog.Description>
    </Dialog.Header>
    <form method="POST" action="?/deploy" enctype="multipart/form-data" use:enhance={() => {
      pending = true;
      return async ({ result, update }) => {
        try {
          await update();
          if (result.type === 'failure' && typeof result.data?.deployError === 'string') toast.error(result.data.deployError);
        } finally {
          pending = false;
        }
      };
    }}>
      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label" required>Hosts</FieldLegend>
          <FieldGroup class="gap-2">
            {#each choices as choice (choice.id)}
              <Field orientation="horizontal">
                <input type="checkbox" id="{id}-{choice.id}" name="deploymentTarget" value={choice.value}
                  bind:group={selected} class="size-4 shrink-0 accent-primary"
                  disabled={pending || (selectedHosts.has(choice.hostId) && !selected.includes(choice.value))} />
                <FieldLabel for="{id}-{choice.id}" class="flex min-w-0 flex-col items-start gap-1">
                  <span class="wrap-anywhere">{choice.hostName}</span>
                  <span class="wrap-anywhere font-normal text-muted-foreground">{choice.endpoint} · {choice.engine}</span>
                </FieldLabel>
              </Field>
            {/each}
          </FieldGroup>
        </FieldSet>
        <FieldSet aria-describedby="{id}-key-hint">
          <FieldLegend variant="label" required>Private key (PEM)</FieldLegend>
          <FieldDescription id="{id}-key-hint">Choose a file or paste the PEM contents. Use an unencrypted key up to 16 KB.</FieldDescription>
          <FieldGroup>
            <Field>
              <FieldLabel for="{id}-key">Upload private key file</FieldLabel>
              <Input id="{id}-key" type="file" name="privateKey" accept=".pem,.key" />
            </Field>
            <Field>
              <FieldLabel for="{id}-key-pem">Or paste the private key</FieldLabel>
              <textarea id="{id}-key-pem" name="privateKeyPem" rows="4" maxlength={16384}
                autocomplete="off" autocapitalize="none" spellcheck={false}
                class="w-full resize-y border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"
                placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
            </Field>
          </FieldGroup>
        </FieldSet>
        <Dialog.Footer>
          <Dialog.Close>
            {#snippet child({ props })}
              <Button {...props} type="button" variant="outline">Cancel</Button>
            {/snippet}
          </Dialog.Close>
          <Button type="submit" disabled={pending || !selectedChoices.length}>
            {pending ? 'Queuing…' : selectedChoices.length ? `Deploy to ${selectedChoices.length} ${selectedChoices.length === 1 ? 'host' : 'hosts'}` : 'Deploy'}
          </Button>
        </Dialog.Footer>
      </FieldGroup>
    </form>
  </Dialog.Content>
</Dialog.Root>
