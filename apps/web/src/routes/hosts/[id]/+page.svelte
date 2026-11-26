<script lang="ts">
  import AlpineIcon from "@icons-pack/svelte-simple-icons/icons/SiAlpinelinux";
  import ArchIcon from "@icons-pack/svelte-simple-icons/icons/SiArchlinux";
  import DebianIcon from "@icons-pack/svelte-simple-icons/icons/SiDebian";
  import FedoraIcon from "@icons-pack/svelte-simple-icons/icons/SiFedora";
  import LinuxIcon from "@icons-pack/svelte-simple-icons/icons/SiLinux";
  import RedHatIcon from "@icons-pack/svelte-simple-icons/icons/SiRedhat";
  import UbuntuIcon from "@icons-pack/svelte-simple-icons/icons/SiUbuntu";
  import { Info, Monitor } from "@lucide/svelte";
  import { enhance } from '$app/forms';
  import { resolve } from "$app/paths";
  import { toast } from 'svelte-sonner';
  import AgentEnrollment from "#lib/components/svelte/agent-enrollment.svelte";
  import DeploymentStatusBadge from "#lib/components/svelte/deployment-status-badge.svelte";
  import EditDeploymentEndpointDialog from "#lib/components/svelte/edit-deployment-endpoint-dialog.svelte";
  import LinkDeploymentDialog from "#lib/components/svelte/link-deployment-dialog.svelte";
  import ServedCertificateExpiry from "#lib/components/svelte/served-certificate-expiry.svelte";
  import FormSelect from '#lib/components/svelte/form-select.svelte';
  import { Field, FieldGroup, FieldLabel } from '#lib/components/ui/field/index.ts';
  import * as AlertDialog from "#lib/components/ui/alert-dialog/index.ts";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import * as Table from "#lib/components/ui/table/index.ts";
  import * as Tooltip from "#lib/components/ui/tooltip/index.ts";
  import { refreshHostPing } from "#lib/hooks/refresh-host-ping.js";
  import {
    nextDeploymentExpiry,
    watchDeploymentUpdates,
  } from "#lib/hooks/watch-deployment-updates.svelte.js";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();
  let selectedCredential = $state('none');
  $effect(() => { selectedCredential = data.credentials.bound ?? 'none'; });
  refreshHostPing();
  const host = $derived(data.host);
  const architectureAliases = new Map([
    ["x86_64", "amd64"],
    ["aarch64", "arm64"],
  ]);
  const architecture = $derived(
    host.architecture
      ? (architectureAliases.get(host.architecture) ?? host.architecture)
      : null,
  );
  const platform = $derived(
    [host.operatingSystem, architecture].filter(Boolean).join(" · "),
  );
  const distroIcons = [
    [/^ubuntu\b/i, UbuntuIcon],
    [/^debian\b/i, DebianIcon],
    [/^fedora\b/i, FedoraIcon],
    [/^red hat\b/i, RedHatIcon],
    [/^alpine\b/i, AlpineIcon],
    [/^arch\b/i, ArchIcon],
    [/\blinux\b/i, LinuxIcon],
  ] as const;
  const OSIcon = $derived(
    host.operatingSystem
      ? (distroIcons.find(([pattern]) =>
          pattern.test(host.operatingSystem ?? ""),
        )?.[1] ?? Monitor)
      : null,
  );
  const hostname = $derived(host.hostname || host.name);
  const hostTitle = $derived(
    host.ipAddress && host.ipAddress !== hostname
      ? `${hostname} (${host.ipAddress})`
      : hostname,
  );
  const facts = $derived([
    { label: "Discovered hostname", value: host.hostname },
    { label: "IP address", value: host.ipAddress },
    { label: "Appliance type", value: host.applianceType ?? "Not specified" },
  ]);
  const listenerLabels = {
    ready: "TLS healthy",
    drifted: "Certificate mismatch",
    unreachable: "Listener unreachable",
    "tls-error": "TLS handshake failed",
    "not-allowed": "Target not enabled",
  } as const;
  function formatFingerprint(fingerprint: string) {
    const hex = fingerprint.replace(/^sha256:/i, "").replaceAll(":", "");
    return /^[\da-f]{64}$/i.test(hex)
      ? hex.replace(/(..)(?=.)/g, "$1:").toUpperCase()
      : fingerprint;
  }

  watchDeploymentUpdates(() =>
    nextDeploymentExpiry(Object.values(data.agentDeployments.statuses)),
  );
</script>

