<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import FormSelect from '#lib/components/svelte/form-select.svelte';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import { Field, FieldLabel } from '#lib/components/ui/field/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  type Entry = PageProps['data']['entries'][number];

  const actionItems = $derived([
    { value: 'any', label: 'All actions' },
    ...data.actions.map((action) => ({ value: action, label: action })),
  ]);
  const resultItems = [
    { value: 'any', label: 'All results' },
    { value: 'succeeded', label: 'Succeeded' },
    { value: 'failed', label: 'Any failure' },
    { value: 'denied', label: 'Denied' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'error', label: 'Error' },
  ];
  const results = {
    succeeded: { label: 'Succeeded', variant: 'secondary' },
    rejected: { label: 'Rejected', variant: 'outline' },
    denied: { label: 'Denied', variant: 'destructive' },
    error: { label: 'Error', variant: 'destructive' },
  } as const;
  const filtered = $derived(Object.values(data.filters).some(Boolean));

  function targetHref({ kind, id, name, removed }: NonNullable<Entry['target']>) {
    if (removed) return;
    switch (kind) {
      case 'certificate':
        return resolve('/certificates/[id]', { id });
      case 'host':
        return resolve('/hosts/[id]', { id });
      case 'run':
        return resolve('/deployments/[id]', { id: name ?? id });
      case 'user':
        return resolve('/users');
      case 'group':
        return resolve('/groups');
      case 'channel':
        return resolve('/alerts/channels');
      case 'alert':
        return resolve('/alerts');
      case 'credential':
        return resolve('/ansible-credentials');
    }
  }

  function pageHref(target: number) {
    const params = new URLSearchParams(page.url.search);
    params.set('page', String(target));
    return `${resolve('/audit')}?${params}`;
  }
</script>

<svelte:head>
  <title>Audit log | CBP</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="audit-heading">
  <header class="grid gap-1">
    <h1 id="audit-heading" class="font-heading text-xl font-semibold">Audit log</h1>
    <p class="text-xs text-muted-foreground">
      Changes made in the web app and sign-in attempts, newest first.
    </p>
  </header>

  <form
    method="GET"
    class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_10rem_9rem_9rem_auto] lg:items-end"
    aria-label="Filter audit events"
  >
    <Field>
      <FieldLabel for="audit-actor">User</FieldLabel>
      <Input id="audit-actor" name="actor" value={data.filters.actor} placeholder="Name" />
    </Field>
    <Field>
      <FieldLabel for="audit-action">Action</FieldLabel>
      <FormSelect
        id="audit-action"
        name="action"
        items={actionItems}
        value={data.filters.action || 'any'}
      />
    </Field>
    <Field>
      <FieldLabel for="audit-result">Result</FieldLabel>
      <FormSelect
        id="audit-result"
        name="result"
        items={resultItems}
        value={data.filters.result || 'any'}
      />
    </Field>
    <Field>
      <FieldLabel for="audit-from">From</FieldLabel>
      <Input id="audit-from" name="from" type="date" value={data.filters.from} />
    </Field>
    <Field>
      <FieldLabel for="audit-to">To</FieldLabel>
      <Input id="audit-to" name="to" type="date" value={data.filters.to} />
    </Field>
    <div class="flex gap-2">
      <Button type="submit" size="sm">Apply</Button>
      {#if filtered}
        <Button href={resolve('/audit')} variant="outline" size="sm">Clear</Button>
      {/if}
    </div>
  </form>

  <div class="mt-4 overflow-x-auto border">
    <Table.Root class="min-w-[48rem]">
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
          {@const result = results[entry.result]}
          <Table.Row>
            <Table.Cell class="whitespace-nowrap">
              <time datetime={entry.iso}>{entry.time}</time>
            </Table.Cell>
            <Table.Cell>
              {#if entry.actorName}{entry.actorName}{:else}
                <span class="text-muted-foreground">Not signed in</span>
              {/if}
            </Table.Cell>
            <Table.Head scope="row">{entry.action}</Table.Head>
            <Table.Cell>
              {#if entry.target}{@render target(entry.target)}{:else}
                <span class="text-muted-foreground">—</span>
              {/if}
            </Table.Cell>
            <Table.Cell>
              <Badge variant={result.variant} title={`HTTP ${entry.status}`}>{result.label}</Badge>
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row>
            <Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">
              {filtered ? 'No audit events match these filters.' : 'No audit events on this page.'}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
  {#if data.page > 1 || data.hasNext}
    <nav aria-label="Audit log pages" class="mt-4 flex items-center justify-end gap-2">
      {#if data.page > 1}
        <Button href={pageHref(data.page - 1)} variant="outline" size="sm">Previous</Button>
      {/if}
      <span class="px-2 text-xs text-muted-foreground">Page {data.page}</span>
      {#if data.hasNext}
        <Button href={pageHref(data.page + 1)} variant="outline" size="sm">Next</Button>
      {/if}
    </nav>
  {/if}
</section>

{#snippet target(target: NonNullable<Entry['target']>)}
  {@const label = target.name ?? target.id}
  {@const href = targetHref(target)}
  <span class="block text-xs text-muted-foreground">{target.kindLabel}</span>
  {#if href}
    <a {href} class="text-primary underline underline-offset-4 wrap-anywhere">{label}</a>
  {:else}
    <span class="wrap-anywhere">{label}</span>
  {/if}
  {#if target.removed}<span class="text-muted-foreground">(removed)</span>{/if}
{/snippet}
