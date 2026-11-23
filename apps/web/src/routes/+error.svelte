<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { Button } from '#lib/components/ui/button/index.ts';

  const message = $derived(page.error?.message ?? 'Something went wrong');
</script>

<svelte:head>
  <title>{page.status} {message} | Certified by Pat</title>
</svelte:head>

<section class="m-5 grid max-w-xl justify-items-start gap-3 border px-5 py-6 md:m-8" aria-labelledby="error-heading">
  <h1 id="error-heading" class="font-heading text-xl font-semibold">{page.status} {message}</h1>
  <Button href={resolve('/')} variant="outline" size="sm">Back to overview</Button>
</section>
