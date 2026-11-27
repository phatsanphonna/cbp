<script lang="ts">
  import { resolve } from "$app/paths";
  import { enhance } from "$app/forms";
  import { ChevronDown } from "@lucide/svelte";
  import { toast } from "svelte-sonner";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Checkbox } from "#lib/components/ui/checkbox/index.ts";
  import FormSelect from "#lib/components/svelte/form-select.svelte";
  import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet,
  } from "#lib/components/ui/field/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";
  import { Popover } from "bits-ui";
  import * as Select from "#lib/components/ui/select/index.ts";

  type Target = {
    id: string;
    hostId: string;
    hostLabel: string;
    endpoint: string;
    engine: string;
  };

  let {
    certificateId,
    agentTargets,
    ansibleTargets,
    canDeployAgent,
    canDeployAnsible,
    hasRenewalKey,
    savedCredentials,
    boundCredentials,
  }: {
    certificateId: string;
    agentTargets: Target[];
    ansibleTargets: Target[];
    canDeployAgent: boolean;
    canDeployAnsible: boolean;
    hasRenewalKey: boolean;
    savedCredentials: { available: boolean; key: boolean; ansible: boolean };
    boundCredentials: Record<string, string>;
  } = $props();
  const id = $props.id();
  let pending = $state(false);
  let hostPickerOpen = $state(false);
  let hostSearch = $state("");
  let selected = $state<string[]>([]);
  let becomeMethod = $state<"sudo" | "su">("sudo");
  let suPassword = $state("");
  let useSavedKey = $state(false);
  let useSavedAnsible = $state(false);
  let hostOverrides = $state<Record<string, boolean>>({});
  let hostBecomeMethods = $state<Record<string, string>>({});
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
  const selectedAnsible = $derived(selectedChoices.filter(({ method }) => method === 'Ansible'));
  const needsSharedAnsible = $derived(selectedAnsible.some(({ hostId }) => !hostOverrides[hostId] && !boundCredentials[hostId]));

  function selectTarget(value: string, checked: boolean) {
    selected = checked
      ? [...selected, value]
      : selected.filter((item) => item !== value);
  }
</script>

