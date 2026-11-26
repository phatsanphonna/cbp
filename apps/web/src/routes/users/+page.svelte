<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { Ellipsis } from '@lucide/svelte';
  import { createColumnHelper, renderSnippet } from '@tanstack/svelte-table';
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import DataTable from '#lib/components/svelte/data-table.svelte';
  import type { DataTableFeatures } from '#lib/components/svelte/data-table-features.js';
  import { notifyFormResult } from '#lib/components/svelte/form-feedback.js';
  import { resolve } from '$app/paths';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
  import * as Dialog from '#lib/components/ui/dialog/index.ts';
  import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
  import * as Field from '#lib/components/ui/field/index.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let groupsOpen = $state(false);
  let permissionsOpen = $state(false);
  let savingGroups = $state(false);
  let savingPermissions = $state(false);
  let permissionChecks = $state<Record<string, boolean>>({});
  let selectedUser: (typeof data.users)[number] | null = $state(null);
  let removeOpen = $state(false);
  let userToRemove: (typeof data.users)[number] | null = $state(null);

  type User = (typeof data.users)[number];
  const column = createColumnHelper<DataTableFeatures, User>();
  const columns = column.columns([
    column.accessor(
      ({ name, email, username, groups }) =>
        [name, email, username ?? '', ...groups].join(' '),
      {
        id: 'search',
        header: 'Name',
        filterFn: 'includesString',
        cell: ({ row }) => renderSnippet(userName, row.original),
      },
    ),
    column.accessor('email', { header: 'Email' }),
    column.accessor(({ username }) => username ?? '—', {
      id: 'username',
      header: 'Username',
    }),
    column.accessor(({ groups }) => groups.length ? groups.join(', ') : '—', {
      id: 'groups',
      header: 'Groups',
    }),
    column.display({
      id: 'actions',
      header: () => renderSnippet(actionsHeader),
      cell: ({ row }) => renderSnippet(userActions, row.original),
    }),
  ]);

  $effect(() => {
    const created = data.created;
    const removed = data.removed;
    untrack(() => {
      if (created) toast.success('User account created.');
      else if (removed) toast.success('User account removed.');
    });
  });

  function assignGroups(user: (typeof data.users)[number]) {
    selectedUser = user;
    groupsOpen = true;
  }

  function assignPermissions(user: (typeof data.users)[number]) {
    selectedUser = user;
    const directPermissions = user.directPermissions.includes('sudo')
      ? ['sudo']
      : user.directPermissions;
    permissionChecks = Object.fromEntries(
      data.permissions.map((permission) => [
        permission.key,
        user.isAdmin
          ? permission.key === 'sudo'
          : directPermissions.includes(permission.key),
      ]),
    );
    permissionsOpen = true;
  }

  function confirmRemove(user: (typeof data.users)[number]) {
    userToRemove = user;
    removeOpen = true;
  }

  function changePermission(key: string, checked: boolean) {
    permissionChecks[key] = checked;
    if (key === 'sudo' && checked) {
      for (const permission of data.permissions) {
        if (permission.key !== 'sudo') permissionChecks[permission.key] = false;
      }
    }
  }

  function saveAssignment(
    message: string,
    setSaving: (saving: boolean) => void,
    close: () => void,
  ): SubmitFunction {
    return () => {
      setSaving(true);
      return async ({ result, update }) => {
        try {
          await update();
          if (result.type === "success") {
            close();
            toast.success(message);
          } else {
            notifyFormResult(result, {});
          }
        } finally {
          setSaving(false);
        }
      };
    };
  }
</script>

