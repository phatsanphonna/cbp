<script lang="ts">
  import { Check } from "@lucide/svelte";
  import { enhance } from "$app/forms";
  import { toast } from "svelte-sonner";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Dialog from "#lib/components/ui/dialog/index.ts";
  import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet,
  } from "#lib/components/ui/field/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";
  import * as Select from '#lib/components/ui/select/index.ts';

  type Target = {
    id: string;
    hostId: string;
    hostName: string;
    endpoint: string;
    engine: string;
  };

  let {
    agentTargets,
    ansibleTargets,
    canDeployAgent,
    canDeployAnsible,
  }: {
    agentTargets: Target[];
    ansibleTargets: Target[];
    canDeployAgent: boolean;
    canDeployAnsible: boolean;
  } = $props();
  const id = $props.id();
  let pending = $state(false);
  let selected = $state<string[]>([]);
  let preferredMethod = $state('');
  const methods = $derived([
    { value: 'Agent', targets: agentTargets, enabled: canDeployAgent },
    { value: 'Ansible', targets: ansibleTargets, enabled: canDeployAnsible }
  ].filter(({ targets }) => targets.length));
  const method = $derived(
    methods.find(({ value, enabled }) => enabled && value === preferredMethod) ??
    methods.find(({ enabled }) => enabled)
  );
  const choices = $derived(
    (method?.targets ?? []).map((target) => ({
      ...target,
      value: JSON.stringify([
        target.id,
        target.endpoint,
        target.hostId,
        target.engine,
      ]),
    })),
  );
  const selectedChoices = $derived(
    choices.filter(({ value }) => selected.includes(value)),
  );
  const selectedHosts = $derived(
    new Set(selectedChoices.map(({ hostId }) => hostId)),
  );
</script>

<Dialog.Root>
  {#if methods.length}
    <Dialog.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="outline"
          size="sm"
          disabled={!method}
        >Deploy</Button>
      {/snippet}
    </Dialog.Trigger>
  {/if}
  <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Deploy certificate</Dialog.Title>
      <Dialog.Description
        >Select one linked endpoint per host and provide the matching private
        key once.</Dialog.Description
      >
    </Dialog.Header>
    <form
      method="POST"
      action={method?.value === 'Ansible' ? '?/deployAnsible' : '?/deploy'}
      enctype="multipart/form-data"
      use:enhance={() => {
        pending = true;
        return async ({ result, update }) => {
          try {
            await update();
            if (
              result.type === "failure" &&
              typeof result.data?.deployError === "string"
            )
              toast.error(result.data.deployError);
          } finally {
            pending = false;
          }
        };
      }}
    >
      <FieldGroup>
        {#if methods.length > 1}
          <Field>
            <FieldLabel for="{id}-method">Deployment method</FieldLabel>
            <Select.Root type="single" value={method?.value ?? ''} disabled={pending}
              onValueChange={(value) => {
                preferredMethod = value;
                selected = [];
              }}
            >
              <Select.Trigger id="{id}-method">{method?.value}</Select.Trigger>
              <Select.Content>
                <Select.Group>
                  {#each methods as { value, enabled } (value)}
                    <Select.Item {value} label={enabled ? value : `${value} (unavailable)`} disabled={!enabled} />
                  {/each}
                </Select.Group>
              </Select.Content>
            </Select.Root>
          </Field>
        {/if}
        <FieldSet>
          <FieldLegend variant="label" required>{methods.length === 1 && method ? `${method.value} hosts` : 'Hosts'}</FieldLegend>
          <FieldGroup class="gap-2">
            {#each choices as choice (choice.id)}
              <Field orientation="horizontal">
                <span class="grid size-4 shrink-0 place-items-center">
                  <input
                    type="checkbox"
                    id="{id}-{choice.id}"
                    name="deploymentTarget"
                    value={choice.value}
                    bind:group={selected}
                    class="peer col-start-1 row-start-1 size-4 appearance-none border border-input bg-background checked:border-primary checked:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 forced-colors:appearance-auto"
                    disabled={pending ||
                      (selectedHosts.has(choice.hostId) &&
                        !selected.includes(choice.value))}
                  />
                  <Check
                    aria-hidden="true"
                    class="invisible pointer-events-none col-start-1 row-start-1 size-3 text-primary-foreground peer-checked:visible peer-disabled:opacity-50 forced-colors:hidden"
                  />
                </span>
                <FieldLabel
                  for="{id}-{choice.id}"
                  class="flex min-w-0 flex-col items-start gap-1"
                >
                  <span class="wrap-anywhere">{choice.hostName}</span>
                  <span class="wrap-anywhere font-normal text-muted-foreground"
                    >{choice.endpoint} · {choice.engine}</span
                  >
                </FieldLabel>
              </Field>
            {/each}
          </FieldGroup>
        </FieldSet>
        <FieldSet aria-describedby="{id}-key-hint">
          <FieldLegend variant="label" required>Private key (PEM)</FieldLegend>
          <FieldDescription id="{id}-key-hint"
            >Choose a file or paste the PEM contents. Use an unencrypted key up
            to 16 KB.</FieldDescription
          >
          <FieldGroup>
            <Field>
              <FieldLabel for="{id}-key">Upload private key file</FieldLabel>
              <Input
                id="{id}-key"
                type="file"
                name="privateKey"
                accept=".pem,.key"
              />
            </Field>
            <Field>
              <FieldLabel for="{id}-key-pem"
                >Or paste the private key</FieldLabel
              >
              <textarea
                id="{id}-key-pem"
                name="privateKeyPem"
                rows="4"
                maxlength={16384}
                autocomplete="off"
                autocapitalize="none"
                spellcheck={false}
                class="w-full resize-y border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"
                placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
            </Field>
          </FieldGroup>
        </FieldSet>
        {#if method?.value === 'Ansible'}
          <FieldSet>
            <FieldLegend variant="label">SSH and su credentials</FieldLegend>
            <FieldDescription>Leave both blank to use the runner’s SSH key and sudo settings.</FieldDescription>
            <FieldGroup>
              <Field>
                <FieldLabel for="{id}-ssh-password">SSH password</FieldLabel>
                <Input id="{id}-ssh-password" name="sshPassword" type="password" autocomplete="new-password" maxlength={1024} />
              </Field>
              <Field>
                <FieldLabel for="{id}-su-password">Root su password</FieldLabel>
                <Input id="{id}-su-password" name="suPassword" type="password" autocomplete="new-password" maxlength={1024} />
              </Field>
            </FieldGroup>
          </FieldSet>
        {/if}
        <Dialog.Footer>
          <Dialog.Close>
            {#snippet child({ props })}
              <Button {...props} type="button" variant="outline">Cancel</Button>
            {/snippet}
          </Dialog.Close>
          <Button type="submit" disabled={pending || !selectedChoices.length}>
            {pending
              ? "Queuing…"
              : selectedChoices.length
                ? `Deploy to ${selectedChoices.length} ${selectedChoices.length === 1 ? "host" : "hosts"}`
                : "Deploy"}
          </Button>
        </Dialog.Footer>
      </FieldGroup>
    </form>
  </Dialog.Content>
</Dialog.Root>
