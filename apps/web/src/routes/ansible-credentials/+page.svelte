<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import { KeyRound, Plus } from '@lucide/svelte';
  import { createColumnHelper, renderSnippet } from '@tanstack/svelte-table';
  import { toast } from 'svelte-sonner';
  import FormSelect from '#lib/components/svelte/form-select.svelte';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Dialog from '#lib/components/ui/dialog/index.ts';
  import { Field, FieldDescription, FieldGroup, FieldLabel } from '#lib/components/ui/field/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import DataTable from '#lib/components/svelte/data-table.svelte';
  import type { DataTableFeatures } from '#lib/components/svelte/data-table-features.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let createOpen = $state(false);
  let saving = $state(false);
  let method = $state('sudo');
  let bindOpen = $state(false);
  let bindProfile = $state<{ id: string; name: string } | null>(null);
  let hostId = $state('');
  let binding = $state(false);
  type Profile = PageProps['data']['profiles'][number];
  const column = createColumnHelper<DataTableFeatures, Profile>();
  const columns = column.columns([
    column.accessor('name', { header: 'Credential', cell: ({ row }) => renderSnippet(credentialName, row.original) }),
    column.accessor('createdAt', { header: 'Created', cell: ({ row }) => renderSnippet(createdDate, row.original) }),
    column.display({ id: 'actions', header: () => renderSnippet(actionsHeader), cell: ({ row }) => renderSnippet(credentialActions, row.original) }),
  ]);
</script>