<form
      method="POST"
      action="?/deployMixed"
      enctype="multipart/form-data"
      use:enhance={() => {
        pending = true;
        return async ({ result, update }) => {
          try {
            await update();
            if (result.type === 'redirect') toast.success('Deployment queued.');
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
      <FieldGroup class="gap-6">
        <FieldSet>
          <FieldLegend variant="label" required>Hosts</FieldLegend>
          <Popover.Root bind:open={hostPickerOpen}>
            <Popover.Trigger id="{id}-host-picker">
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="outline"
                  class="h-9 w-full justify-between text-left"
                  disabled={pending}
                  aria-label="Search and select deployment targets"
                >
                  {#if selectedChoices.length}
                    <span class="truncate">
                      {selectedChoices.length} endpoint{selectedChoices.length === 1 ? "" : "s"} selected
                    </span>
                  {:else}
                    <span class="truncate text-muted-foreground">Search and select deployment targets</span>
                  {/if}
                  <ChevronDown aria-hidden="true" class="size-4 shrink-0 opacity-50" />
                </Button>
              {/snippet}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="start"
                class="z-50 w-[var(--bits-floating-anchor-width)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-none border bg-popover text-popover-foreground shadow-md outline-none"
              >
                <div class="border-b p-2">
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
                </div>
                <FieldGroup
                  class="max-h-64 gap-2 overflow-y-auto overscroll-contain p-2"
                >
                  {#each visibleChoices as choice (choice.id)}
                    <Field orientation="horizontal">
                      <Checkbox
                        id="{id}-{choice.id}"
                        checked={selectedValues.has(choice.value)}
                        onCheckedChange={(checked) =>
                          selectTarget(choice.value, checked === true)}
                        disabled={pending ||
                          (selectedHosts.has(choice.hostId) &&
                            !selectedValues.has(choice.value))}
                      />
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
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <p class="text-xs text-muted-foreground" aria-live="polite">
            {selectedChoices.length} selected · {visibleChoices.length} of {choices.length}
            endpoints shown
          </p>
          {#each selectedChoices as choice (choice.id)}
            <input type="hidden" name="deploymentTarget" value={choice.value} />
          {/each}
        </FieldSet>
        <FieldSet aria-describedby="{id}-key-hint">
          <FieldLegend variant="label" required={!hasRenewalKey}>Private key (PEM)</FieldLegend>
          {#if hasRenewalKey}
            <input type="hidden" name="useRenewalKey" value="yes" />
          {/if}
          <FieldDescription id="{id}-key-hint"
            >{hasRenewalKey
              ? 'Leave these fields blank to use the encrypted key stored with this certificate.'
              : 'Choose a file or paste the PEM contents. Use an unencrypted key up to 16 KB.'}</FieldDescription
          >
          {#if savedCredentials.key}
            <Field orientation="horizontal">
              <Checkbox
                id="{id}-use-saved-key"
                name="useSavedKey"
                value="yes"
                bind:checked={useSavedKey}
              />
              <FieldLabel for="{id}-use-saved-key">Use saved private key</FieldLabel>
            </Field>
          {/if}
          {#if !useSavedKey}
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
          {#if savedCredentials.available}
            <Field orientation="horizontal">
              <Checkbox id="{id}-save-key" name="saveKey" value="yes" />
              <FieldLabel for="{id}-save-key">Save this private key for future deployments</FieldLabel>
            </Field>
          {/if}
          {/if}
        </FieldSet>
        {#if hasAnsibleSelected}
          <FieldSet>
            <FieldLegend variant="label" required
              >Ansible credentials</FieldLegend
            >
            <FieldDescription
              >Use shared credentials or provide different credentials for each host.</FieldDescription
            >
            {#each selectedAnsible as choice (choice.hostId)}
              <FieldSet>
                <FieldLegend variant="label">{choice.hostLabel}</FieldLegend>
                {#if boundCredentials[choice.hostId]}
                  <FieldDescription>Bound credential: {boundCredentials[choice.hostId]}</FieldDescription>
                {/if}
                <Field orientation="horizontal">
                  <Checkbox
                    id="{id}-override-{choice.hostId}"
                    name="ansibleOverride:{choice.hostId}"
                    value="yes"
                    checked={hostOverrides[choice.hostId] ?? false}
                    onCheckedChange={(checked) => { hostOverrides[choice.hostId] = checked; }}
                  />
                  <FieldLabel for="{id}-override-{choice.hostId}">Use different credentials for this host</FieldLabel>
                </Field>
                {#if hostOverrides[choice.hostId]}
                  <FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel for="{id}-username-{choice.hostId}">SSH username</FieldLabel>
                      <Input id="{id}-username-{choice.hostId}" name="sshUsername:{choice.hostId}" autocomplete="username" maxlength={256} required />
                    </Field>
                    <Field>
                      <FieldLabel for="{id}-password-{choice.hostId}">SSH password</FieldLabel>
                      <Input id="{id}-password-{choice.hostId}" name="sshPassword:{choice.hostId}" type="password" autocomplete="new-password" maxlength={1024} required />
                    </Field>
                    <Field>
                      <FieldLabel for="{id}-method-{choice.hostId}">Become method</FieldLabel>
                      <FormSelect
                        id="{id}-method-{choice.hostId}"
                        name="becomeMethod:{choice.hostId}"
                        items={[{ value: 'sudo', label: 'sudo' }, { value: 'su', label: 'su' }]}
                        value={hostBecomeMethods[choice.hostId] ?? 'sudo'}
                        onValueChange={(value) => { hostBecomeMethods[choice.hostId] = value; }}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel for="{id}-su-{choice.hostId}">Root su password</FieldLabel>
                      <Input id="{id}-su-{choice.hostId}" name="suPassword:{choice.hostId}" type="password" autocomplete="new-password" maxlength={1024} disabled={hostBecomeMethods[choice.hostId] !== 'su'} required={hostBecomeMethods[choice.hostId] === 'su'} />
                    </Field>
                  </FieldGroup>
                {/if}
              </FieldSet>
            {/each}
            {#if needsSharedAnsible}
            <FieldDescription>Shared credentials apply to hosts without an override.</FieldDescription>
            {#if savedCredentials.ansible}
              <Field orientation="horizontal">
                <Checkbox
                  id="{id}-use-saved-ansible"
                  name="useSavedAnsible"
                  value="yes"
                  bind:checked={useSavedAnsible}
                />
                <FieldLabel for="{id}-use-saved-ansible">Use saved Ansible credentials</FieldLabel>
              </Field>
            {/if}
            {#if !useSavedAnsible}
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
            {#if savedCredentials.available}
              <Field orientation="horizontal">
                <Checkbox id="{id}-save-ansible" name="saveAnsible" value="yes" />
                <FieldLabel for="{id}-save-ansible">Save these Ansible credentials for future deployments</FieldLabel>
              </Field>
            {/if}
            {/if}
            {/if}
          </FieldSet>
        {/if}
        <div class="sticky bottom-0 z-10 -mx-5 mt-2 flex items-center justify-between gap-3 border-t bg-background/95 px-5 py-3 backdrop-blur md:-mx-8 md:px-8">
          <Button href={resolve("/certificates/[id]", { id: certificateId })} variant="outline">
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !selectedChoices.length}>
            {pending
              ? "Queuing…"
              : selectedChoices.length
                ? `Deploy to ${selectedChoices.length} ${selectedChoices.length === 1 ? "host" : "hosts"}`
                : "Deploy"}
          </Button>
        </div>
      </FieldGroup>
    </form>