<svelte:head>
  <title>{hostTitle} | Certified by Pat</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="host-heading">
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="grid min-w-0 gap-2">
      <h1
        id="host-heading"
        class="font-heading text-xl font-semibold wrap-anywhere"
      >
        {hostTitle}
      </h1>
      <div
        class="flex flex-wrap gap-2"
        role="group"
        aria-label="Management methods"
      >
        {#if host.agentManaged}<Badge variant="secondary">Agent</Badge>{/if}
        {#if host.ansibleManaged}<Badge variant="secondary">Ansible</Badge>{/if}
        {#if !host.agentManaged && !host.ansibleManaged}<Badge variant="outline"
            >Unmanaged</Badge
          >{/if}
      </div>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button href={resolve("/hosts")} variant="outline">Back to hosts</Button>
      <AlertDialog.Root>
        <AlertDialog.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="destructive">Remove host</Button>
          {/snippet}
        </AlertDialog.Trigger>
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>Remove host?</AlertDialog.Title>
            <AlertDialog.Description class="wrap-anywhere">
              Remove {host.name} from CBP. Its certificate deployments will stay in
              the certificate inventory without a linked host.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <form method="POST" action="?/remove" use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'failure' && typeof result.data?.credentialError === 'string') toast.error(result.data.credentialError); else if (result.type === 'redirect') toast.success('Host removed.'); }}>
            <AlertDialog.Footer>
              <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
              <AlertDialog.Action type="submit" variant="destructive"
                >Remove host</AlertDialog.Action
              >
            </AlertDialog.Footer>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  </header>

  <section class="mt-6 border" aria-labelledby="facts-heading">
    <h2
      id="facts-heading"
      class="border-b bg-muted px-4 py-3 text-sm font-medium"
    >
      Host information
    </h2>
    <dl class="grid gap-4 p-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
      {#each facts as fact (fact.label)}
        <div class="min-w-0">
          <dt class="text-muted-foreground">{fact.label}</dt>
          <dd class="mt-1 wrap-anywhere">{fact.value ?? "Not collected"}</dd>
        </div>
      {/each}
      <div class="min-w-0">
        <dt class="text-muted-foreground">Platform</dt>
        <dd class="mt-1 flex items-center gap-1.5 wrap-anywhere">
          {#if OSIcon}<OSIcon
              size={14}
              class="shrink-0"
              aria-hidden="true"
            />{/if}
          <span>{platform || "Not collected"}</span>
        </dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Network reachability</dt>
        <dd class="mt-1" aria-live="polite">
          <span class:text-destructive={host.lastPingStatus === "no-reply"}
            >{host.lastPingLabel}</span
          >
          {#if host.lastPingAt}
            · <time datetime={host.lastPingAt.iso}>{host.lastPingAt.label}</time
            >
          {/if}
        </dd>
      </div>
    </dl>
  </section>

  <section class="mt-6 border" aria-labelledby="management-heading">
    <h2
      id="management-heading"
      class="border-b bg-muted px-4 py-3 text-sm font-medium"
    >
      Management status
    </h2>
    <dl class="grid gap-4 p-4 text-xs sm:grid-cols-2">
      <div>
        <dt class="text-muted-foreground">Last agent check-in</dt>
        <dd class="mt-1">
          {@render timestamp(
            host.agentSeenAt,
            host.agentManaged ? "No check-in recorded" : "Agent not configured",
          )}
        </dd>
      </div>
      {#if host.agentManaged}
        <div>
          <dt class="text-muted-foreground">Allowed deployment services</dt>
          <dd class="mt-1 flex flex-wrap gap-1">
            {#if host.allowedDeploymentServices === null}
              <span>Not reported</span>
            {:else}
              {#each host.allowedDeploymentServices as service (service)}
                {@const version = host.deploymentServiceVersions?.[service]}
                <Badge variant="secondary"
                  >{service}{#if version}<span class="font-mono"
                      >({version})</span
                    >{/if}</Badge
                >
              {:else}
                <span>None enabled</span>
              {/each}
            {/if}
          </dd>
        </div>
      {/if}
      <div>
        <dt class="text-muted-foreground">Last Ansible run</dt>
        <dd class="mt-1">
          {@render timestamp(
            host.ansibleRunAt,
            host.ansibleManaged ? "No run recorded" : "Ansible not configured",
          )}
          {#if host.ansibleRunAt && host.ansibleSucceeded !== null}
            <span class:text-destructive={!host.ansibleSucceeded}>
              · {host.ansibleSucceeded ? "Succeeded" : "Failed"}</span
            >
          {/if}
        </dd>
      </div>
    </dl>
    {#if data.user?.isAdmin && (host.ansibleManaged || data.credentials.bound)}
      <div class="border-t p-4">
        <h3 class="text-sm font-medium">Ansible credential</h3>
        {#if data.credentials.available}
          <form method="POST" action="?/bindCredential" class="mt-3 max-w-md" use:enhance={() => {
            return async ({ result, update }) => {
              await update();
              if (result.type === 'success' && typeof result.data?.credentialMessage === 'string') {
                toast.success(result.data.credentialMessage);
              } else if (result.type === 'failure' && typeof result.data?.credentialError === 'string') {
                toast.error(result.data.credentialError);
              }
            };
          }}>
            <FieldGroup>
              <Field>
                <FieldLabel for="host-credential">Credential for this host</FieldLabel>
                <FormSelect id="host-credential" name="credentialId" bind:value={selectedCredential} items={[{ value: 'none', label: 'No credential' }, ...data.credentials.profiles.map((profile) => ({ value: profile.id, label: profile.name }))]} />
              </Field>
              <Button type="submit" size="sm">Save binding</Button>
            </FieldGroup>
          </form>
          <a href={resolve('/ansible-credentials')} class="mt-3 inline-block text-xs text-primary underline underline-offset-4">Manage credentials</a>
        {:else if data.credentials.error}
          <p class="mt-2 text-xs text-destructive">Could not load credentials from Vault.</p>
        {/if}
      </div>
    {/if}
    {#key host.id}
      <AgentEnrollment
        hostId={host.id}
        agentManaged={host.agentManaged}
        canEnroll={host.applianceType === "Linux"}
        {...data.enrollment}
        code={form?.enrollmentCode}
        command={form?.enrollmentCommand}
        error={form?.enrollmentError}
        message={form?.enrollmentMessage}
      />
    {/key}
  </section>

  <section class="mt-6" aria-labelledby="host-deployments-heading">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 id="host-deployments-heading" class="text-sm font-medium">
        Certificate deployments
      </h2>
      {#if data.certificateOptions.length}
        <LinkDeploymentDialog
          target="certificate"
          options={data.certificateOptions}
          message={form?.linkError}
        />
      {:else}
        <Button href={resolve("/certificates/new")} variant="outline" size="sm"
          >Register a certificate</Button
        >
      {/if}
    </div>
    <div class="border">
      <Table.Root>
        <Table.Caption class="sr-only"
          >Certificates deployed on this host</Table.Caption
        >
        <Table.Header class="bg-muted">
          <Table.Row>
            <Table.Head scope="col">Status</Table.Head>
            <Table.Head scope="col">Endpoint</Table.Head>
            <Table.Head scope="col">Certificate</Table.Head>
            <Table.Head scope="col">Web service</Table.Head>
            <Table.Head scope="col">Method</Table.Head>
            <Table.Head scope="col">Listener readiness</Table.Head>
            <Table.Head scope="col">Verification</Table.Head>
            <Table.Head scope="col">Served certificate expiry</Table.Head>
            <Table.Head scope="col" class="text-right">Actions</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each host.deployments as deployment (deployment.id)}
            {@const job = data.agentDeployments.statuses[deployment.id]}
            <Table.Row>
              <Table.Cell>
                <div role="status">
                  {#if job}
                    <DeploymentStatusBadge
                      status={job.status}
                      detail={job.detail}
                    />
                  {:else}
                    <span class="text-muted-foreground">—</span>
                  {/if}
                </div>
              </Table.Cell>
              <Table.Head scope="row">{deployment.endpoint}</Table.Head>
              <Table.Cell>
                <a
                  href={resolve("/certificates/[id]", {
                    id: deployment.certificateId,
                  })}
                  class="text-primary underline underline-offset-4"
                  >{deployment.domain}</a
                >
              </Table.Cell>
              <Table.Cell>{deployment.engine ?? "Not specified"}</Table.Cell>
              <Table.Cell>{deployment.method}</Table.Cell>
              <Table.Cell>
                {#if deployment.method !== "Ansible" && deployment.listenerStatus}
                  {#if deployment.listenerStatus === "ready"}
                    <Tooltip.Root>
                      <Tooltip.Trigger
                        class="inline-flex cursor-help focus-visible:outline-2 focus-visible:outline-ring"
                        aria-label="TLS ready. Show check time"
                      >
                        <Badge variant="secondary">
                          {listenerLabels.ready}
                          <Info data-icon="inline-end" aria-hidden="true" />
                        </Badge>
                      </Tooltip.Trigger>
                      <Tooltip.Content
                        sideOffset={4}
                        class="max-w-sm flex-col items-start gap-2 whitespace-normal text-left"
                      >
                        <div class="grid min-w-0 gap-2">
                          {#if deployment.listenerCheckedAt}
                            <time
                              class="block text-background/80"
                              datetime={deployment.listenerCheckedAt.iso}
                              >Checked {deployment.listenerCheckedAt
                                .label}</time
                            >
                          {:else}
                            <p>Check time unavailable.</p>
                          {/if}
                          {#if deployment.listenerFingerprint}
                            <div class="grid min-w-0 gap-0.5">
                              <span class="text-background/70"
                                >Served certificate</span
                              >
                              <code
                                class="block break-all font-mono text-[0.65rem] leading-relaxed"
                                >{formatFingerprint(
                                  deployment.listenerFingerprint,
                                )}</code
                              >
                            </div>
                          {/if}
                          {#if deployment.expectedFingerprint}
                            <div class="grid min-w-0 gap-0.5">
                              <span class="text-background/70"
                                >Expected certificate</span
                              >
                              <code
                                class="block break-all font-mono text-[0.65rem] leading-relaxed"
                                >{formatFingerprint(
                                  deployment.expectedFingerprint,
                                )}</code
                              >
                            </div>
                          {/if}
                        </div>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  {:else}
                    <Badge
                      variant={deployment.listenerStatus === "drifted"
                        ? "destructive"
                        : "outline"}
                      >{listenerLabels[deployment.listenerStatus]}</Badge
                    >
                    {#if deployment.listenerAddress}
                      <p class="text-muted-foreground">
                        {deployment.listenerAddress}
                      </p>
                    {/if}
                    {#if deployment.listenerCheckedAt}
                      <time
                        class="text-muted-foreground"
                        datetime={deployment.listenerCheckedAt.iso}
                        >{deployment.listenerCheckedAt.label}</time
                      >
                    {/if}
                    {#if deployment.listenerStatus === "drifted"}
                      {#if deployment.listenerFingerprint}
                        <p
                          class="mt-1 max-w-64 break-all text-muted-foreground"
                        >
                          Served: <code
                            >{formatFingerprint(
                              deployment.listenerFingerprint,
                            )}</code
                          >
                        </p>
                      {/if}
                      {#if deployment.expectedFingerprint}
                        <p class="max-w-64 break-all text-muted-foreground">
                          Expected: <code
                            >{formatFingerprint(
                              deployment.expectedFingerprint,
                            )}</code
                          >
                        </p>
                      {/if}
                    {/if}
                  {/if}
                {:else}
                  <span class="text-muted-foreground"
                    >{deployment.method === "Agent" && deployment.engine
                      ? "Not reported"
                      : "—"}</span
                  >
                {/if}
              </Table.Cell>
              <Table.Cell><Badge variant={deployment.status === 'Failed' ? 'destructive' : deployment.status === 'Verified' ? 'secondary' : 'outline'}>{deployment.status}</Badge></Table.Cell>
              <Table.Cell>
                <ServedCertificateExpiry
                  expiry={deployment.servedCertificateExpiresAt}
                  observedAt={deployment.servedCertificateObservedAt}
                />
              </Table.Cell>
              <Table.Cell class="text-right">
                <EditDeploymentEndpointDialog
                  deploymentId={deployment.id}
                  endpoint={deployment.endpoint}
                  engine={deployment.engine}
                  method={deployment.method}
                  message={form?.deploymentId === deployment.id
                    ? form?.endpointError
                    : undefined}
                  removeMessage={form?.deploymentId === deployment.id
                    ? form.removeDeploymentError
                    : undefined}
                />
              </Table.Cell>
            </Table.Row>
          {:else}
            <Table.Row
              ><Table.Cell
                colspan={9}
                class="py-8 text-center text-muted-foreground"
                >No certificate deployments recorded for this host.</Table.Cell
              ></Table.Row
            >
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  </section>
</section>

{#snippet timestamp(
  value: { iso: string; label: string } | null,
  fallback: string,
)}
  {#if value}
    <time datetime={value.iso}>{value.label}</time>
  {:else}
    {fallback}
  {/if}
{/snippet}
