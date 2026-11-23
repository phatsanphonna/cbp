<script lang="ts">
  import { resolve } from '$app/paths';
  import { Field, FieldDescription, FieldLabel } from '#lib/components/ui/field/index.ts';

  let { groups, selected = null }: {
    groups: { id: number; name: string }[];
    selected?: number | null;
  } = $props();
  const id = $props.id();
</script>

<Field>
  <FieldLabel for={id}>Responsible group</FieldLabel>
  <select {id} name="groupId" class="h-8 w-full border border-input bg-background px-2 text-xs" value={selected === null ? '' : String(selected)}>
    <option value="">Unassigned</option>
    {#each groups as group (group.id)}
      <option value={String(group.id)}>{group.name}</option>
    {/each}
  </select>
  {#if !groups.length}
    <FieldDescription>You can create a responsible group on the <a href={resolve('/groups')}>Groups page</a>.</FieldDescription>
  {/if}
</Field>
