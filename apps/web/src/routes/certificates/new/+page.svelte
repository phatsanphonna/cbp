<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { toast } from 'svelte-sonner';
  import CertificateChainFields from '#lib/components/svelte/certificate-chain-fields.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import { Field, FieldDescription, FieldGroup, FieldLabel } from '#lib/components/ui/field/index.ts';
  import { Spinner } from '#lib/components/ui/spinner/index.ts';
  import * as Tabs from '#lib/components/ui/tabs/index.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  let issuing = $state(false);
  const registration = resolve('/certificates/new');
  const issuance = registration + '?method=letsencrypt';
</script>

<svelte:head>
  <title>Register certificate | Certified by Pat</title>
</svelte:head>

<section
  class="w-full flex-1 px-5 py-6 md:px-8"
  aria-labelledby="register-heading"
>
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="grid gap-1">
      <h1 id="register-heading" class="font-heading text-xl font-semibold">
        Register certificate
      </h1>
      <p class="text-xs text-muted-foreground">
        Upload an existing certificate or request a new one from Let’s Encrypt.
      </p>
    </div>
    <Button href={resolve("/certificates")} variant="outline"
      >Back to certificates</Button
    >
  </header>

  {#snippet feedback()}
    {#if form?.message}
      <p role="alert" class="text-xs text-destructive">{form.message}</p>
    {/if}
  {/snippet}

  <Tabs.Root
    class="mt-6"
    value={data.issue ? 'letsencrypt' : 'upload'}
    onValueChange={(method) => {
      void goto(method === 'letsencrypt' ? issuance : registration, { keepFocus: true, noScroll: true });
    }}
  >
    <Tabs.List aria-label="Certificate registration method">
      <Tabs.Trigger value="upload">Upload certificate</Tabs.Trigger>
      <Tabs.Trigger value="letsencrypt">Create with Let’s Encrypt</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="letsencrypt">
      <form
        class="mt-3 border p-4 sm:p-5"
        method="POST"
        action={issuance}
        aria-busy={issuing}
        use:enhance={() => {
          issuing = true;
          return async ({ result, update }) => {
            try {
              if (result.type === 'failure' && typeof result.data?.message === 'string') {
                toast.error(result.data.message);
                return;
              }
              await update();
            } finally {
              issuing = false;
            }
          };
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel for="issuance-hostnames">DNS hostnames</FieldLabel>
            <textarea
              id="issuance-hostnames"
              name="hostnames"
              value={form?.hostnames ?? ''}
              required
              maxlength={25400}
              rows={4}
              spellcheck={false}
              autocomplete="off"
              autocapitalize="none"
              placeholder="example.com"
              aria-describedby="issuance-hostnames-help"
              class="w-full resize-y border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"
            ></textarea>
            <FieldDescription id="issuance-hostnames-help">
              Enter one public DNS hostname per line. Each hostname must forward
              <code>/.well-known/acme-challenge/</code> on port 80 to this app.
            </FieldDescription>
          </Field>
          {#if !data.renewalAvailable}
            <p class="text-xs text-muted-foreground">
              Set <code>CBP_LETS_ENCRYPT_EMAIL</code> on the server and restart the app to enable issuance.
            </p>
          {:else}
            <p class="text-xs text-muted-foreground">
              Successful issuance registers the certificate and enables automatic renewal.
            </p>
          {/if}
          {@render feedback()}
          <div class="flex justify-end">
            <Button type="submit" disabled={issuing || !data.renewalAvailable}>
              {#if issuing}
                <Spinner data-icon="inline-start" aria-hidden="true" class="motion-reduce:animate-none" />
                Requesting certificate
              {:else}
                Create certificate
              {/if}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </Tabs.Content>
    <Tabs.Content value="upload">
      <form class="mt-3 border p-4 sm:p-5" method="POST" action={registration} enctype="multipart/form-data">
        <FieldGroup>
          <CertificateChainFields />
          {@render feedback()}
          <div class="flex justify-end">
            <Button type="submit">Register certificate</Button>
          </div>
        </FieldGroup>
      </form>
    </Tabs.Content>
  </Tabs.Root>
</section>
