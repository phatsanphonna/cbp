<script lang="ts">
  import { resolve } from "$app/paths";
  import FormSelect from '#lib/components/svelte/form-select.svelte';
  import { Button } from "#lib/components/ui/button/index.ts";
  import {
    Field,
    FieldGroup,
    FieldLabel,
  } from "#lib/components/ui/field/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";
  import { hostApplianceTypes } from '#lib/host-appliance-types.js';
  import type { PageProps } from "./$types";

  let { form }: PageProps = $props();
  const applianceOptions = hostApplianceTypes.map((type) => ({ value: type, label: type }));
</script>

<svelte:head>
  <title>Add host | Certified by Pat</title>
</svelte:head>

<section
  class="w-full flex-1 px-5 py-6 md:px-8"
  aria-labelledby="add-host-heading"
>
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="grid gap-1">
      <h1 id="add-host-heading" class="font-heading text-xl font-semibold">
        Add host
      </h1>
      <p class="text-xs text-muted-foreground">
        Register a server or appliance in the host inventory.
      </p>
    </div>
    <Button href={resolve("/hosts")} variant="outline">Back to hosts</Button>
  </header>

  <form method="POST" class="mt-6 border p-4 sm:p-5">
    <FieldGroup>
      <Field>
        <FieldLabel for="host-name" required>Hostname or IP address</FieldLabel>
        <Input
          id="host-name"
          name="name"
          value={form?.values?.name}
          placeholder="edge-01.example.com"
          required
          maxlength={253}
          spellcheck={false}
          autocapitalize="none"
        />
      </Field>
      <Field>
        <FieldLabel for="appliance-type" required>Appliance type</FieldLabel>
        <FormSelect
          id="appliance-type"
          name="applianceType"
          items={applianceOptions}
          value={form?.values?.applianceType ?? 'Linux'}
          required
        />
      </Field>
      {#if form?.message}
        <p role="alert" class="text-xs text-destructive">{form.message}</p>
      {/if}
      <div class="flex justify-end">
        <Button type="submit">Add host</Button>
      </div>
    </FieldGroup>
  </form>
</section>
