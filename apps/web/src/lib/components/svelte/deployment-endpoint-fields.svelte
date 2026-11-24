<script lang="ts">
  import {
    Field,
    FieldDescription,
    FieldLabel,
  } from "#lib/components/ui/field/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";

  let {
    host = "",
    port = 443,
    useHostAddress = false,
  }: {
    host?: string;
    port?: number;
    useHostAddress?: boolean;
  } = $props();
  const id = $props.id();
</script>

<div class="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_6rem]">
  <Field>
    <FieldLabel for="{id}-address" required={!useHostAddress}
      >Endpoint hostname or IP</FieldLabel
    >
    <Input
      id="{id}-address"
      name="endpointHost"
      value={host}
      placeholder={useHostAddress ? "Use registered host address" : undefined}
      maxlength={253}
      spellcheck={false}
      autocapitalize="none"
      required={!useHostAddress}
      aria-describedby={useHostAddress ? `${id}-hint` : undefined}
    />
    {#if useHostAddress}
      <FieldDescription id="{id}-hint"
        >Leave blank to use the host’s registered address.</FieldDescription
      >
    {/if}
  </Field>
  <Field>
    <FieldLabel for="{id}-port" required>Port</FieldLabel>
    <Input
      id="{id}-port"
      name="port"
      type="number"
      value={port}
      min={1}
      max={65535}
      required
    />
  </Field>
</div>
