<script lang="ts">
  import { X } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Select from '#lib/components/ui/select/index.ts';
  import { notifyFormResult } from './form-feedback.js';

  type People = {
    users: { id: string; name: string; email: string }[];
    groups: { id: number; name: string }[];
  };

  let {
    id,
    owners,
    options,
    assetId,
  }: {
    id: string;
    owners: People;
    // null when the viewer cannot change owners.
    options: People | null;
    // Only for pages that hold several assets, such as the credential list.
    assetId?: string;
  } = $props();

  const current = $derived([
    ...owners.users.map((user) => `user:${user.id}`),
    ...owners.groups.map((group) => `group:${group.id}`),
  ]);
  let selected = $derived(current);
  let form = $state<HTMLFormElement>();
  const items = $derived([
    ...(options?.users ?? []).map((user) => ({
      value: `user:${user.id}`,
      label: `${user.name} (${user.email})`,
    })),
    ...(options?.groups ?? []).map((group) => ({
      value: `group:${group.id}`,
      label: `${group.name} (group)`,
    })),
  ]);
</script>

{#snippet removeButton(value: string, name: string)}
  {#if options}
    <button
      type="button"
      class="-mr-1 rounded-sm opacity-70 hover:opacity-100 focus-visible:opacity-100"
      aria-label={`Remove ${name} from owners`}
      onclick={async () => {
        selected = current.filter((owner) => owner !== value);
        // Wait for the hidden inputs to reflect the new selection before submitting.
        await tick();
        form?.requestSubmit();
      }}
    >
      <X size={12} aria-hidden="true" />
    </button>
  {/if}
{/snippet}

<div class="flex flex-wrap items-center gap-1.5">
  {#each owners.users as user (user.id)}
    <Badge variant="secondary">{user.name}{@render removeButton(`user:${user.id}`, user.name)}</Badge>
  {/each}
  {#each owners.groups as group (group.id)}
    <Badge variant="outline">
      {group.name}{@render removeButton(`group:${group.id}`, group.name)}
    </Badge>
  {/each}
  {#if !owners.users.length && !owners.groups.length}
    <span class="text-sm text-muted-foreground">No owners. Everyone can access this.</span>
  {/if}
</div>

{#if options}
  <form
    bind:this={form}
    method="POST"
    action="?/setOwners"
    class="mt-3 flex flex-wrap items-center gap-2"
    use:enhance={() =>
      async ({ result, update }) => {
        await update({ reset: false });
        // A rejected change leaves the saved owners in place, so show them again.
        if (result.type !== 'success') selected = current;
        notifyFormResult(result, { success: 'ownersMessage', error: 'ownersError' });
      }}
  >
    {#if assetId}<input type="hidden" name="id" value={assetId} />{/if}
    {#each selected as value (value)}
      <input
        type="hidden"
        name={value.startsWith('user:') ? 'ownerUserId' : 'ownerGroupId'}
        value={value.slice(value.indexOf(':') + 1)}
      />
    {/each}
    <Select.Root type="multiple" {items} bind:value={selected}>
      <Select.Trigger {id} class="w-full sm:w-80" aria-label="Owners">
        <Select.Value placeholder="No owners">
          {#snippet children({ selection })}
            {#if selection.type === 'multiple' && selection.selected.length === 1}
              {selection.selected[0]?.label}
            {:else if selection.type === 'multiple' && selection.selected.length > 1}
              {selection.selected.length} owners selected
            {:else}
              No owners
            {/if}
          {/snippet}
        </Select.Value>
      </Select.Trigger>
      <Select.Content>
        <Select.Group>
          <Select.GroupHeading>Users</Select.GroupHeading>
          {#each items.filter((item) => item.value.startsWith('user:')) as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Group>
        <Select.Group>
          <Select.GroupHeading>Groups</Select.GroupHeading>
          {#each items.filter((item) => item.value.startsWith('group:')) as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {:else}
            <Select.GroupHeading>No groups</Select.GroupHeading>
          {/each}
        </Select.Group>
      </Select.Content>
    </Select.Root>
    <Button type="submit" variant="outline" size="sm">Save owners</Button>
  </form>
{/if}
