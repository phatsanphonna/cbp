<script lang="ts">
  import { tick } from "svelte";
  import { goto } from "$app/navigation";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import { toast } from "svelte-sonner";
  import DeploymentStatusBadge from "#lib/components/svelte/deployment-status-badge.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { CopyButton } from "#lib/components/ui/code-block/index.ts";
  import * as Dialog from "#lib/components/ui/dialog/index.ts";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.ts";
  import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet,
  } from "#lib/components/ui/field/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";
  import * as Select from "#lib/components/ui/select/index.ts";
  import * as Table from "#lib/components/ui/table/index.ts";
  import { ArrowDown, Ellipsis } from "@lucide/svelte";
  import {
    nextDeploymentExpiry,
    watchDeploymentUpdates,
  } from "#lib/hooks/watch-deployment-updates.svelte.js";
  import type { formatDeploymentTargets } from "./deployment-view.server.js";

  let {
    id,
    certificateName,
    certificateFingerprint,
    jobs,
    submittedAt,
    submittedLabel,
    canCancel = false,
    canRecover = { Agent: false, Ansible: false },
    recoverError,
    missing = 0,
  }: {
    id?: string;
    certificateName?: string;
    certificateFingerprint?: string | null;
    jobs: ReturnType<typeof formatDeploymentTargets>;
    submittedAt?: string;
    submittedLabel?: string;
    canCancel?: boolean;
    canRecover?: { Agent: boolean; Ansible: boolean };
    recoverError?: string;
    missing?: number;
  } = $props();
  const title = $derived(
    certificateName
      ? `Deployment status for ${certificateName}`
      : "Deployment status",
  );
  const queued = $derived(jobs.some(({ status }) => status === "Queued"));
  const queuedAgent = $derived(
    jobs.some(
      ({ method, status }) => method === "Agent" && status === "Queued",
    ),
  );
  const queuedAnsible = $derived(
    jobs.some(
      ({ method, status }) => method === "Ansible" && status === "Queued",
    ),
  );
  const active = $derived(
    queued || jobs.some(({ status }) => status === "Running"),
  );
  let logOpen = $state(false);
  let logPinned = $state(true);
  let logJobId = $state<string | null>(null);
  let recoveryOpen = $state(false);
  let cancelPendingId = $state<string | null>(null);
  let recoveryJobId = $state<string | null>(null);
  let recoveryBecomeMethod = $state<"sudo" | "su">("sudo");
  let recoverySuPassword = $state("");
  let logElement: HTMLElement | undefined = $state();
  let lastLogScrollTop = 0;
  let logNow = $state(Date.now());
  const selectedLogJob = $derived(jobs.find(({ id }) => id === logJobId));
  const selectedRecoveryJob = $derived(
    jobs.find(({ id }) => id === recoveryJobId),
  );
  const logElapsedSeconds = $derived.by(() => {
    if (!selectedLogJob?.startedAt) return null;
    const started = Date.parse(selectedLogJob.startedAt);
    const finished =
      selectedLogJob.status === "Running"
        ? logNow
        : selectedLogJob.status === "Deployed" && selectedLogJob.finishedAt
          ? Date.parse(selectedLogJob.finishedAt)
          : NaN;
    return Number.isFinite(started) && Number.isFinite(finished)
      ? Math.max(0, Math.floor((finished - started) / 1000))
      : null;
  });
  const logTimeText = $derived.by(() => {
    if (!selectedLogJob) return "";
    if (selectedLogJob.status === "Running")
      return logElapsedSeconds === null ? "" : formatCounter(logElapsedSeconds);
    if (selectedLogJob.status !== "Deployed") return "";
    const finished = selectedLogJob.finishedAtLabel
      ? `Finished in ${selectedLogJob.finishedAtLabel}`
      : "Finished";
    if (logElapsedSeconds === null) return finished;
    return `${finished} (${logElapsedSeconds} ${logElapsedSeconds === 1 ? "second" : "seconds"})`;
  });

  function stickLogToBottom() {
    logPinned = true;
    requestAnimationFrame(() => {
      if (logElement) {
        logElement.scrollTop = logElement.scrollHeight;
        lastLogScrollTop = logElement.scrollTop;
      }
    });
  }

  function handleLogScroll() {
    if (!logElement) return;
    const scrollTop = logElement.scrollTop;
    const atBottom =
      logElement.scrollHeight - scrollTop - logElement.clientHeight < 24;
    if (atBottom) logPinned = true;
    else if (scrollTop < lastLogScrollTop) logPinned = false;
    lastLogScrollTop = scrollTop;
  }

  $effect(() => {
    const log = selectedLogJob?.log;
    if (!logOpen || !logElement || log === undefined || !logPinned) return;
    void tick().then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (logOpen && logPinned && logElement) stickLogToBottom();
        });
      });
    });
  });

  $effect(() => {
    if (
      !logOpen ||
      selectedLogJob?.status !== "Running" ||
      !selectedLogJob.startedAt
    )
      return;
    logNow = Date.now();
    const timer = setInterval(() => {
      logNow = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });

  function formatCounter(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  watchDeploymentUpdates(() => nextDeploymentExpiry(jobs));
</script>

<svelte:head>
  <title>{title} | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="deployments-heading">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="grid min-w-0 gap-1">
      <h1
        id="deployments-heading"
        class="font-heading text-xl font-semibold wrap-anywhere"
      >
        {title}
      </h1>
      {#if id}<p class="text-xs text-muted-foreground wrap-anywhere">
          Job ID <code>{id}</code>
        </p>{/if}
      {#if certificateFingerprint}
        <p class="max-w-2xl text-xs text-muted-foreground wrap-anywhere">
          Certificate version SHA-256 <code>{certificateFingerprint}</code>
        </p>
      {/if}
      {#if submittedAt}
        <p class="text-xs text-muted-foreground">
          Submitted <time datetime={submittedAt}>{submittedLabel}</time>
        </p>
      {:else if id}
        <p class="text-xs text-muted-foreground">Submission time unavailable</p>
      {/if}
      {#if active}<p class="text-xs text-muted-foreground">
          Updates automatically.
        </p>{/if}
    </div>
    <Button href={resolve("/deployments")} variant="outline" size="sm"
      >All deployments</Button
    >
  </header>

  {#if queuedAgent}
    <p class="mt-4 text-sm text-muted-foreground">
      Agents check for jobs every five seconds after check-in. If a job stays
      queued, check that <code>cbp-agent</code>
      is running and <code>deploymentServices</code> is configured in its YAML
      file.
      <a
        href={`${resolve("/docs/agent")}#deploy`}
        class="text-primary underline underline-offset-4">Agent setup</a
      >
    </p>
  {/if}
  {#if queuedAnsible}
    <p class="mt-4 text-sm text-muted-foreground">
      The Ansible runner claims jobs for endpoints in its inventory.
    </p>
  {/if}
  {#if missing}
    <p class="mt-4 text-sm text-muted-foreground" role="status">
      {missing}
      {missing === 1 ? "target is" : "targets are"} no longer available.
    </p>
  {/if}
  {#if recoverError}
    <p class="mt-4 text-sm text-destructive" role="alert">{recoverError}</p>
  {/if}

  <div class="mt-4 border">
    <Table.Root>
      <Table.Caption class="sr-only">Certificate deployment jobs</Table.Caption>
      <Table.Header class="bg-muted">
        <Table.Row>
          <Table.Head scope="col">Endpoint</Table.Head>
          <Table.Head scope="col">Certificate</Table.Head>
          <Table.Head scope="col">Host</Table.Head>
          <Table.Head scope="col">Last agent check-in</Table.Head>
          <Table.Head scope="col">Status</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each jobs as job (job.id)}
          <Table.Row>
            <Table.Head
              scope="row"
              class="max-w-72 whitespace-normal wrap-anywhere"
            >
              {job.endpoint}
              <span class="block font-normal text-muted-foreground"
                >{job.engine} · {job.method}</span
              >
            </Table.Head>
            <Table.Cell class="max-w-60 whitespace-normal wrap-anywhere">
              {#if job.certificateId}
                <a
                  href={resolve("/certificates/[id]", {
                    id: job.certificateId,
                  })}
                  class="text-primary underline underline-offset-4"
                  >{job.certificateName}</a
                >
              {:else}
                {job.certificateName}
              {/if}
            </Table.Cell>
            <Table.Cell class="max-w-48 whitespace-normal wrap-anywhere">
              {#if job.hostId}
                <a
                  href={resolve("/hosts/[id]", { id: job.hostId })}
                  class="text-primary underline underline-offset-4"
                  >{job.hostName}</a
                >
              {:else}
                {job.hostName}
                <span class="text-muted-foreground">(removed)</span>
              {/if}
            </Table.Cell>
            <Table.Cell>
              {#if job.method === "Ansible"}
                <span class="text-muted-foreground">—</span>
              {:else if job.agentSeenAt}
                <time datetime={job.agentSeenAt}>{job.agentSeenLabel}</time>
              {:else}
                <span class="text-muted-foreground">Never</span>
              {/if}
            </Table.Cell>
            <Table.Cell class="min-w-48 whitespace-normal">
              <div class="flex items-center gap-1" aria-live="polite">
                <DeploymentStatusBadge
                  status={job.status}
                  detail={job.detail}
                />
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${job.endpoint}`}
                      >
                        <Ellipsis />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content
                    align="end"
                    class="min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                  >
                    {#if canCancel && job.status === "Queued"}
                      <form
                        id="cancel-{job.id}"
                        method="POST"
                        action="?/cancel"
                        class="hidden"
                        use:enhance={() => {
                          cancelPendingId = job.id;
                          return async ({ result, update }) => {
                            try {
                              await update();
                              if (result.type === "success")
                                toast.success("Queued deployment canceled.");
                              else
                                toast.error(
                                  result.data?.cancelError ??
                                    "Could not cancel the deployment.",
                                );
                            } finally {
                              cancelPendingId = null;
                            }
                          };
                        }}
                      >
                        <input type="hidden" name="jobId" value={job.id} />
                      </form>
                      <DropdownMenu.Item
                        variant="destructive"
                        disabled={cancelPendingId === job.id}
                        onSelect={() =>
                          (
                            document.getElementById(
                              `cancel-${job.id}`,
                            ) as HTMLFormElement | null
                          )?.requestSubmit()}
                        >Cancel deployment</DropdownMenu.Item
                      >
                    {/if}
                    {#if canRecover[job.method] && job.recoverable}
                      <DropdownMenu.Item
                        class="cursor-default select-none rounded-sm px-2 py-1.5 text-xs outline-none focus:bg-accent focus:text-accent-foreground"
                        onSelect={() => {
                          recoveryJobId = job.id;
                          recoveryOpen = true;
                        }}>Redeploy this version</DropdownMenu.Item
                      >
                    {:else if job.status === "Failed" && job.certificateId}
                      <DropdownMenu.Item
                        class="cursor-default select-none rounded-sm px-2 py-1.5 text-xs outline-none focus:bg-accent focus:text-accent-foreground"
                        onSelect={() =>
                          goto(
                            resolve("/certificates/[id]", {
                              id: job.certificateId!,
                            }),
                          )}>Deploy again</DropdownMenu.Item
                      >
                    {/if}
                    <DropdownMenu.Item
                      class="cursor-default select-none rounded-sm px-2 py-1.5 text-xs outline-none focus:bg-accent focus:text-accent-foreground"
                      onSelect={() => {
                        logJobId = job.id;
                        logPinned = true;
                        lastLogScrollTop = 0;
                        logOpen = true;
                      }}>Deployment log</DropdownMenu.Item
                    >
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </div>
            </Table.Cell>
          </Table.Row>
        {:else}
          <Table.Row
            ><Table.Cell
              colspan={5}
              class="py-8 text-center text-muted-foreground"
              >No deployment targets are available.</Table.Cell
            ></Table.Row
          >
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
  {#if selectedRecoveryJob}
    <Dialog.Root bind:open={recoveryOpen}>
      <Dialog.Content
        class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <Dialog.Header>
          <Dialog.Title>Redeploy certificate</Dialog.Title>
          <Dialog.Description
            >Upload the matching private key again. It is held temporarily in
            memory while the runner claims this job.</Dialog.Description
          >
        </Dialog.Header>
        <form method="POST" action="?/recover" enctype="multipart/form-data">
          <input type="hidden" name="jobId" value={selectedRecoveryJob.id} />
          <FieldGroup>
            <FieldSet aria-describedby="recovery-key-hint">
              <FieldLegend variant="label" required
                >Private key (PEM)</FieldLegend
              >
              <FieldDescription id="recovery-key-hint"
                >Choose a file or paste the PEM contents. Use the key matching
                this certificate.</FieldDescription
              >
              <FieldGroup>
                <Field>
                  <FieldLabel for="recovery-private-key"
                    >Upload private key file</FieldLabel
                  >
                  <Input
                    id="recovery-private-key"
                    type="file"
                    name="privateKey"
                    accept=".pem,.key"
                  />
                </Field>
                <Field>
                  <FieldLabel for="recovery-private-key-pem"
                    >Or paste the private key</FieldLabel
                  >
                  <textarea
                    id="recovery-private-key-pem"
                    name="privateKeyPem"
                    rows="4"
                    maxlength={16384}
                    autocomplete="off"
                    autocapitalize="none"
                    spellcheck={false}
                    class="w-full resize-y border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"
                    placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
                </Field>
              </FieldGroup>
            </FieldSet>
            {#if selectedRecoveryJob.method === "Ansible"}
              <FieldSet>
                <FieldLegend variant="label" required
                  >Ansible credentials</FieldLegend
                >
                <FieldDescription
                  >Enter credentials for this redeployment. The su password is
                  required only when the become method is su.</FieldDescription
                >
                <FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel for="recovery-ssh-username"
                      >SSH username</FieldLabel
                    >
                    <Input
                      id="recovery-ssh-username"
                      name="sshUsername"
                      autocomplete="username"
                      maxlength={256}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel for="recovery-ssh-password"
                      >SSH password</FieldLabel
                    >
                    <Input
                      id="recovery-ssh-password"
                      name="sshPassword"
                      type="password"
                      autocomplete="new-password"
                      maxlength={1024}
                      required
                    />
                  </Field>
                </FieldGroup>
                <FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel for="recovery-become-method"
                      >Become method</FieldLabel
                    >
                    <Select.Root
                      type="single"
                      value={recoveryBecomeMethod}
                      onValueChange={(value) => {
                        if (value === "sudo" || value === "su") {
                          recoveryBecomeMethod = value;
                          if (value === "sudo") recoverySuPassword = "";
                        }
                      }}
                    >
                      <Select.Trigger id="recovery-become-method"
                        >{recoveryBecomeMethod}</Select.Trigger
                      >
                      <Select.Content>
                        <Select.Group>
                          <Select.Item value="sudo" label="sudo" />
                          <Select.Item value="su" label="su" />
                        </Select.Group>
                      </Select.Content>
                    </Select.Root>
                    <input
                      type="hidden"
                      name="becomeMethod"
                      value={recoveryBecomeMethod}
                    />
                  </Field>
                  <Field class="sm:col-span-2">
                    <FieldLabel for="recovery-su-password"
                      >Root su password</FieldLabel
                    >
                    <Input
                      id="recovery-su-password"
                      name="suPassword"
                      type="password"
                      autocomplete="new-password"
                      maxlength={1024}
                      bind:value={recoverySuPassword}
                      disabled={recoveryBecomeMethod !== "su"}
                      required={recoveryBecomeMethod === "su"}
                      class="disabled:pointer-events-auto disabled:cursor-not-allowed"
                    />
                  </Field>
                </FieldGroup>
              </FieldSet>
            {/if}
            <Dialog.Footer>
              <Dialog.Close>
                {#snippet child({ props })}<Button
                    {...props}
                    type="button"
                    variant="outline">Cancel</Button
                  >{/snippet}
              </Dialog.Close>
              <Button type="submit">Queue redeployment</Button>
            </Dialog.Footer>
          </FieldGroup>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  {/if}
  {#if selectedLogJob}
    <Dialog.Root bind:open={logOpen}>
      <Dialog.Content
        class="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-hidden sm:max-w-5xl"
      >
        <Dialog.Header>
          <div class="flex flex-wrap items-center gap-2 pr-10">
            <Dialog.Title>Deployment log</Dialog.Title>
            <DeploymentStatusBadge
              status={selectedLogJob.status}
              detail={selectedLogJob.detail}
              showTooltip={false}
            />
          </div>
          <Dialog.Description class="pr-10">
            {selectedLogJob.endpoint} · {selectedLogJob.hostName} · {selectedLogJob.method}{#if logTimeText}{" · "}<span
                aria-live="off">{logTimeText}</span
              >{/if}
          </Dialog.Description>
        </Dialog.Header>
        <div class="relative rounded-md bg-muted">
          <div class="flex justify-end border-b border-border px-2 py-1">
            <CopyButton
              value={selectedLogJob.log ?? ""}
              title="Copy log"
              aria-label="Copy deployment log"
              disabled={!selectedLogJob.log}
            />
          </div>
          {#if !logPinned}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              class="absolute bottom-3 right-3 z-10 shadow-md"
              onclick={stickLogToBottom}
              ><ArrowDown data-icon="inline-start" aria-hidden="true" />Stick to
              bottom</Button
            >
          {/if}
          <pre
            bind:this={logElement}
            onscroll={handleLogScroll}
            class="min-h-72 max-h-[calc(100dvh-14rem)] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs text-muted-foreground">{selectedLogJob.log ||
              "Waiting for deployment output…"}</pre>
        </div>
        <Dialog.Footer>
          <Dialog.Close>
            {#snippet child({ props })}
              <Button {...props} variant="outline">Close</Button>
            {/snippet}
          </Dialog.Close>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  {/if}
</section>
