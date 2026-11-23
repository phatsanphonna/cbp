<script lang="ts">
  import { resolve } from '$app/paths';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>Audit log | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="audit-heading">
  <h1 id="audit-heading" class="font-heading text-xl font-semibold">Audit log</h1>
  <p class="mt-1 text-xs text-muted-foreground">Web submissions and sign-in attempts.</p>
  <div class="mt-6 border">
    <Table.Root>
      <Table.Caption class="sr-only">User actions</Table.Caption>
      <Table.Header class="bg-muted">
        <Table.Row>
          <Table.Head scope="col">Time</Table.Head>
          <Table.Head scope="col">User</Table.Head>
          <Table.Head scope="col">Action</Table.Head>
          <Table.Head scope="col">Target</Table.Head>
          <Table.Head scope="col">Result</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.entries as entry (entry.id)}
          <Table.Row>
            <Table.Cell><time datetime={entry.iso}>{entry.time}</time></Table.Cell>
            <Table.Cell>{entry.actorName ?? 'Unauthenticated'}</Table.Cell>
            <Table.Head scope="row">{entry.action}</Table.Head>
            <Table.Cell>
              <span>{entry.route}</span>
              {#if entry.targetId}<span class="block text-muted-foreground">{entry.targetId}</span>{/if}
            </Table.Cell>
            <Table.Cell>
              <Badge variant={entry.status >= 400 ? 'destructive' : 'secondary'}>
                {entry.status >= 400 ? 'Failed' : 'Succeeded'} ({entry.status})
              </Badge>
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row><Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">No audit events on this page.</Table.Cell></Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
  {#if data.page > 1 || data.hasNext}
    <nav aria-label="Audit log pages" class="mt-4 flex items-center justify-end gap-2">
      {#if data.page > 1}
        <Button href={`${resolve('/audit')}?page=${data.page - 1}`} variant="outline" size="sm">Previous</Button>
      {/if}
      <span class="px-2 text-xs text-muted-foreground">Page {data.page}</span>
      {#if data.hasNext}
        <Button href={`${resolve('/audit')}?page=${data.page + 1}`} variant="outline" size="sm">Next</Button>
      {/if}
    </nav>
  {/if}
</section>
