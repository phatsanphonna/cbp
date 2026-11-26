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
  import * as Select from "#lib/components/ui/select/index.ts";

  type Target = {
    id: string;
    hostId: string;
    hostLabel: string;
    endpoint: string;
    engine: string;
  };

  let {
    agentTargets,
    ansibleTargets,
    canDeployAgent,
    canDeployAnsible,
    hasRenewalKey,
  }: {
    agentTargets: Target[];
    ansibleTargets: Target[];
    canDeployAgent: boolean;
    canDeployAnsible: boolean;
    hasRenewalKey: boolean;
  } = $props();
  const id = $props.id();
  let pending = $state(false);
  let hostSearch = $state("");
  let selected = $state<string[]>([]);
  let becomeMethod = $state<"sudo" | "su">("sudo");
  let suPassword = $state("");
  const choices = $derived(
    [
      ...(canDeployAgent
        ? agentTargets.map((target) => ({
            ...target,
            method: "Agent" as const,
          }))
        : []),
      ...(canDeployAnsible
        ? ansibleTargets.map((target) => ({
            ...target,
            method: "Ansible" as const,
          }))
        : []),
    ].map((target) => ({
      ...target,
      value: JSON.stringify([
        target.id,
        target.endpoint,
        target.hostId,
        target.engine,
        target.method,
      ]),
    })),
  );
  const searchTerms = $derived(
    hostSearch.trim().toLowerCase().split(/\s+/).filter(Boolean),
  );
  const visibleChoices = $derived(
    searchTerms.length
      ? choices.filter(({ hostLabel, endpoint, engine, method }) => {
          const label =
            `${hostLabel} ${endpoint} ${engine} ${method}`.toLowerCase();
          return searchTerms.every((term) => label.includes(term));
        })
      : choices,
  );
  const selectedValues = $derived(new Set(selected));
  const selectedChoices = $derived(
    choices.filter(({ value }) => selectedValues.has(value)),
  );
  const selectedHosts = $derived(
    new Set(selectedChoices.map(({ hostId }) => hostId)),
  );
  const hasAnsibleSelected = $derived(
    selectedChoices.some(({ method }) => method === "Ansible"),
  );

  function selectTarget(value: string, checked: boolean) {
    selected = checked
      ? [...selected, value]
      : selected.filter((item) => item !== value);
  }
</script>

<Dialog.Root>
  {#if agentTargets.length || ansibleTargets.length}
    <Dialog.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="outline"
          size="sm"
          disabled={!choices.length}>Deploy</Button
        >
      {/snippet}
    </Dialog.Trigger>
  {/if}
  <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Deploy certificate</Dialog.Title>
      <Dialog.Description
        >Select one linked endpoint per host. Agent and Ansible targets can be
        combined in one run.</Dialog.Description
      >
    </Dialog.Header>
    <form
      method="POST"
      action="?/deployMixed"
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
        <FieldSet>
          <FieldLegend variant="label" required>Hosts</FieldLegend>
          <Field>
            <FieldLabel for="{id}-host-search" class="sr-only"
              >Search deployment hosts</FieldLabel
            >
            <Input
              id="{id}-host-search"
              type="search"
              placeholder="Search host, endpoint, service, or method"
              bind:value={hostSearch}
              onkeydown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          </Field>
          <p class="text-xs text-muted-foreground" aria-live="polite">
            {selectedChoices.length} selected · {visibleChoices.length} of {choices.length}
            endpoints shown
          </p>
          {#each selectedChoices as choice (choice.id)}
            <input type="hidden" name="deploymentTarget" value={choice.value} />
          {/each}
          <FieldGroup
            class="max-h-64 gap-2 overflow-y-auto overscroll-contain border p-2"
          >
            {#each visibleChoices as choice (choice.id)}
              <Field orientation="horizontal">
                <span class="grid size-4 shrink-0 place-items-center">
                  <input
                    type="checkbox"
                    id="{id}-{choice.id}"
                    checked={selectedValues.has(choice.value)}
                    onchange={(event) =>
                      selectTarget(choice.value, event.currentTarget.checked)}
                    class="peer col-start-1 row-start-1 size-4 appearance-none border border-input bg-background checked:border-primary checked:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 forced-colors:appearance-auto"
                    disabled={pending ||
                      (selectedHosts.has(choice.hostId) &&
                        !selectedValues.has(choice.value))}
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
                  <span class="wrap-anywhere">{choice.hostLabel}</span>
                  <span class="wrap-anywhere font-normal text-muted-foreground"
                    >{choice.endpoint} · {choice.engine} · {choice.method}</span
                  >
                </FieldLabel>
              </Field>
            {:else}
              <p class="px-2 py-3 text-xs text-muted-foreground">
                {choices.length
                  ? "No endpoints match your search."
                  : "No eligible endpoints are available."}
              </p>
            {/each}
          </FieldGroup>
        </FieldSet>
        <FieldSet aria-describedby="{id}-key-hint">
          <FieldLegend variant="label" required={!hasRenewalKey}>Private key (PEM)</FieldLegend>
          {#if hasRenewalKey}
            <input type="hidden" name="useRenewalKey" value="yes" />
          {/if}
          <FieldDescription id="{id}-key-hint"
            >{hasRenewalKey
              ? 'Leave these fields blank to use the stored Let’s Encrypt key.'
              : 'Choose a file or paste the PEM contents. Use an unencrypted key up to 16 KB.'}</FieldDescription
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
        {#if hasAnsibleSelected}
          <FieldSet>
            <FieldLegend variant="label" required
              >Ansible credentials</FieldLegend
            >
            <FieldDescription
              >These credentials are used for this deployment only.</FieldDescription
            >
            <FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel for="{id}-ssh-username">SSH username</FieldLabel>
                <Input
                  id="{id}-ssh-username"
                  name="sshUsername"
                  autocomplete="username"
                  maxlength={256}
                  required
                />
              </Field>
              <Field>
                <FieldLabel for="{id}-ssh-password">SSH password</FieldLabel>
                <Input
                  id="{id}-ssh-password"
                  name="sshPassword"
                  type="password"
                  autocomplete="new-password"
                  maxlength={1024}
                  required
                />
              </Field>
            </FieldGroup>
            <FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel for="{id}-become-method">Become method</FieldLabel>
                <Select.Root
                  type="single"
                  value={becomeMethod}
                  onValueChange={(value) => {
                    if (value === "sudo" || value === "su") {
                      becomeMethod = value;
                      if (value === "sudo") suPassword = "";
                    }
                  }}
                >
                  <Select.Trigger id="{id}-become-method"
                    >{becomeMethod}</Select.Trigger
                  >
                  <Select.Content>
                    <Select.Group>
                      <Select.Item value="sudo" label="sudo" />
                      <Select.Item value="su" label="su" />
                    </Select.Group>
                  </Select.Content>
                </Select.Root>
                <input type="hidden" name="becomeMethod" value={becomeMethod} />
              </Field>
              <Field class="sm:col-span-2">
                <FieldLabel for="{id}-su-password">Root su password</FieldLabel>
                <Input
                  id="{id}-su-password"
                  name="suPassword"
                  type="password"
                  autocomplete="new-password"
                  maxlength={1024}
                  bind:value={suPassword}
                  disabled={becomeMethod !== "su"}
                  required={becomeMethod === "su"}
                  class="disabled:pointer-events-auto disabled:cursor-not-allowed"
                />
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
