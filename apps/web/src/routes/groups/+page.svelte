<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { Ellipsis } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { notifyFormResult } from '#lib/components/svelte/form-feedback.js';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
  import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
  import * as Dialog from '#lib/components/ui/dialog/index.ts';
  import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
  import * as Field from '#lib/components/ui/field/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let createOpen = $state(false);
  let editOpen = $state(false);
  let removeOpen = $state(false);
  let editingGroupId = $state<number | null>(null);
  let groupToRemove: (typeof data.groups)[number] | null = $state(null);
  let permissionChecks = $state<Record<string, boolean>>({});
  let creating = $state(false);
  let savingName = $state(false);
  let savingMembers = $state(false);
  let savingPermissions = $state(false);
  let removing = $state(false);

  const editingGroup = $derived(data.groups.find((group) => group.id === editingGroupId) ?? null);

  function enhanceMessage(
    message: string,
    setSaving: (saving: boolean) => void,
    onSuccess?: () => void,
  ): SubmitFunction {
    return () => {
      setSaving(true);
      return async ({ result, update }) => {
        try {
          await update();
          if (result.type === 'success') {
            toast.success(message);
            onSuccess?.();
          } else {
            notifyFormResult(result, {});
          }
        } finally {
          setSaving(false);
        }
      };
    };
  }

  function openEdit(group: (typeof data.groups)[number]) {
    editingGroupId = group.id;
    permissionChecks = Object.fromEntries(
      data.permissions.map((permission) => [
        permission.key,
        group.permissions.includes(permission.key),
      ]),
    );
    editOpen = true;
  }

  function changePermission(key: string, checked: boolean) {
    permissionChecks[key] = checked;
    if (key === 'sudo' && checked) {
      for (const permission of data.permissions) {
        if (permission.key !== 'sudo') permissionChecks[permission.key] = false;
      }
    }
  }

  function permissionLabels(keys: string[]) {
    return keys
      .map((key) => data.permissions.find((permission) => permission.key === key)?.label)
      .filter((label) => label !== undefined);
  }
</script>

