<script lang="ts">
  import { Download } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as CodeBlock from '#lib/components/ui/code-block/index.ts';
  import * as Select from '#lib/components/ui/select/index.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let arch = $state('');
  const selected = $derived(data.downloads.find(({ id }) => id === arch) ?? data.downloads[0]);
  const installCommand = 'sudo install -D -T -o root -g root -m 0755 -- ./cbp-agent-linux /usr/local/bin/cbp-agent';
</script>

<svelte:head>
  <title>Download Linux agent | Certified by Pat</title>
</svelte:head>

<section class="grid max-w-2xl gap-4 px-5 py-6 md:px-8" aria-labelledby="agent-download-heading">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 id="agent-download-heading" class="font-heading text-xl font-semibold">Download Linux agent</h1>
    <Button href={resolve('/hosts')} variant="outline" size="sm">Back to hosts</Button>
  </div>
  {#if selected}
    <p class="text-sm text-muted-foreground">
      Run <code>uname -m</code> on the Linux host to check its architecture.
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <Select.Root type="single" value={selected.id} onValueChange={(value) => (arch = value)}>
        <Select.Trigger aria-label="Target platform">{selected.label}</Select.Trigger>
        <Select.Content>
          <Select.Group>
            {#each data.downloads as { id, label } (id)}
              <Select.Item value={id} {label} />
            {/each}
          </Select.Group>
        </Select.Content>
      </Select.Root>
      <Button href={resolve('/api/agent-download/[arch]', { arch: selected.id })} download>
        <Download data-icon="inline-start" aria-hidden="true" /> Download
      </Button>
    </div>
  {:else}
    <p class="text-sm text-muted-foreground">No Linux agent builds are available on this server.</p>
  {/if}

  <section class="grid gap-3 border-t pt-4" aria-labelledby="agent-install-heading">
    <h2 id="agent-install-heading" class="text-sm font-medium">Install and enroll</h2>
    <ol class="grid list-decimal gap-3 pl-5 text-sm">
      <li>Copy <code>cbp-agent-linux</code> to the Linux host. From the directory containing it, run the install command.</li>
      <li>In CBP, open the host's <strong>Agent enrollment</strong> panel and select <strong>Generate enrollment code</strong>.</li>
      <li>If the panel offers a controller CA download, copy that file to the path shown in the panel. Run the generated enrollment command as root on the Linux host.</li>
      <li>Run <code>sudo systemctl status cbp-agent</code> and confirm that CBP shows a recent agent check-in.</li>
    </ol>
    <CodeBlock.Root size="sm">
      <CodeBlock.Header>
        <CodeBlock.Title>Linux install command</CodeBlock.Title>
        <CodeBlock.Actions>
          <CodeBlock.CopyButton value={installCommand} aria-label="Copy Linux install command" />
        </CodeBlock.Actions>
      </CodeBlock.Header>
      <CodeBlock.Content code={installCommand} wrap aria-label="Linux install command" />
    </CodeBlock.Root>
    <a href={resolve('/docs/agent')} class="justify-self-start text-xs text-primary underline underline-offset-4">
      Agent setup documentation
    </a>
  </section>
</section>
