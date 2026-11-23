<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Card from '#lib/components/ui/card/index.ts';
  import { Field, FieldLabel } from '#lib/components/ui/field/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Groups | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="groups-heading">
  <header class="grid gap-1">
    <h1 id="groups-heading" class="font-heading text-xl font-semibold">Groups</h1>
    <p class="text-xs text-muted-foreground">Organize users into teams responsible for certificates.</p>
  </header>

  <form method="POST" action="?/create" class="mt-6 flex flex-wrap items-end gap-3 border p-4">
    <Field class="w-full sm:w-72">
      <FieldLabel for="group-name">Group name</FieldLabel>
      <Input id="group-name" name="name" placeholder="Platform team" required maxlength={80} />
    </Field>
    <Button type="submit">Create group</Button>
  </form>
  {#if form?.message}
    <p role="alert" class="mt-3 text-xs text-destructive">{form.message}</p>
  {/if}

  <div class="mt-6 grid gap-4 lg:grid-cols-2">
    {#each data.groups as group (group.id)}
      {@const memberIds = new Set(data.members.filter((member) => member.groupId === group.id).map((member) => member.userId))}
      {@const members = data.users.filter((user) => memberIds.has(user.id))}
      {@const available = data.users.filter((user) => !memberIds.has(user.id))}
      <Card.Root class="min-w-0">
        <Card.Header>
          <Card.Title class="wrap-anywhere">{group.name}</Card.Title>
          <Card.Description>{members.length} {members.length === 1 ? 'member' : 'members'}</Card.Description>
        </Card.Header>
        <Card.Content class="grid gap-4">
          {#if members.length}
            <ul class="divide-y divide-border border">
              {#each members as member (member.id)}
                <li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                  <div class="min-w-0 wrap-anywhere">
                    <p class="font-medium">{member.name}</p>
                    <p class="text-muted-foreground">{member.email}</p>
                  </div>
                  <form method="POST" action="?/removeMember">
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="userId" value={member.id} />
                    <Button type="submit" variant="ghost" size="sm" aria-label={`Remove ${member.name} from ${group.name}`}>Remove</Button>
                  </form>
                </li>
              {/each}
            </ul>
          {/if}
          {#if available.length}
            <form method="POST" action="?/addMember" class="flex flex-wrap items-end gap-2">
              <input type="hidden" name="groupId" value={group.id} />
              <Field class="min-w-0 flex-1">
                <FieldLabel for="member-{group.id}">Account</FieldLabel>
                <select id="member-{group.id}" name="userId" class="h-8 w-full border border-input bg-background px-2 text-xs" required>
                  <option value="">Select an account</option>
                  {#each available as user (user.id)}
                    <option value={user.id}>{user.name} ({user.email})</option>
                  {/each}
                </select>
              </Field>
              <Button type="submit" variant="outline">Add member</Button>
            </form>
          {/if}
        </Card.Content>
      </Card.Root>
    {:else}
      <p class="border p-4 text-xs text-muted-foreground lg:col-span-2">No groups yet. Create a group to assign certificates to a team.</p>
    {/each}
  </div>
</section>
