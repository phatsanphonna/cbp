<script lang="ts">
  import { resolve } from '$app/paths';
  import SetupCommands from '#lib/components/svelte/setup-commands.svelte';
  import AlertSeverityBadge from '#lib/components/svelte/alert-severity-badge.svelte';
  import { Button } from '#lib/components/ui/button/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';

  const sections = [
    { id: 'alert-rules', label: 'Alert list' },
    { id: 'notification-setup', label: 'Set up notifications' },
    { id: 'delivery', label: 'How delivery works' },
  ];

  const alertRules = [
    {
      severity: 'Warning',
      trigger: 'Certificate expires in more than 7 days and no more than 30 days.',
      message: 'Certificate for example.com expires within 30 days.',
    },
    {
      severity: 'High',
      trigger: 'Certificate expires within 7 days and is still valid.',
      message: 'Certificate for example.com expires within 7 days.',
    },
    {
      severity: 'Critical',
      trigger: 'Certificate reaches its expiry time.',
      message: 'Certificate for example.com has expired.',
    },
    {
      severity: 'High',
      trigger: 'Three consecutive host probes return no reply.',
      message: 'web-01 has not replied to 3 consecutive probes.',
    },
    {
      severity: 'High',
      trigger: 'An agent finds a listener serving a certificate other than the deployed one.',
      message: 'web-01 (example.com:443) is not serving the deployed certificate for example.com.',
    },
  ] as const;
</script>

<svelte:head>
  <title>Alert guide | CBP</title>
</svelte:head>

