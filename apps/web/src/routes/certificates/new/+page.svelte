<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { toast } from 'svelte-sonner';
  import CertificateChainFields from '#lib/components/svelte/certificate-chain-fields.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
  import { Field, FieldDescription, FieldGroup, FieldLabel } from '#lib/components/ui/field/index.ts';
  import { Spinner } from '#lib/components/ui/spinner/index.ts';
  import * as Tabs from '#lib/components/ui/tabs/index.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  let issuing = $state(false);
  const registration = resolve('/certificates/new');
  const issuance = registration + '?method=letsencrypt';
  const selfSigned = registration + '?method=selfsigned';
  const generated = $derived(
    form && 'generated' in form ? form.generated : null,
  );
  const submittedHostnames = $derived(
    form && 'hostnames' in form ? form.hostnames ?? '' : '',
  );
  const submittedAutoRenew = $derived(
    form && 'autoRenew' in form ? form.autoRenew : false,
  );
  const submittedStorePrivateKey = $derived(
    form && 'storePrivateKey' in form ? form.storePrivateKey : false,
  );
  let autoRenew = $state(false);
  let storePrivateKey = $state(false);
  $effect(() => {
    autoRenew = submittedAutoRenew;
    storePrivateKey = submittedStorePrivateKey;
  });
</script>

<svelte:head>
  <title>Register certificate | CBP</title>
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
        Upload a certificate, request one from Let’s Encrypt, or create a
        self-signed certificate.
      </p>
    </div>
    <Button href={resolve("/certificates")} variant="outline"
      >Back to certificates</Button
    >
  </header>

  <Tabs.Root
    class="mt-6"
    value={data.issue
      ? 'letsencrypt'
      : data.selfSigned
        ? 'selfsigned'
        : 'upload'}
    onValueChange={(method) => {
      const target =
        method === 'letsencrypt'
          ? issuance
          : method === 'selfsigned'
            ? selfSigned
            : registration;
      void goto(target, { keepFocus: true, noScroll: true });
    }}
  >
    <Tabs.List aria-label="Certificate registration method">
      <Tabs.Trigger value="upload">Upload certificate</Tabs.Trigger>
      <Tabs.Trigger value="letsencrypt">Create with Let’s Encrypt</Tabs.Trigger>
      <Tabs.Trigger value="selfsigned">Create self-signed</Tabs.Trigger>
    </Tabs.List>
    {#if generated}
      <section
        class="mt-3 grid gap-3 border border-primary/40 bg-primary/5 p-4 sm:p-5"
        aria-labelledby="generated-certificate-heading"
        role="status"
      >
        <div class="grid gap-1">
          <h2 id="generated-certificate-heading" class="text-sm font-semibold">
            Certificate created for {generated.domain}
          </h2>
          <p class="text-xs text-muted-foreground">
            {#if generated.stored}
              The private key was saved to Vault for deployments. CBP also
              keeps an encrypted copy for renewal. Download a backup below if
              you want a local copy.
            {:else if generated.retained}
              CBP keeps an encrypted copy for renewal. Download a backup of the
              private key now.
            {:else}
              Download and store this private key securely. CBP does not keep a
              copy, and it cannot be recovered later.
            {/if}
            Self-signed certificates are not trusted automatically by browsers
            or clients.
          </p>
          {#if generated.storeError}
            <p class="text-xs text-destructive">{generated.storeError}</p>
          {/if}
        </div>
        <div class="flex flex-wrap gap-2">
          {#if generated.privateKey}
            <Button
              href={`data:application/x-pem-file;charset=utf-8,${encodeURIComponent(generated.privateKey)}`}
              download={`${generated.domain.replace(/^\*\./, 'wildcard.')}.key.pem`}
              >Download private key</Button
            >
          {/if}
          <Button
            href={resolve('/certificates/[id]', {
              id: generated.certificateId,
            })}
            variant="outline">View certificate</Button
          >
        </div>
      </section>
    {/if}
    <Tabs.Content value="selfsigned">
      <form
        class="mt-3 border p-4 sm:p-5"
        method="POST"
        action={selfSigned}
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
              if (result.type === 'success')
                toast.success(
                  'Self-signed certificate created. Download its private key now.',
                );
            } finally {
              issuing = false;
            }
          };
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel for="self-signed-hostnames">DNS hostnames</FieldLabel>
            <textarea
              id="self-signed-hostnames"
              name="hostnames"
              value={submittedHostnames}
              required
              maxlength={25400}
              rows={4}
              spellcheck={false}
              autocomplete="off"
              autocapitalize="none"
              placeholder="internal.example.com"
              aria-describedby="self-signed-hostnames-help"
              class="w-full resize-y border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"
            ></textarea>
            <FieldDescription id="self-signed-hostnames-help">
              Enter up to 100 DNS names, one per line. Internal names and
              wildcards are supported. The certificate is valid for one year.
            </FieldDescription>
          </Field>
          <p class="text-xs text-muted-foreground">
            Browsers and clients will show a trust warning unless you install
            and trust this certificate yourself.
          </p>
          {#if !data.canGenerateSelfSignedCertificate}
            <p class="text-xs text-destructive">
              Use HTTPS or localhost to generate a certificate and receive its
              private key.
            </p>
          {/if}
          <Field orientation="horizontal">
            <Checkbox
              id="self-signed-auto-renew"
              name="autoRenew"
              value="yes"
              bind:checked={autoRenew}
              disabled={!data.selfSignedRenewalAvailable}
            />
            <FieldLabel for="self-signed-auto-renew">
              Automatically renew this certificate
            </FieldLabel>
          </Field>
          <FieldDescription>
            CBP renews it before expiry using the encrypted server key, then
            marks linked deployments pending. It does not deploy the renewed
            certificate automatically.
            {#if !data.selfSignedRenewalAvailable}
              Set <code>BETTER_AUTH_SECRET</code> to at least 32 characters to
              enable renewal.
            {/if}
          </FieldDescription>
          {#if data.canStorePrivateKey}
            <Field orientation="horizontal">
              <Checkbox
                id="self-signed-store-key"
                name="storePrivateKey"
                value="yes"
                bind:checked={storePrivateKey}
              />
              <FieldLabel for="self-signed-store-key">
                Save the private key to Vault for deployments
              </FieldLabel>
            </Field>
          {:else}
            <p class="text-xs text-muted-foreground">
              Saving the key to Vault requires Vault configuration, credential
              management permission, and a trusted HTTPS connection.
            </p>
          {/if}
          <div class="flex justify-end">
            <Button
              type="submit"
              disabled={issuing || !data.canGenerateSelfSignedCertificate}
            >
              {#if issuing}
                <Spinner data-icon="inline-start" aria-hidden="true" class="motion-reduce:animate-none" />
                Creating certificate
              {:else}
                Generate certificate
              {/if}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </Tabs.Content>
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
              if (result.type === 'redirect') toast.success('Certificate issued.');
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
      <form class="mt-3 border p-4 sm:p-5" method="POST" action={registration} enctype="multipart/form-data" use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'failure' && typeof result.data?.message === 'string') toast.error(result.data.message); else if (result.type === 'redirect') toast.success('Certificate registered.'); }}>
        <FieldGroup>
          <CertificateChainFields />
          <div class="flex justify-end">
            <Button type="submit">Register certificate</Button>
          </div>
        </FieldGroup>
      </form>
    </Tabs.Content>
  </Tabs.Root>
</section>
