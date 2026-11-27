<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import DiscordIcon from '@icons-pack/svelte-simple-icons/icons/SiDiscord';
  import LineIcon from '@icons-pack/svelte-simple-icons/icons/SiLine';
  import TelegramIcon from '@icons-pack/svelte-simple-icons/icons/SiTelegram';
  import { Ellipsis, Hash, Mail, UsersRound, Webhook } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import AlertSeverityBadge from '#lib/components/svelte/alert-severity-badge.svelte';
  import FormSelect from '#lib/components/svelte/form-select.svelte';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Dialog from '#lib/components/ui/dialog/index.ts';
  import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
  import { Field, FieldDescription, FieldLabel } from '#lib/components/ui/field/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';
  import * as Select from '#lib/components/ui/select/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const providers = {
    Slack: {
      label: 'Slack channel ID',
      placeholder: 'C0123456789',
      secretLabel: 'Slack bot token',
      icon: Hash,
    },
    LINE: {
      label: 'LINE recipient ID',
      placeholder: 'Group, room, or user ID',
      secretLabel: 'LINE channel access token',
      icon: LineIcon,
    },
    Telegram: {
      label: 'Telegram chat ID or channel username',
      placeholder: '-1001234567890',
      secretLabel: 'Telegram bot token',
      icon: TelegramIcon,
    },
    Email: {
      label: 'Recipient email address',
      placeholder: 'ops@example.test',
      secretLabel: 'Resend API key',
      icon: Mail,
    },
    Webhook: {
      label: 'Display name',
      placeholder: 'Operations',
      secretLabel: 'HTTPS webhook URL',
      icon: Webhook,
    },
    'Microsoft Teams': {
      label: 'Display name',
      placeholder: 'Ops alerts',
      secretLabel: 'Teams Workflows webhook URL',
      icon: UsersRound,
    },
    Discord: {
      label: 'Display name',
      placeholder: 'Ops alerts',
      secretLabel: 'Discord webhook URL',
      icon: DiscordIcon,
    },
  };
  type Provider = keyof typeof providers;
  const providerOptions = Object.entries(providers).map(([value, { icon }]) => ({
    value,
    label: value,
    icon,
  }));
  const severityOptions = ['Info', 'Warning', 'High', 'Critical'].map((value) => ({
    value,
    label: value,
  }));
  const certificateLabels = $derived(
    new Map(data.certificates.map(({ value, label }) => [value, label])),
  );
  const certificateContext = $derived(
    data.certificateId ? certificateLabels.get(data.certificateId) : undefined,
  );
  const certificateOptions = $derived(
    data.certificates.map(({ value, label, serial }) => ({
      value,
      label: `${label} · ${serial.slice(-8)}`,
    })),
  );
  let provider = $state<Provider>('Slack');
  let testingChannel = $state<number | null>(null);
  let removingChannel = $state<number | null>(null);
  let editingChannel = $state<number | null>(null);
  let savingChannel = $state(false);

  function submitChannelAction(action: 'test' | 'toggle' | 'bind', id: number) {
    const actionForm = document.getElementById(`channel-${action}-${id}`);
    if (actionForm instanceof HTMLFormElement) actionForm.requestSubmit();
  }

  function restoreChannelFocus(event: Event, id: number) {
    const trigger = document.getElementById(`channel-actions-${id}`);
    if (!trigger) return;
    event.preventDefault();
    trigger.focus();
  }

  $effect(() => {
    const result = form;
    untrack(() => {
      if (result?.message) toast.error(result.message);
      else if (result?.success) toast.success(result.success);
    });
  });
</script>

