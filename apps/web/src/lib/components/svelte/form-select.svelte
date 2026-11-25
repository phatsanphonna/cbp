<script lang="ts">
  import type { Component } from "svelte";
  import * as Select from "#lib/components/ui/select/index.ts";

  let {
    id,
    name,
    items,
    value = $bindable(""),
    placeholder = "Choose an option",
    required = false,
    onValueChange,
  }: {
    id: string;
    name: string;
    items: {
      value: string;
      label: string;
      icon?: Component<{ size?: number; "aria-hidden"?: "true" }>;
    }[];
    value?: string;
    placeholder?: string;
    required?: boolean;
    onValueChange?: (value: string) => void;
  } = $props();

  const SelectedIcon = $derived(
    items.find((item) => item.value === value)?.icon,
  );
</script>

<Select.Root type="single" {name} {items} bind:value {required} {onValueChange}>
  <Select.Trigger {id} class="w-full" aria-required={required}>
    {#if SelectedIcon}
      <span class="flex min-w-0 items-center gap-1.5">
        <SelectedIcon size={16} aria-hidden="true" />
        <Select.Value {placeholder} />
      </span>
    {:else}
      <Select.Value {placeholder} />
    {/if}
  </Select.Trigger>
  <Select.Content>
    <Select.Group>
      {#each items as item (item.value)}
        <Select.Item value={item.value} label={item.label}>
          {#snippet children()}
            {#if item.icon}<item.icon size={16} aria-hidden="true" />{/if}
            {item.label}
          {/snippet}
        </Select.Item>
      {/each}
    </Select.Group>
  </Select.Content>
</Select.Root>
