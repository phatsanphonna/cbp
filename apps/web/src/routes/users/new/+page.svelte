<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import { Button } from '#lib/components/ui/button/index.ts';
  import { Field, FieldDescription, FieldGroup, FieldLabel } from '#lib/components/ui/field/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();
  let submitting = $state(false);
</script>

<svelte:head>
  <title>Create user | Certified by Pat</title>
</svelte:head>

<section class="w-full flex-1 px-5 py-6 md:px-8" aria-labelledby="create-user-heading">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="grid gap-1">
      <h1 id="create-user-heading" class="font-heading text-xl font-semibold">Create user</h1>
      <p class="text-xs text-muted-foreground">Create an account that can sign in with a username or email address.</p>
    </div>
    <Button href={resolve('/users')} variant="outline">Back to users</Button>
  </header>

  <form method="POST" class="mt-6 max-w-xl border p-4 sm:p-5" use:enhance={() => {
    submitting = true;
    return async ({ update }) => {
      try {
        await update();
      } finally {
        submitting = false;
      }
    };
  }}>
    <FieldGroup>
      <Field>
        <FieldLabel for="account-name" required>Name</FieldLabel>
        <Input id="account-name" name="name" value={form?.values?.name} required maxlength={120} />
      </Field>
      <Field>
        <FieldLabel for="account-email" required>Email address</FieldLabel>
        <Input id="account-email" name="email" type="email" value={form?.values?.email} required maxlength={254} />
      </Field>
      <Field>
        <FieldLabel for="account-username" required>Username</FieldLabel>
        <Input id="account-username" name="username" value={form?.values?.username} required minlength={3} maxlength={30} spellcheck={false} autocapitalize="none" aria-describedby="username-help" />
        <FieldDescription id="username-help">3 to 30 letters, numbers, underscores, or periods.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel for="account-password" required>Password</FieldLabel>
        <Input id="account-password" name="password" type="password" autocomplete="new-password" required minlength={8} maxlength={128} aria-describedby="password-help" />
        <FieldDescription id="password-help">8 to 128 characters.</FieldDescription>
      </Field>
      {#if form?.message}
        <p role="alert" class="text-xs text-destructive">{form.message}</p>
      {/if}
      <div class="flex justify-end">
        <Button type="submit" disabled={submitting}>{submitting ? 'Creating user…' : 'Create user'}</Button>
      </div>
    </FieldGroup>
  </form>
</section>
