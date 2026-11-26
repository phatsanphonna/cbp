<script lang="ts">
  import { enhance } from "$app/forms";
  import { notifyFormResult } from '#lib/components/svelte/form-feedback.js';
  import { Button } from "#lib/components/ui/button/index.ts";
  import {
    Field,
    FieldGroup,
    FieldLabel,
  } from "#lib/components/ui/field/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";
  import type { PageProps } from "./$types";

  let { form }: PageProps = $props();
  let submitting = $state(false);
</script>

<svelte:head><title>Change password | Certified by Pat</title></svelte:head>

<section
  class="w-full flex-1 px-5 py-6 md:px-8"
  aria-labelledby="password-heading"
>
  <h1 id="password-heading" class="font-heading text-xl font-semibold">
    Change password
  </h1>
  <form
    method="POST"
    class="mt-6 max-w-xl border p-4 sm:p-5"
    use:enhance={() => {
      submitting = true;
      return async ({ result, update }) => {
        try {
          await update();
          notifyFormResult(result, {});
        } finally {
          submitting = false;
        }
      };
    }}
  >
    <FieldGroup>
      <Field>
        <FieldLabel for="current-password" required>Current password</FieldLabel
        >
        <Input
          id="current-password"
          name="currentPassword"
          type="password"
          autocomplete="current-password"
          required
          maxlength={128}
        />
      </Field>
      <Field>
        <FieldLabel for="new-password" required>New password</FieldLabel>
        <Input
          id="new-password"
          name="newPassword"
          type="password"
          autocomplete="new-password"
          required
          minlength={8}
          maxlength={128}
        />
      </Field>
      <Field>
        <FieldLabel for="confirm-password" required
          >Confirm new password</FieldLabel
        >
        <Input
          id="confirm-password"
          name="confirmPassword"
          type="password"
          autocomplete="new-password"
          required
          minlength={8}
          maxlength={128}
        />
      </Field>
      <div class="flex justify-end">
        <Button type="submit" disabled={submitting}
          >{submitting ? "Changing password…" : "Change password"}</Button
        >
      </div>
    </FieldGroup>
  </form>
</section>