<svelte:head>
  <title>Users | CBP</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="users-heading">
  <header class="flex flex-wrap items-center justify-between gap-4">
    <h1 id="users-heading" class="font-heading text-xl font-semibold">Users</h1>
    {#if data.canManageUsers}
      <Button href={resolve("/users/new")}>Create user</Button>
    {/if}
  </header>

  <div class="mt-6">
    <DataTable
      caption="User accounts"
      {columns}
      data={data.users}
      rowKey={(user) => user.id}
      rowHeader="search"
      filter={{ column: 'search', label: 'Search users' }}
      emptyMessage={data.users.length
        ? 'No users match your search.'
        : 'No user accounts yet.'}
      tableClass="min-w-[52rem]"
    />
  </div>

  <AlertDialog.Root bind:open={removeOpen}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Remove user?</AlertDialog.Title>
        <AlertDialog.Description class="wrap-anywhere">
          {#if userToRemove}
            Remove {userToRemove.email} from CBP and sign them out of all sessions.
          {/if}
        </AlertDialog.Description>
      </AlertDialog.Header>
      {#if userToRemove}
        <form method="POST" action="?/remove" use:enhance={() => async ({ result, update }) => { await update(); notifyFormResult(result, {}); }}>
          <input type="hidden" name="userId" value={userToRemove.id} />
          <AlertDialog.Footer>
            <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
            <AlertDialog.Action type="submit" variant="destructive">Remove user</AlertDialog.Action>
          </AlertDialog.Footer>
        </form>
      {/if}
    </AlertDialog.Content>
  </AlertDialog.Root>

  <Dialog.Root bind:open={groupsOpen}>
    <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      <Dialog.Header>
        <Dialog.Title>Add user to groups</Dialog.Title>
        <Dialog.Description>
          {#if selectedUser}
            Select every group {selectedUser.name} should belong to. Saving replaces their group assignments.
          {/if}
        </Dialog.Description>
      </Dialog.Header>
      {#if selectedUser}
        <form
          method="POST"
          action="?/assignGroups"
          use:enhance={saveAssignment("User groups updated.", (value) => (savingGroups = value), () => (groupsOpen = false))}
        >
          <input type="hidden" name="userId" value={selectedUser.id} />
          <Field.FieldSet>
            <Field.FieldLegend variant="label">Groups</Field.FieldLegend>
            {#if data.groups.length}
              <div class="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
                {#each data.groups as group (group.id)}
                  <Field.Field orientation="horizontal">
                    <Checkbox
                      id={`user-${selectedUser.id}-group-${group.id}`}
                      name="groupId"
                      value={String(group.id)}
                      checked={selectedUser.groupIds.includes(group.id)}
                    />
                    <Field.FieldLabel for={`user-${selectedUser.id}-group-${group.id}`} class="font-normal">
                      {group.name}
                    </Field.FieldLabel>
                  </Field.Field>
                {/each}
              </div>
            {:else}
              <Field.FieldDescription>
                No groups exist yet. <a class="underline underline-offset-4" href={resolve("/groups")}>Create a group</a> first.
              </Field.FieldDescription>
            {/if}
          </Field.FieldSet>
          <Dialog.Footer class="mt-5">
            <Dialog.Close>
              {#snippet child({ props })}<Button {...props} type="button" variant="outline">Cancel</Button>{/snippet}
            </Dialog.Close>
            <Button type="submit" disabled={savingGroups}>{savingGroups ? "Saving…" : "Save groups"}</Button>
          </Dialog.Footer>
        </form>
      {/if}
    </Dialog.Content>
  </Dialog.Root>

  <Dialog.Root bind:open={permissionsOpen}>
    <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
      <Dialog.Header>
        <Dialog.Title>Assign user permissions</Dialog.Title>
        <Dialog.Description>
          {#if selectedUser}
            {#if selectedUser.isAdmin}
              Sudo is managed by CBP_ADMIN_EMAILS and cannot be changed here.
            {:else}
              Direct permissions for {selectedUser.name} combine with permissions inherited from groups. Sudo grants full administrator access.
            {/if}
          {/if}
        </Dialog.Description>
      </Dialog.Header>
      {#if selectedUser}
        <form
          method="POST"
          action="?/assignPermissions"
          use:enhance={saveAssignment("User permissions updated.", (value) => (savingPermissions = value), () => (permissionsOpen = false))}
        >
          <input type="hidden" name="userId" value={selectedUser.id} />
          <Field.FieldSet>
            <Field.FieldLegend variant="label">Permissions</Field.FieldLegend>
            <div class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {#each data.permissions as permission (permission.key)}
                <Field.Field orientation="horizontal" class="items-start">
                  <Checkbox
                    id={`user-${selectedUser.id}-${permission.key}`}
                    name="permission"
                    value={permission.key}
                    checked={permissionChecks[permission.key]}
                    onCheckedChange={(checked) => changePermission(permission.key, checked === true)}
                    disabled={selectedUser.isAdmin || (permission.key !== 'sudo' && permissionChecks.sudo)}
                  />
                  <Field.FieldLabel for={`user-${selectedUser.id}-${permission.key}`} class="grid gap-1 font-normal">
                    <span class="font-medium">{permission.label}</span>
                    <span class="text-xs text-muted-foreground">
                      {permission.description}
                      {#if selectedUser.permissions.includes(permission.key) && !selectedUser.directPermissions.includes(permission.key)}
                        <span class="text-primary"> Granted through a group.</span>
                      {/if}
                    </span>
                  </Field.FieldLabel>
                </Field.Field>
              {/each}
            </div>
          </Field.FieldSet>
          <Dialog.Footer class="mt-5">
            <Dialog.Close>
              {#snippet child({ props })}<Button {...props} type="button" variant="outline">Cancel</Button>{/snippet}
            </Dialog.Close>
            <Button type="submit" disabled={savingPermissions || selectedUser.isAdmin}>{savingPermissions ? "Saving…" : "Save permissions"}</Button>
          </Dialog.Footer>
        </form>
      {/if}
    </Dialog.Content>
  </Dialog.Root>
</section>

{#snippet userName(user: User)}
  <div class="flex items-center gap-2">
    <span>{user.name}</span>
    {#if user.isAdmin || user.isSudo}<Badge variant="secondary">Sudo</Badge>{/if}
  </div>
{/snippet}

{#snippet actionsHeader()}
  <span class="block text-right">Actions</span>
{/snippet}

{#snippet userActions(user: User)}
  <div class="flex justify-end">
    {#if data.canManageGroups || data.canManagePermissions || (data.canManageUsers && !user.isCurrentUser)}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${user.name}`}
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-44">
          {#if data.canManageGroups || data.canManagePermissions}
            <DropdownMenu.Group>
              {#if data.canManageGroups}
                <DropdownMenu.Item onSelect={() => assignGroups(user)}>
                  Add to groups
                </DropdownMenu.Item>
              {/if}
              {#if data.canManagePermissions}
                <DropdownMenu.Item onSelect={() => assignPermissions(user)}>
                  Permissions
                </DropdownMenu.Item>
              {/if}
            </DropdownMenu.Group>
          {/if}
          {#if data.canManageUsers && !user.isCurrentUser}
            <DropdownMenu.Separator />
            <DropdownMenu.Group>
              <DropdownMenu.Item
                variant="destructive"
                onSelect={() => confirmRemove(user)}
              >Remove</DropdownMenu.Item>
            </DropdownMenu.Group>
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>
{/snippet}