<svelte:head>
  <title>Ansible credentials | CBP</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="credentials-heading">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="grid gap-1">
      <h1 id="credentials-heading" class="font-heading text-xl font-semibold">
        Ansible credentials
      </h1>
      <p class="max-w-2xl text-xs text-muted-foreground">
        Manage SSH credentials and bind them to your Ansible hosts for deployments.
      </p>
    </div>
    {#if data.available}
      <Button onclick={() => { createOpen = true; }}>
        <Plus data-icon="inline-start" aria-hidden="true" /> Add credential
      </Button>
    {/if}
  </header>

  {#if !data.available}
    <p class="mt-6 text-sm text-destructive" role="alert">
      Vault is unavailable or the connection is not trusted. Check your Vault configuration and connection.
    </p>
  {:else}
    <section class="mt-6" aria-label="Saved credentials">
      <div class="mb-3 flex justify-end">
        <a href={resolve('/hosts')} class="text-xs text-primary underline underline-offset-4">View hosts</a>
      </div>

      <DataTable caption="Saved Ansible credentials" {columns} data={data.profiles} rowKey={(profile) => profile.id} rowHeader="name" filter={{ column: 'name', label: 'Search credentials' }} emptyMessage={data.profiles.length ? 'No credentials match your search.' : 'No credentials saved yet.'} />
    </section>
  {/if}
</section>

{#snippet credentialName(profile: Profile)}
  <span class="flex items-center gap-2"><KeyRound size={14} class="shrink-0 text-muted-foreground" aria-hidden="true" />{profile.name}</span>
{/snippet}

{#snippet createdDate(profile: Profile)}
  {#if profile.createdAt}<time datetime={profile.createdAt}>{profile.createdLabel}</time>{:else}<span class="text-muted-foreground">—</span>{/if}
{/snippet}

{#snippet actionsHeader()}<span class="block text-right">Actions</span>{/snippet}

{#snippet credentialActions(profile: Profile)}
  <div class="flex justify-end gap-2">
    <Button variant="outline" size="sm" onclick={() => { bindProfile = profile; hostId = ''; bindOpen = true; }}>Bind to host</Button>
    <AlertDialog.Root>
      <AlertDialog.Trigger>
        {#snippet child({ props })}<Button {...props} variant="destructive" size="sm" aria-label={`Delete ${profile.name}`}>Delete</Button>{/snippet}
      </AlertDialog.Trigger>
      <AlertDialog.Content>
        {#if profile.boundHosts.length}
          <AlertDialog.Header>
            <AlertDialog.Title>Credential is bound to hosts</AlertDialog.Title>
            <AlertDialog.Description class="wrap-anywhere">Unbind {profile.name} from these hosts before deleting it.</AlertDialog.Description>
          </AlertDialog.Header>
          <ul class="grid max-h-48 gap-2 overflow-y-auto text-sm">
            {#each profile.boundHosts as host (host.id)}
              <li class="flex items-center justify-between gap-3">
                <a href={resolve('/hosts/[id]', { id: host.id })} class="text-primary underline underline-offset-4 wrap-anywhere">{host.name}</a>
                <form method="POST" action="?/unbind" use:enhance={() => async ({ result, update }) => {
                  await update();
                  if (result.type === 'success' && typeof result.data?.success === 'string') toast.success(result.data.success);
                  else if (result.type === 'failure' && typeof result.data?.message === 'string') toast.error(result.data.message);
                }}>
                  <input type="hidden" name="id" value={profile.id} />
                  <input type="hidden" name="hostId" value={host.id} />
                  <Button type="submit" variant="outline" size="sm" aria-label={`Unbind ${profile.name} from ${host.name}`}>Unbind</Button>
                </form>
              </li>
            {/each}
          </ul>
          <AlertDialog.Footer>
            <AlertDialog.Cancel type="button">Close</AlertDialog.Cancel>
          </AlertDialog.Footer>
        {:else}
          <AlertDialog.Header>
            <AlertDialog.Title>Delete credential?</AlertDialog.Title>
            <AlertDialog.Description class="wrap-anywhere">Delete {profile.name} from Vault.</AlertDialog.Description>
          </AlertDialog.Header>
          <form method="POST" action="?/remove" use:enhance={() => async ({ result, update }) => {
            await update();
            if (result.type === 'success' && typeof result.data?.success === 'string') toast.success(result.data.success);
            else if (result.type === 'failure' && typeof result.data?.message === 'string') toast.error(result.data.message);
          }}>
            <input type="hidden" name="id" value={profile.id} />
            <AlertDialog.Footer>
              <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
              <AlertDialog.Action type="submit" variant="destructive">Delete credential</AlertDialog.Action>
            </AlertDialog.Footer>
          </form>
        {/if}
      </AlertDialog.Content>
    </AlertDialog.Root>
  </div>
{/snippet}

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Add Ansible credential</Dialog.Title>
      <Dialog.Description>
        Enter the SSH login and privilege settings for your hosts. Passwords are stored in Vault.
      </Dialog.Description>
    </Dialog.Header>
    <form method="POST" action="?/create" use:enhance={() => {
      saving = true;
      return async ({ result, update }) => {
        try {
          await update();
          if (result.type === 'success') {
            createOpen = false;
            method = 'sudo';
            if (typeof result.data?.success === 'string') toast.success(result.data.success);
          } else if (result.type === 'failure' && typeof result.data?.message === 'string') {
            toast.error(result.data.message);
          }
        } finally {
          saving = false;
        }
      };
    }}>
      <FieldGroup>
        <Field>
          <FieldLabel for="credential-name" required>Credential name</FieldLabel>
          <Input id="credential-name" name="name" maxlength={100} placeholder="e.g. Production web servers" required />
          <FieldDescription>Choose a name that helps you identify where it is used.</FieldDescription>
        </Field>
        <FieldGroup class="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel for="credential-username" required>SSH username</FieldLabel>
            <Input id="credential-username" name="sshUsername" autocomplete="username" maxlength={256} required />
          </Field>
          <Field>
            <FieldLabel for="credential-password" required>SSH password</FieldLabel>
            <Input id="credential-password" name="sshPassword" type="password" autocomplete="new-password" maxlength={1024} required />
          </Field>
          <Field>
            <FieldLabel for="credential-method" required>Become method</FieldLabel>
            <FormSelect id="credential-method" name="becomeMethod" bind:value={method} items={[{ value: 'sudo', label: 'sudo' }, { value: 'su', label: 'su' }]} required />
          </Field>
          <Field>
            <FieldLabel for="credential-su" required={method === 'su'}>Root su password</FieldLabel>
            <Input id="credential-su" name="suPassword" type="password" autocomplete="new-password" maxlength={1024} disabled={method !== 'su'} required={method === 'su'} />
          </Field>
        </FieldGroup>
        <Dialog.Footer>
          <Dialog.Close>
            {#snippet child({ props })}<Button {...props} type="button" variant="outline">Cancel</Button>{/snippet}
          </Dialog.Close>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save credential'}</Button>
        </Dialog.Footer>
      </FieldGroup>
    </form>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={bindOpen}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Bind credential to host</Dialog.Title>
      <Dialog.Description>
        Choose an Ansible-managed host for {bindProfile?.name}. This replaces any credential already bound to that host.
      </Dialog.Description>
    </Dialog.Header>
    {#if data.hosts.length && bindProfile}
      <form method="POST" action="?/bind" use:enhance={() => {
        binding = true;
        return async ({ result, update }) => {
          try {
            await update();
            if (result.type === 'success' && typeof result.data?.bindMessage === 'string') {
              bindOpen = false;
              toast.success(result.data.bindMessage);
            } else if (result.type === 'failure' && typeof result.data?.message === 'string') {
              toast.error(result.data.message);
            }
          } finally {
            binding = false;
          }
        };
      }}>
        <input type="hidden" name="id" value={bindProfile.id} />
        <FieldGroup>
          <Field>
            <FieldLabel for="credential-host" required>Host</FieldLabel>
            <FormSelect id="credential-host" name="hostId" items={data.hosts} bind:value={hostId} placeholder="Choose a host" required />
          </Field>
          <Dialog.Footer>
            <Dialog.Close>
              {#snippet child({ props })}<Button {...props} type="button" variant="outline">Cancel</Button>{/snippet}
            </Dialog.Close>
            <Button type="submit" disabled={binding || !hostId}>{binding ? 'Binding…' : 'Bind credential'}</Button>
          </Dialog.Footer>
        </FieldGroup>
      </form>
    {:else}
      <p class="text-sm text-muted-foreground">No Ansible-managed hosts are available. <a href={resolve('/hosts')} class="text-primary underline underline-offset-4">View hosts</a></p>
    {/if}
  </Dialog.Content>
</Dialog.Root>
