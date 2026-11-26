<script lang="ts">
  import { resolve } from '$app/paths';
  import { Badge } from '#lib/components/ui/badge/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Renewals | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="renewals-heading">
  <header class="grid gap-1">
    <h1 id="renewals-heading" class="font-heading text-xl font-semibold">Renewals</h1>
    <p class="text-xs text-muted-foreground">
      Renew Let’s Encrypt certificates automatically. Deploy renewed certificates from their certificate pages.
    </p>
  </header>

  {#if !data.renewalAvailable}
    <p class="mt-4 text-sm text-muted-foreground">
      Set <code>CBP_LETS_ENCRYPT_EMAIL</code> on the server to enable renewals.
    </p>
  {/if}

  {#if form?.message}
    <p class="mt-4 text-sm text-destructive" role="alert">{form.message}</p>
  {/if}

  <div class="mt-6">
    <Table.Root>
      <Table.Caption class="sr-only">Let’s Encrypt certificate renewals</Table.Caption>
      <Table.Header>
        <Table.Row>
          <Table.Head>Certificate</Table.Head>
          <Table.Head>Expires</Table.Head>
          <Table.Head>Next attempt</Table.Head>
          <Table.Head>Status</Table.Head>
          {#if data.user?.isAdmin}
            <Table.Head class="text-right">Automatic renewal</Table.Head>
          {/if}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.renewals as certificate (certificate.id)}
          <Table.Row>
            <Table.Cell>
              <a class="text-primary underline underline-offset-4" href={resolve('/certificates/[id]', { id: certificate.id })}>
                {certificate.domain}
              </a>
            </Table.Cell>
            <Table.Cell><time datetime={certificate.expires.iso}>{certificate.expires.label}</time></Table.Cell>
            <Table.Cell>
              {#if certificate.enabled && data.renewalAvailable}
                <time datetime={certificate.nextAttempt.iso}>{certificate.nextAttempt.label}</time>
              {:else}
                <span aria-label="None">—</span>
              {/if}
            </Table.Cell>
            <Table.Cell class="whitespace-normal">
              {#if certificate.lastError && certificate.enabled}
                <Badge variant="destructive">Failed</Badge>
                <p class="mt-1 max-w-xs text-xs text-muted-foreground">{certificate.lastError}</p>
              {:else if certificate.enabled}
                <Badge variant="secondary">{data.renewalAvailable ? 'Enabled' : 'Paused'}</Badge>
              {:else if certificate.eligible}
                <Badge variant="outline">Off</Badge>
              {:else}
                <Badge variant="outline">Ineligible</Badge>
              {/if}
            </Table.Cell>
            {#if data.user?.isAdmin}
              <Table.Cell class="text-right">
                <form method="POST" action={certificate.enabled ? '?/disable' : '?/enable'}>
                  <input type="hidden" name="certificateId" value={certificate.id} />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    aria-label={(certificate.enabled ? 'Disable' : 'Enable') + ' automatic renewal for ' + certificate.domain}
                    disabled={!certificate.enabled && (!certificate.eligible || !data.renewalAvailable)}
                  >
                    {certificate.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </form>
              </Table.Cell>
            {/if}
          </Table.Row>
        {:else}
          <Table.Row>
            <Table.Cell colspan={data.user?.isAdmin ? 5 : 4} class="py-6 text-center text-muted-foreground">
              Register a Let’s Encrypt certificate to manage renewal here.
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</section>