<svelte:head>
  <title>Groups | CBP</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="groups-heading">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="grid gap-1">
      <h1 id="groups-heading" class="font-heading text-xl font-semibold">Groups</h1>
      <p class="text-xs text-muted-foreground">Organize users and assign shared permissions.</p>
    </div>
    {#if data.canManageGroups}
      <Button onclick={() => (createOpen = true)}>Create group</Button>
    {/if}
  </header>

  <div class="mt-6 border">
    <Table.Root>
      <Table.Caption class="sr-only">User groups</Table.Caption>
      <Table.Header class="bg-muted">
        <Table.Row>
          <Table.Head scope="col">Group</Table.Head>
          <Table.Head scope="col">Members</Table.Head>
          <Table.Head scope="col">Permissions</Table.Head>
          <Table.Head scope="col" class="text-right">Actions</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.groups as group (group.id)}
          {@const labels = permissionLabels(group.permissions)}
          <Table.Row>
            <Table.Head scope="row" class="max-w-64 whitespace-normal wrap-anywhere">
              {group.name}
            </Table.Head>
            <Table.Cell class="min-w-36 whitespace-normal">
              <span>
                {group.members.length}
                {group.members.length === 1 ? 'member' : 'members'}
              </span>
              {#if group.members.length}
                <span class="block text-xs text-muted-foreground">
                  {group.members
                    .slice(0, 2)
                    .map((member) => member.name)
                    .join(', ')}{group.members.length > 2 ? ` +${group.members.length - 2}` : ''}
                </span>
              {/if}
            </Table.Cell>
            <Table.Cell class="min-w-48 whitespace-normal">
              {#if labels.length}
                <div class="flex flex-wrap gap-1">
                  {#each labels.slice(0, 2) as label (label)}
                    <Badge variant="outline">{label}</Badge>
                  {/each}
                  {#if labels.length > 2}
                    <Badge variant="secondary">+{labels.length - 2}</Badge>
                  {/if}
                </div>
              {:else}
                <span class="text-muted-foreground">None</span>
              {/if}
            </Table.Cell>
            <Table.Cell class="text-right">
              {#if data.canManageGroups || data.canManagePermissions}
                <div class="flex justify-end">
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${group.name}`}
                        >
                          <Ellipsis aria-hidden="true" />
                        </Button>
                      {/snippet}
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end" class="w-40">
                      <DropdownMenu.Group>
                        <DropdownMenu.Item onSelect={() => openEdit(group)}>
                          Edit group
                        </DropdownMenu.Item>
                        {#if data.canManageGroups}
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item
                            variant="destructive"
                            onSelect={() => {
                              groupToRemove = group;
                              removeOpen = true;
                            }}
                          >
                            Remove
                          </DropdownMenu.Item>
                        {/if}
                      </DropdownMenu.Group>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
              {/if}
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row>
            <Table.Cell colspan={4} class="py-8 text-center text-muted-foreground">
              No groups yet. Create a group to organize users and shared permissions.
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</section>

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Create group</Dialog.Title>
      <Dialog.Description>
        Create a group to manage users and shared permissions together.
      </Dialog.Description>
    </Dialog.Header>
    <form
      method="POST"
      action="?/create"
      use:enhance={enhanceMessage(
        'Group created.',
        (value) => (creating = value),
        () => (createOpen = false),
      )}
    >
      <Field.FieldGroup>
        <Field.Field>
          <Field.FieldLabel for="new-group-name" required>Group name</Field.FieldLabel>
          <Input id="new-group-name" name="name" maxlength={80} required />
        </Field.Field>
      </Field.FieldGroup>
      <Dialog.Footer class="mt-5">
        <Dialog.Close>
          {#snippet child({ props })}
            <Button {...props} type="button" variant="outline">Cancel</Button>
          {/snippet}
        </Dialog.Close>
        <Button type="submit" disabled={creating}>
          {creating ? 'Creating…' : 'Create group'}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={editOpen}>
  <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Edit group</Dialog.Title>
      <Dialog.Description>
        Update the group name, members, and shared permissions.
      </Dialog.Description>
    </Dialog.Header>
    {#if editingGroup}
      <div class="grid gap-5">
        {#if data.canManageGroups}
          <form
            method="POST"
            action="?/rename"
            class="grid gap-3 border p-4 sm:grid-cols-[1fr_auto] sm:items-end"
            use:enhance={enhanceMessage('Group renamed.', (value) => (savingName = value))}
          >
            <input type="hidden" name="id" value={editingGroup.id} />
            <Field.Field>
              <Field.FieldLabel for="edit-group-name" required>Group name</Field.FieldLabel>
              <Input
                id="edit-group-name"
                name="name"
                value={editingGroup.name}
                maxlength={80}
                required
              />
            </Field.Field>
            <Button type="submit" variant="outline" size="sm" disabled={savingName}>
              {savingName ? 'Saving…' : 'Save name'}
            </Button>
          </form>

          <form
            method="POST"
            action="?/members"
            class="border p-4"
            use:enhance={enhanceMessage(
              'Group members updated.',
              (value) => (savingMembers = value),
            )}
          >
            <input type="hidden" name="id" value={editingGroup.id} />
            <Field.FieldSet>
              <Field.FieldLegend variant="label">Members</Field.FieldLegend>
              {#if data.users.length}
                <div class="grid max-h-64 gap-x-6 gap-y-2 overflow-y-auto sm:grid-cols-2">
                  {#each data.users as user (user.id)}
                    <Field.Field orientation="horizontal">
                      <Checkbox
                        id={`group-${editingGroup.id}-user-${user.id}`}
                        name="userId"
                        value={user.id}
                        checked={editingGroup.members.some((member) => member.userId === user.id)}
                      />
                      <Field.FieldLabel
                        for={`group-${editingGroup.id}-user-${user.id}`}
                        class="grid gap-0.5 font-normal"
                      >
                        <span>{user.name}</span>
                        <span class="text-xs text-muted-foreground">{user.email}</span>
                      </Field.FieldLabel>
                    </Field.Field>
                  {/each}
                </div>
              {:else}
                <Field.FieldDescription>
                  Create a user account before assigning group members.
                </Field.FieldDescription>
              {/if}
            </Field.FieldSet>
            <div class="mt-4 flex justify-end">
              <Button type="submit" variant="outline" size="sm" disabled={savingMembers}>
                {savingMembers ? 'Saving…' : 'Save members'}
              </Button>
            </div>
          </form>
        {/if}

        {#if data.canManagePermissions}
          <form
            method="POST"
            action="?/savePermissions"
            class="border p-4"
            use:enhance={enhanceMessage(
              'Group permissions updated.',
              (value) => (savingPermissions = value),
            )}
          >
            <input type="hidden" name="groupId" value={editingGroup.id} />
            <Field.FieldSet>
              <Field.FieldLegend variant="label">Shared permissions</Field.FieldLegend>
              <div class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {#each data.permissions as permission (permission.key)}
                  <Field.Field orientation="horizontal" class="items-start">
                    <Checkbox
                      id={`group-${editingGroup.id}-${permission.key}`}
                      name="permission"
                      value={permission.key}
                      checked={permissionChecks[permission.key]}
                      onCheckedChange={(checked) =>
                        changePermission(permission.key, checked === true)}
                      disabled={permission.key !== 'sudo' && permissionChecks.sudo}
                    />
                    <Field.FieldLabel
                      for={`group-${editingGroup.id}-${permission.key}`}
                      class="grid gap-1 font-normal"
                    >
                      <span class="font-medium">{permission.label}</span>
                      <span class="text-xs text-muted-foreground">{permission.description}</span>
                    </Field.FieldLabel>
                  </Field.Field>
                {/each}
              </div>
            </Field.FieldSet>
            <div class="mt-4 flex justify-end">
              <Button type="submit" variant="outline" size="sm" disabled={savingPermissions}>
                {savingPermissions ? 'Saving…' : 'Save permissions'}
              </Button>
            </div>
          </form>
        {/if}
      </div>
    {/if}
    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={() => (editOpen = false)}>Close</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={removeOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Remove group?</AlertDialog.Title>
      <AlertDialog.Description class="wrap-anywhere">
        {#if groupToRemove}
          Remove {groupToRemove.name}. Members will lose the permissions granted by this group.
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    {#if groupToRemove}
      <form
        method="POST"
        action="?/remove"
        use:enhance={enhanceMessage(
          'Group removed.',
          (value) => (removing = value),
          () => (removeOpen = false),
        )}
      >
        <input type="hidden" name="id" value={groupToRemove.id} />
        <AlertDialog.Footer>
          <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
          <AlertDialog.Action type="submit" variant="destructive" disabled={removing}>
            {removing ? 'Removing…' : 'Remove group'}
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </form>
    {/if}
  </AlertDialog.Content>
</AlertDialog.Root>