<section class="w-full flex-1 px-5 py-6 md:px-8" aria-labelledby="alert-guide">
  <header class="mb-7 grid gap-1.5">
    <h1 id="alert-guide" class="font-heading text-xl font-semibold">Alert guide</h1>
    <p class="max-w-prose text-sm text-muted-foreground">
      See what triggers a certificate or host alert and how to send it to your team.
    </p>
  </header>

  <div class="grid max-w-6xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_11rem] lg:gap-10">
    <nav
      aria-label="On this page"
      class="border-y py-3 text-xs lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:border-y-0 lg:border-s lg:ps-4"
    >
      <p class="mb-2 font-medium">On this page</p>
      <ol class="grid list-decimal gap-2 ps-5">
        {#each sections as section (section.id)}
          <li>
            <a
              href={`#${section.id}`}
              class="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {section.label}
            </a>
          </li>
        {/each}
      </ol>
    </nav>

    <article class="grid min-w-0 gap-7 text-sm leading-relaxed lg:col-start-1 lg:row-start-1">
      <section
        id="alert-rules"
        aria-labelledby="alert-rules-heading"
        class="grid scroll-m-4 gap-3 border-t pt-5"
      >
        <h2 id="alert-rules-heading" class="font-heading text-base font-semibold">1. Alert list</h2>
        <p class="max-w-prose">These are all the alerts CBP currently generates.</p>
        <div class="border">
          <Table.Root class="whitespace-normal">
            <Table.Caption class="sr-only">Alert triggers and example messages</Table.Caption>
            <Table.Header class="bg-muted">
              <Table.Row>
                <Table.Head scope="col">Severity</Table.Head>
                <Table.Head scope="col">Trigger</Table.Head>
                <Table.Head scope="col">Example message</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each alertRules as rule (rule.message)}
                <Table.Row>
                  <Table.Cell>
                    <AlertSeverityBadge severity={rule.severity} />
                  </Table.Cell>
                  <Table.Cell class="min-w-40 whitespace-normal">{rule.trigger}</Table.Cell>
                  <Table.Cell class="min-w-40 whitespace-normal">{rule.message}</Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
        <p class="max-w-prose">
          A certificate keeps one open expiry alert as its severity changes. Renewing it beyond the
          30-day window resolves the alert. A host alert resolves after a probe returns a status
          other than no reply.
        </p>
        <p class="max-w-prose">
          CBP checks alert conditions about once a minute. The bell in the header shows the open
          alert count and links to the open alerts list.
        </p>
        <Button
          href={resolve('/alerts') + '?status=open'}
          variant="outline"
          size="sm"
          class="w-fit"
        >
          View open alerts
        </Button>
      </section>

      <section
        id="notification-setup"
        aria-labelledby="notification-setup-heading"
        class="grid scroll-m-4 gap-3 border-t pt-5"
      >
        <h2 id="notification-setup-heading" class="font-heading text-base font-semibold">
          2. Set up notifications
        </h2>
        <p class="max-w-prose">
          For an existing local database, run this command from the repository root using the
          database owner connection. Docker Compose applies the schema through its database setup
          service.
        </p>
        <SetupCommands
          label="Update the local database"
          command="bun --filter @cbp/database db:setup-controller"
        />
        <p class="max-w-prose">
          As an administrator, open Notification channels and choose a provider. Enter the
          destination and credentials, choose a minimum severity, and save. You can pause edit, or
          remove a channel from the same page.
        </p>
        <dl class="grid max-w-prose gap-3">
          <div>
            <dt class="font-medium">Slack</dt>
            <dd>
              Invite a bot with <code>chat:write</code> to the destination channel. Enter the bot token
              and channel ID in CBP.
            </dd>
          </div>
          <div>
            <dt class="font-medium">LINE</dt>
            <dd>
              Enter a Messaging API channel access token and a user, group, or room ID the bot can
              message.
            </dd>
          </div>
          <div>
            <dt class="font-medium">Telegram</dt>
            <dd>
              Enter the bot token and a numeric chat ID or public channel username where the bot can
              post.
            </dd>
          </div>
          <div>
            <dt class="font-medium">Email</dt>
            <dd>
              Enter a Resend API key, a sender address on a verified domain, and the recipient’s
              email address.
            </dd>
          </div>
          <div>
            <dt class="font-medium">Webhook</dt>
            <dd>Enter a display name and paste the receiver’s public HTTPS URL.</dd>
          </div>
          <div>
            <dt class="font-medium">Microsoft Teams</dt>
            <dd>
              In Teams Workflows, create a workflow that posts to a channel when a webhook request
              is received. Choose the team and channel and use the Anyone trigger option. Paste the
              workflow URL in CBP and enter any display name. The URL determines which Teams channel
              receives alerts.
            </dd>
          </div>
          <div>
            <dt class="font-medium">Discord</dt>
            <dd>
              In Discord, open the destination channel’s settings and go to
              <strong>Integrations → Webhooks</strong>. Create a webhook and copy its URL. In CBP,
              choose Discord, enter a display name, and paste the URL.
            </dd>
          </div>
        </dl>
        <p class="max-w-prose">
          Custom webhooks require a public HTTPS hostname with an IPv4 address. All notification
          providers use the web server’s <code>HTTPS_PROXY</code>
          when configured. Hosts matching <code>NO_PROXY</code> connect directly. For custom webhooks,
          the proxy must allow connections to the public IP address CBP has validated. CBP stores tokens
          and URLs encrypted and hides them after saving.
        </p>
        <Button href={resolve('/alerts/channels')} variant="outline" size="sm" class="w-fit">
          Open notification channels
        </Button>
      </section>

      <section
        id="delivery"
        aria-labelledby="delivery-heading"
        class="grid scroll-m-4 gap-3 border-t pt-5"
      >
        <h2 id="delivery-heading" class="font-heading text-base font-semibold">
          3. How delivery works
        </h2>
        <p class="max-w-prose">
          Open a saved channel’s <strong>Actions</strong> menu and select
          <strong>Send test</strong>. This works without an open alert and does not affect delivery
          history.
        </p>
        <p class="max-w-prose">
          Enabled channels receive open alerts at or above their minimum severity, including alerts
          already open when the channel is enabled. CBP records successful delivery per alert,
          severity, and channel. Failed deliveries are retried about five minutes apart, up to five
          attempts in total while the alert remains eligible.
        </p>
        <p class="max-w-prose">
          Select one or more certificates when adding or editing a channel to receive expiry alerts
          only for those certificates. Leave the selection empty to receive all matching certificate
          and host alerts. Removing a certificate from inventory leaves the channel scoped to its
          selections until you edit them.
        </p>
        <p class="max-w-prose">
          From a certificate’s <strong>Actions</strong> menu, open
          <strong>Notification channels</strong>
          to bind an existing channel or start a new one with that certificate selected.
        </p>
        <p class="max-w-prose">
          Use <strong>Clear</strong> on an open alert to remove it from the open list and stop pending
          notifications. An alert can return if its severity rises or the condition clears and recurs.
        </p>
        <p class="max-w-prose">
          If a channel says <strong>Setup required</strong>, check the provider credentials and
          destination. If an enabled channel receives nothing, check that an open alert meets its
          severity threshold and that the bot or sender has permission. Look for
          <code>Alert notification failed</code> in the web server logs.
        </p>
        <p class="max-w-prose">
          Webhook requests carry JSON with <code>event</code> set to
          <code>alert.open</code>
          or <code>alert.test</code>, plus <code>alertId</code>,
          <code>severity</code>, <code>message</code>, and
          <code>target</code>. Receivers can use the
          <code>Idempotency-Key</code> header to identify retries.
        </p>
      </section>
    </article>
  </div>
</section>