{#snippet channelFields(
  fieldProvider: Provider,
  prefix: string,
  existing?: PageProps['data']['channels'][number],
)}
  {@const usesWebhook =
    fieldProvider === 'Webhook' ||
    fieldProvider === 'Microsoft Teams' ||
    fieldProvider === 'Discord'}
  {@const selectedCertificates = existing
    ? (existing.certificateIds ?? [])
    : data.certificateId
      ? [data.certificateId]
      : []}
  {@const scopeOptions = [
    ...certificateOptions,
    ...selectedCertificates
      .filter((id) => !certificateLabels.has(id))
      .map((value) => ({ value, label: 'Removed certificate' })),
  ]}
  {#key fieldProvider}
    <Field>
      <FieldLabel for={`${prefix}-secret`} required={!existing}>
        {providers[fieldProvider].secretLabel}
      </FieldLabel>
      <Input
        id={`${prefix}-secret`}
        name="secret"
        type={usesWebhook ? 'url' : 'password'}
        autocomplete={usesWebhook ? 'off' : 'new-password'}
        spellcheck={false}
        autocapitalize="none"
        required={!existing}
        maxlength={2048}
      />
    </Field>
    {#if fieldProvider === 'Email'}
      <Field>
        <FieldLabel for={`${prefix}-sender`} required={!existing}>
          Verified sender email address
        </FieldLabel>
        <Input
          id={`${prefix}-sender`}
          name="sender"
          type="email"
          required={!existing}
          maxlength={120}
        />
      </Field>
    {/if}
  {/key}

  <Field>
    <FieldLabel for={`${prefix}-destination`} required>{providers[fieldProvider].label}</FieldLabel>
    <Input
      id={`${prefix}-destination`}
      name="destination"
      type={fieldProvider === 'Email' ? 'email' : 'text'}
      aria-describedby={usesWebhook ? `${prefix}-destination-description` : undefined}
      placeholder={providers[fieldProvider].placeholder}
      value={existing?.destination}
      required
      maxlength={120}
    />
    {#if usesWebhook}
      <FieldDescription id={`${prefix}-destination-description`}>
        This name is only used in CBP.
      </FieldDescription>
    {/if}
  </Field>

  <Field>
    <FieldLabel for={`${prefix}-severity`} required>Minimum severity</FieldLabel>
    <FormSelect
      id={`${prefix}-severity`}
      name="severity"
      items={severityOptions}
      value={existing?.severity ?? 'Warning'}
      required
    />
  </Field>
  <Field>
    <FieldLabel for={`${prefix}-certificates`}>Certificates</FieldLabel>
    <Select.Root
      type="multiple"
      name="certificateIds"
      value={selectedCertificates}
      items={scopeOptions}
    >
      <Select.Trigger
        id={`${prefix}-certificates`}
        class="w-full"
        aria-describedby={`${prefix}-scope-description`}
      >
        <Select.Value placeholder="All alerts">
          {#snippet children({ selection })}
            {#if selection.type === 'multiple' && selection.selected.length === 1}
              {selection.selected[0]?.label}
            {:else if selection.type === 'multiple' && selection.selected.length > 1}
              {selection.selected.length} certificates selected
            {:else}
              All alerts
            {/if}
          {/snippet}
        </Select.Value>
      </Select.Trigger>
      <Select.Content>
        <Select.Group>
          {#each scopeOptions as option (option.value)}
            <Select.Item value={option.value} label={option.label} />
          {:else}
            <Select.GroupHeading>No certificates in inventory</Select.GroupHeading>
          {/each}
        </Select.Group>
      </Select.Content>
    </Select.Root>
    <FieldDescription id={`${prefix}-scope-description`}>
      Select certificates to receive only their expiry alerts. Clear the selection to receive all
      alerts.
    </FieldDescription>
  </Field>
{/snippet}

<svelte:head>
  <title>Notification channels | CBP</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="channels-heading">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="grid gap-1">
      <h1 id="channels-heading" class="font-heading text-xl font-semibold">
        Notification channels
      </h1>
      <p class="text-xs text-muted-foreground">
        Choose where certificate and host alerts should go.
      </p>
    </div>
    <Button href={resolve('/alerts')} variant="outline">Back to alerts</Button>
  </header>

  <p class="mt-4 text-xs text-muted-foreground">
    Each enabled channel receives open alerts at or above its minimum severity.
    <a href={resolve('/docs/alert') + '#notification-setup'} class="underline underline-offset-4">
      Provider setup guide
    </a>
  </p>
  {#if certificateContext}
    <p class="mt-2 text-xs text-muted-foreground">
      Managing notifications for <strong class="text-foreground">{certificateContext}</strong>. New
      channels have this certificate selected. Use a channel’s Actions menu to bind it.
    </p>
  {/if}
  {#if data.canManageAlerts}
    <form
      class="mt-6 grid gap-4 border p-4 sm:grid-cols-2"
      method="POST"
      action="?/add"
      use:enhance
    >
      <Field>
        <FieldLabel for="channel-provider" required>Provider</FieldLabel>
        <FormSelect
          id="channel-provider"
          name="provider"
          items={providerOptions}
          value={provider}
          onValueChange={(value) => {
            if (Object.hasOwn(providers, value)) provider = value as Provider;
          }}
          required
        />
      </Field>

      {@render channelFields(provider, 'channel')}

      <div class="sm:col-span-2">
        <Button type="submit">Add channel</Button>
      </div>
    </form>
  {/if}

  <div class="mt-6 border">
    <Table.Root>
      <Table.Caption class="sr-only">Configured notification channels</Table.Caption>
      <Table.Header class="bg-muted">
        <Table.Row>
          <Table.Head scope="col">Provider</Table.Head>
          <Table.Head scope="col">Destination</Table.Head>
          <Table.Head scope="col">Minimum severity</Table.Head>
          <Table.Head scope="col">Alert scope</Table.Head>
          <Table.Head scope="col">Status</Table.Head>
          <Table.Head scope="col" class="text-right">Actions</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.channels as channel (channel.id)}
          {@const ProviderIcon = providers[channel.provider]?.icon}
          {@const scopeLabels = channel.certificateIds?.map(
            (id) => certificateLabels.get(id) ?? 'Removed certificate',
          )}
          {@const canBind =
            data.certificateId && !channel.certificateIds?.includes(data.certificateId)}
          <Table.Row>
            <Table.Cell>
              <span class="inline-flex items-center gap-2">
                {#if ProviderIcon}<ProviderIcon size={16} aria-hidden="true" />{/if}
                {channel.provider}
              </span>
            </Table.Cell>
            <Table.Head scope="row">{channel.destination}</Table.Head>
            <Table.Cell><AlertSeverityBadge severity={channel.severity} /></Table.Cell>
            <Table.Cell>
              {#if scopeLabels}
                <span title={scopeLabels.join(', ')}>
                  {scopeLabels.length === 1 ? scopeLabels[0] : `${scopeLabels.length} certificates`}
                </span>
              {:else}
                All alerts
              {/if}
            </Table.Cell>
            <Table.Cell>
              {#if channel.enabled}
                {channel.ready ? 'Enabled' : 'Setup required'}
              {:else}
                <span class="text-destructive">Paused</span>
              {/if}
            </Table.Cell>
            <Table.Cell class="text-right">
              {#if data.canManageAlerts}
                <div class="flex justify-end">
                  {#if canBind}
                    <form
                      id={`channel-bind-${channel.id}`}
                      method="POST"
                      action="?/bindCertificate"
                      hidden
                      use:enhance
                    >
                      <input type="hidden" name="id" value={channel.id} />
                      <input type="hidden" name="certificateId" value={data.certificateId} />
                    </form>
                  {/if}
                  <form
                    id={`channel-test-${channel.id}`}
                    method="POST"
                    action="?/test"
                    hidden
                    use:enhance={() => {
                      testingChannel = channel.id;
                      const sending = toast.loading(`Sending test to ${channel.destination}…`);
                      return async ({ update }) => {
                        try {
                          await update({ reset: false, invalidateAll: false });
                        } finally {
                          toast.dismiss(sending);
                          testingChannel = null;
                        }
                      };
                    }}
                  >
                    <input type="hidden" name="id" value={channel.id} />
                  </form>
                  <form
                    id={`channel-toggle-${channel.id}`}
                    method="POST"
                    action="?/setEnabled"
                    hidden
                    use:enhance
                  >
                    <input type="hidden" name="id" value={channel.id} />
                    <input type="hidden" name="enabled" value={String(!channel.enabled)} />
                  </form>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          id={`channel-actions-${channel.id}`}
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${channel.destination}`}
                        >
                          <Ellipsis aria-hidden="true" />
                        </Button>
                      {/snippet}
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content
                      align="end"
                      onCloseAutoFocus={(event) => {
                        if (removingChannel === channel.id || editingChannel === channel.id)
                          event.preventDefault();
                      }}
                    >
                      <DropdownMenu.Group>
                        <DropdownMenu.Item onSelect={() => (editingChannel = channel.id)}>
                          Edit
                        </DropdownMenu.Item>
                        {#if canBind}
                          <DropdownMenu.Item
                            onSelect={() => submitChannelAction('bind', channel.id)}
                          >
                            {channel.certificateIds === null
                              ? 'Restrict to this certificate'
                              : 'Add this certificate'}
                          </DropdownMenu.Item>
                        {/if}
                        <DropdownMenu.Item
                          disabled={!channel.ready || testingChannel !== null}
                          onSelect={() => submitChannelAction('test', channel.id)}
                        >
                          {testingChannel === channel.id ? 'Sending…' : 'Send test'}
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onSelect={() => submitChannelAction('toggle', channel.id)}
                        >
                          {channel.enabled ? 'Pause' : 'Enable'}
                        </DropdownMenu.Item>
                      </DropdownMenu.Group>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Group>
                        <DropdownMenu.Item
                          variant="destructive"
                          onSelect={() => (removingChannel = channel.id)}
                        >
                          Remove
                        </DropdownMenu.Item>
                      </DropdownMenu.Group>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                  <Dialog.Root
                    open={editingChannel === channel.id}
                    onOpenChange={(open) => {
                      if (!open && editingChannel === channel.id) editingChannel = null;
                    }}
                  >
                    <Dialog.Content
                      class="max-h-[calc(100dvh-2rem)] overflow-y-auto"
                      onCloseAutoFocus={(event) => restoreChannelFocus(event, channel.id)}
                    >
                      <Dialog.Header>
                        <Dialog.Title>Edit {channel.provider} channel</Dialog.Title>
                        <Dialog.Description>
                          Leave the credential fields blank to keep their current values.
                        </Dialog.Description>
                      </Dialog.Header>
                      <form
                        class="grid gap-4"
                        method="POST"
                        action="?/edit"
                        use:enhance={() => {
                          savingChannel = true;
                          return async ({ result, update }) => {
                            try {
                              await update({ reset: false });
                              if (result.type === 'success' && editingChannel === channel.id)
                                editingChannel = null;
                            } finally {
                              savingChannel = false;
                            }
                          };
                        }}
                      >
                        <input type="hidden" name="id" value={channel.id} />
                        {@render channelFields(
                          channel.provider,
                          `edit-channel-${channel.id}`,
                          channel,
                        )}
                        <Dialog.Footer>
                          <Dialog.Close>
                            {#snippet child({ props })}
                              <Button {...props} type="button" variant="outline">Cancel</Button>
                            {/snippet}
                          </Dialog.Close>
                          <Button type="submit" disabled={savingChannel}>
                            {savingChannel ? 'Saving…' : 'Save changes'}
                          </Button>
                        </Dialog.Footer>
                      </form>
                    </Dialog.Content>
                  </Dialog.Root>
                  <AlertDialog.Root
                    open={removingChannel === channel.id}
                    onOpenChange={(open) => {
                      if (!open && removingChannel === channel.id) removingChannel = null;
                    }}
                  >
                    <AlertDialog.Content
                      onCloseAutoFocus={(event) => restoreChannelFocus(event, channel.id)}
                    >
                      <AlertDialog.Header>
                        <AlertDialog.Title>Remove notification channel?</AlertDialog.Title>
                        <AlertDialog.Description>
                          {channel.destination} will stop receiving alerts.
                        </AlertDialog.Description>
                      </AlertDialog.Header>
                      <AlertDialog.Footer>
                        <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
                        <form method="POST" action="?/remove" use:enhance>
                          <input type="hidden" name="id" value={channel.id} />
                          <Button type="submit" variant="destructive">Remove channel</Button>
                        </form>
                      </AlertDialog.Footer>
                    </AlertDialog.Content>
                  </AlertDialog.Root>
                </div>
              {/if}
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row>
            <Table.Cell colspan={7} class="py-8 text-center text-muted-foreground">
              No notification channels configured.
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</section>
