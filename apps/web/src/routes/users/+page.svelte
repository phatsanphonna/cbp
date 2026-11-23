<script lang="ts">
  import { resolve } from '$app/paths';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Users | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="users-heading">
  <header class="flex flex-wrap items-center justify-between gap-4">
    <h1 id="users-heading" class="font-heading text-xl font-semibold">Users</h1>
    <Button href={resolve('/users/new')}>Create user</Button>
  </header>

  {#if data.created}
    <p role="status" class="mt-4 text-sm">User account created.</p>
  {:else if data.removed}
    <p role="status" class="mt-4 text-sm">User account removed.</p>
  {/if}
  {#if form?.message}
    <p role="alert" class="mt-4 text-sm text-destructive">{form.message}</p>
  {/if}

  <div class="mt-6 border">
    <Table.Root>
      <Table.Caption class="sr-only">User accounts</Table.Caption>
      <Table.Header class="bg-muted">
        <Table.Row>
          <Table.Head scope="col">Name</Table.Head>
          <Table.Head scope="col">Email</Table.Head>
          <Table.Head scope="col">Username</Table.Head>
          <Table.Head scope="col">Access</Table.Head>
          <Table.Head scope="col" class="text-right">Actions</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.users as user (user.id)}
          <Table.Row>
            <Table.Head scope="row">{user.name}</Table.Head>
            <Table.Cell>{user.email}</Table.Cell>
            <Table.Cell>{user.username ?? '—'}</Table.Cell>
            <Table.Cell>{user.isAdmin ? 'Admin' : 'Read-only'}</Table.Cell>
            <Table.Cell class="text-right">
              {#if !user.isCurrentUser}
                <AlertDialog.Root>
                  <AlertDialog.Trigger>
                    {#snippet child({ props })}
                      <Button {...props} variant="outline" size="sm" aria-label={`Remove ${user.email}`}>Remove</Button>
                    {/snippet}
                  </AlertDialog.Trigger>
                  <AlertDialog.Content>
                    <AlertDialog.Header>
                      <AlertDialog.Title>Remove user?</AlertDialog.Title>
                      <AlertDialog.Description class="wrap-anywhere">
                        Remove {user.email} from CBP and sign them out of all sessions.
                      </AlertDialog.Description>
                    </AlertDialog.Header>
                    <form method="POST" action="?/remove">
                      <input type="hidden" name="userId" value={user.id} />
                      <AlertDialog.Footer>
                        <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
                        <AlertDialog.Action type="submit" variant="destructive">Remove user</AlertDialog.Action>
                      </AlertDialog.Footer>
                    </form>
                  </AlertDialog.Content>
                </AlertDialog.Root>
              {/if}
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row>
            <Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">No user accounts yet.</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</section>
