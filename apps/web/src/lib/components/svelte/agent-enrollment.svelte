<script lang="ts">
  import { Copy, Download } from "@lucide/svelte";
  import { enhance } from "$app/forms";
  import { notifyFormResult } from './form-feedback.js';
  import { toast } from 'svelte-sonner';
  import { resolve } from "$app/paths";
  import * as AlertDialog from "#lib/components/ui/alert-dialog/index.ts";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as CodeBlock from "#lib/components/ui/code-block/index.ts";
  import { Spinner } from "#lib/components/ui/spinner/index.ts";

  let {
    hostId,
    agentManaged,
    canEnroll,
    configured,
    canDownloadAgent,
    caDownloadSource,
    status,
    expiresAt,
    code,
    command,
    error,
    message,
  }: {
    hostId: string;
    agentManaged: boolean;
    canEnroll: boolean;
    configured: boolean;
    canDownloadAgent: boolean;
    caDownloadSource: string | null;
    status: "not-enrolled" | "pending" | "enrolled";
    expiresAt: { iso: string; label: string } | null;
    code?: string;
    command?: string;
    error?: string;
    message?: string;
  } = $props();

  const labels = {
    "not-enrolled": "Not enrolled",
    pending: "Awaiting agent",
    enrolled: "Enrolled",
  };
  let pending = $state(false);
  let copyFeedback = $state("");

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      copyFeedback = `${label} copied.`;
    } catch {
      copyFeedback = "Select the text to copy it.";
    }
  }
</script>

<section
  id="agent-enrollment"
  class="grid scroll-mt-4 gap-3 border-t p-4"
  aria-labelledby="agent-enrollment-heading"
>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="grid min-w-0 gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <h3 id="agent-enrollment-heading" class="text-sm font-medium">
          Agent enrollment
        </h3>
        <Badge variant={status === "enrolled" ? "secondary" : "outline"}
          >{labels[status]}</Badge
        >
      </div>
      {#if !canEnroll}
        <p class="text-xs text-muted-foreground">
          Agent enrollment is available for Linux hosts only.
        </p>
      {:else if status === "pending" && expiresAt}
        <p class="text-xs text-muted-foreground">
          The code expires <time datetime={expiresAt.iso}
            >{expiresAt.label}</time
          >.
        </p>
      {:else if !agentManaged}
        <p class="text-xs text-muted-foreground">
          Generating a code enables agent management for this host.
        </p>
      {/if}
    </div>
    {#if status === "not-enrolled"}
      <form
        method="POST"
        action="?/inviteAgent"
        use:enhance={() => {
          pending = true;
          copyFeedback = "";
          return async ({ result, update }) => {
            try {
              await update();
              notifyFormResult(result, { error: 'enrollmentError' });
              if (result.type === 'success' && typeof result.data?.enrollmentCode === 'string') toast.success('Enrollment code generated.');
            } finally {
              pending = false;
            }
          };
        }}
      >
        <Button
          type="submit"
          disabled={pending || !configured || !canEnroll}
          aria-busy={pending}
        >
          {#if pending}<Spinner
              data-icon="inline-start"
              aria-hidden="true"
            />{/if}
          Generate enrollment code
        </Button>
      </form>
    {:else}
      <AlertDialog.Root>
        <AlertDialog.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline">Reset enrollment</Button>
          {/snippet}
        </AlertDialog.Trigger>
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>Reset agent enrollment?</AlertDialog.Title>
            <AlertDialog.Description>
              This invalidates the current code or agent credential. Generate a
              new code to enroll an agent again.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <form method="POST" action="?/resetAgent" use:enhance={() => async ({ result, update }) => { await update(); notifyFormResult(result, { success: 'enrollmentMessage', error: 'enrollmentError' }); }}>
            <AlertDialog.Footer>
              <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
              <AlertDialog.Action type="submit" variant="destructive"
                >Reset enrollment</AlertDialog.Action
              >
            </AlertDialog.Footer>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Root>
    {/if}
  </div>
  {#if canEnroll && !configured && status === "not-enrolled"}
    <p class="text-xs text-muted-foreground">
      Set <code>CBP_AGENT_CONTROLLER_ADDRESS</code> in the web app to enable enrollment
      commands.
    </p>
  {/if}
  {#if canEnroll && status !== "enrolled" && (canDownloadAgent || caDownloadSource)}
    <div class="flex flex-wrap items-center gap-2">
      {#if canDownloadAgent}
        <Button href={resolve("/agent/download")} variant="outline" size="sm">
          <Download data-icon="inline-start" aria-hidden="true" /> Download Linux
          agent
        </Button>
      {/if}
      {#if caDownloadSource}
        <Button
          href={resolve("/api/agent-ca")}
          download
          variant="outline"
          size="sm"
        >
          <Download data-icon="inline-start" aria-hidden="true" /> Download controller
          CA
        </Button>
        <p class="text-xs text-muted-foreground">
          Copy it to <code>{caDownloadSource}</code> on the Linux host before running
          the enrollment command.
        </p>
      {/if}
    </div>
  {/if}
  {#if canEnroll && code && command && status === "pending"}
    <div class="grid gap-3 border bg-muted/40 p-3">
      <p class="text-xs">
        Run this command as root on the Linux host. If the agent is missing,
        first copy the binary there as <code>./cbp-agent-linux</code>. The
        command installs it if needed, enrolls it, and starts its systemd
        service.
      </p>
      <CodeBlock.Root size="sm">
        <CodeBlock.Header>
          <CodeBlock.Title>Linux enrollment command</CodeBlock.Title>
          <CodeBlock.Actions>
            <CodeBlock.CopyButton
              value={command}
              aria-label="Copy Linux enrollment command"
            />
          </CodeBlock.Actions>
        </CodeBlock.Header>
        <CodeBlock.Content
          code={command}
          wrap
          aria-label="Linux enrollment command"
        />
      </CodeBlock.Root>
      <dl class="grid gap-3 text-xs">
        {#each [{ label: "Host UUID", value: hostId }, { label: "Enrollment code", value: code }] as item (item.label)}
          <div class="flex min-w-0 flex-wrap items-end justify-between gap-2">
            <div class="grid min-w-0 gap-1">
              <dt class="text-muted-foreground">{item.label}</dt>
              <dd><code class="wrap-anywhere">{item.value}</code></dd>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Copy ${item.label}`}
              onclick={() => copy(item.value, item.label)}
            >
              <Copy data-icon="inline-start" aria-hidden="true" />
              Copy
            </Button>
          </div>
        {/each}
      </dl>
      <p class="text-xs text-muted-foreground empty:hidden" aria-live="polite">
        {copyFeedback}
      </p>
    </div>
  {/if}
  {#if canEnroll && status !== "enrolled"}
    <a
      href={`${resolve("/docs/agent")}#agent`}
      class="justify-self-start text-xs text-primary underline underline-offset-4"
    >
      Agent setup instructions
    </a>
  {/if}
</section>
