<script lang="ts">
  import { resolve } from '$app/paths';
  import { Button } from '#lib/components/ui/button/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const providers = {
    Slack: { label: 'Slack channel', placeholder: '#certificate-ops' },
    LINE: { label: 'LINE group', placeholder: 'Infrastructure team' },
    Telegram: { label: 'Telegram chat', placeholder: '@certificate_ops' },
    Email: { label: 'Email address', placeholder: 'ops@example.test' },
    Webhook: { label: 'Endpoint label', placeholder: 'Operations event receiver' }
  };
  type Provider = keyof typeof providers;
  let provider = $state<Provider>('Slack');
</script>

<svelte:head>
  <title>Notification channels | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="channels-heading">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="grid gap-1">
      <h1 id="channels-heading" class="font-heading text-xl font-semibold">Notification channels</h1>
      <p class="text-xs text-muted-foreground">Choose where certificate and host alerts should go.</p>
    </div>
    <Button href={resolve('/alerts')} variant="outline">Back to alerts</Button>
  </header>

  <p class="mt-4 text-xs text-muted-foreground">Notification delivery is pending provider integration.</p>
  {#if form?.message}
    <p class="mt-3 text-xs text-destructive" role="alert">{form.message}</p>
  {/if}

  <form class="mt-6 grid gap-4 border p-4 sm:grid-cols-2 xl:grid-cols-[1fr_2fr_1fr_auto] xl:items-end" method="POST" action="?/add">
    <label class="grid gap-2 text-xs">
      Provider
      <select name="provider" class="h-8 w-full border border-input bg-background px-2" bind:value={provider}>
        {#each Object.keys(providers) as option (option)}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </label>

    <label class="grid gap-2 text-xs">
      {providers[provider].label}
      <Input name="destination" type={provider === 'Email' ? 'email' : 'text'} placeholder={providers[provider].placeholder} required maxlength={120} />
    </label>

    <label class="grid gap-2 text-xs">
      Minimum severity
      <select name="severity" class="h-8 w-full border border-input bg-background px-2">
        <option>Info</option>
        <option selected>Warning</option>
        <option>High</option>
        <option>Critical</option>
      </select>
    </label>

    <Button type="submit">Add channel</Button>
  </form>

  <div class="mt-6 border">
    <Table.Root>
      <Table.Caption class="sr-only">Configured notification channels</Table.Caption>
      <Table.Header class="bg-muted">
        <Table.Row>
          <Table.Head scope="col">Provider</Table.Head>
          <Table.Head scope="col">Destination</Table.Head>
          <Table.Head scope="col">Minimum severity</Table.Head>
          <Table.Head scope="col">Status</Table.Head>
          <Table.Head scope="col" class="text-right">Action</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.channels as channel (channel.id)}
          <Table.Row>
            <Table.Cell>{channel.provider}</Table.Cell>
            <Table.Head scope="row">{channel.destination}</Table.Head>
            <Table.Cell>{channel.severity}</Table.Cell>
            <Table.Cell>{channel.enabled ? 'Enabled' : 'Paused'}</Table.Cell>
            <Table.Cell class="text-right">
              <form method="POST" action="?/setEnabled">
                <input type="hidden" name="id" value={channel.id} />
                <input type="hidden" name="enabled" value={String(!channel.enabled)} />
                <Button type="submit" variant="ghost" size="sm" aria-label={channel.enabled ? `Pause ${channel.destination}` : `Enable ${channel.destination}`}>
                  {channel.enabled ? 'Pause' : 'Enable'}
                </Button>
              </form>
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row><Table.Cell colspan={5} class="py-8 text-center text-muted-foreground">No notification channels configured.</Table.Cell></Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</section>
