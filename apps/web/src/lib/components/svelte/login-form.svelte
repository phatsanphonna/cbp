<script lang="ts">
  import * as Card from "#lib/components/ui/card/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import {
    FieldGroup,
    Field,
    FieldLabel,
  } from "#lib/components/ui/field/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";

  let {
    greeting,
    message,
  }: { greeting: { lang: string; text: string }; message?: string } = $props();
  const id = $props.id();
</script>

<Card.Root class="mx-auto w-full max-w-sm">
  <Card.Header>
    <p class="text-sm font-medium">Certified by Pat</p>
    <Card.Title
      class="text-left font-sans text-2xl"
      lang={greeting.lang}
      dir="auto">{greeting.text}</Card.Title
    >
    <Card.Description>
      Enter your username or email and password.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <form method="POST">
      <FieldGroup>
        <Field>
          <FieldLabel for="identifier-{id}" required
            >Username or email</FieldLabel
          >
          <Input
            id="identifier-{id}"
            name="identifier"
            type="text"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
            required
          />
        </Field>
        <Field>
          <FieldLabel for="password-{id}" required>Password</FieldLabel>
          <Input
            id="password-{id}"
            name="password"
            type="password"
            autocomplete="current-password"
            required
          />
        </Field>
        {#if message}
          <p role="alert" class="text-xs text-destructive">{message}</p>
        {/if}
        <Field>
          <Button type="submit" class="w-full">Sign in</Button>
        </Field>
      </FieldGroup>
    </form>
  </Card.Content>
</Card.Root>
