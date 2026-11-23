<script lang="ts">
  import { resolve } from '$app/paths';
  import CertificateChainFields from '#lib/components/svelte/certificate-chain-fields.svelte';
  import CertificateGroupField from '#lib/components/svelte/certificate-group-field.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import { FieldGroup } from '#lib/components/ui/field/index.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Register certificate | Certified by Pat</title>
</svelte:head>

<section class="w-full flex-1 px-5 py-6 md:px-8" aria-labelledby="register-heading">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="grid gap-1">
      <h1 id="register-heading" class="font-heading text-xl font-semibold">Register certificate</h1>
      <p class="text-xs text-muted-foreground">CBP reads the hostname from the certificate, including wildcard names.</p>
    </div>
    <Button href={resolve('/certificates')} variant="outline">Back to certificates</Button>
  </header>

  <form class="mt-6 border p-4 sm:p-5" method="POST" enctype="multipart/form-data">
    <FieldGroup>
      <CertificateGroupField groups={data.groups} selected={form?.groupId} />
      <CertificateChainFields />
      {#if form?.message}
        <p role="alert" class="text-xs text-destructive">{form.message}</p>
      {/if}
      <div class="flex justify-end">
        <Button type="submit">Register certificate</Button>
      </div>
    </FieldGroup>
  </form>
</section>
