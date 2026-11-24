<script lang="ts">
  import { Info } from "@lucide/svelte";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Spinner } from "#lib/components/ui/spinner/index.ts";
  import * as Tooltip from "#lib/components/ui/tooltip/index.ts";

  let {
    status,
    detail,
    showTooltip = true,
  }: {
    status: "Queued" | "Running" | "Expired" | "Failed" | "Deployed";
    detail: string | null;
    showTooltip?: boolean;
  } = $props();

  const explanation = $derived.by(() => {
    switch (status) {
      case "Queued":
        return "Waiting for the controller to claim this job for the agent.";
      case "Running":
        return "Claimed through the controller. Waiting for the agent’s result.";
      case "Expired":
        return detail ?? "The deployment job expired.";
      case "Failed":
        return detail || null;
      case "Deployed":
        return "The deployment completed successfully.";
    }
  });
</script>

{#snippet badge()}
  <Badge
    variant={status === "Failed" || status === "Expired"
      ? "destructive"
      : status === "Deployed"
        ? "secondary"
        : "outline"}
  >
    {#if status === "Queued" || status === "Running"}
      <Spinner data-icon="inline-start" aria-hidden="true" />
    {/if}
    {status}
    {#if explanation && showTooltip}
      <Info data-icon="inline-end" aria-hidden="true" />
    {/if}
  </Badge>
{/snippet}

{#if explanation && showTooltip}
  <Tooltip.Root>
    <Tooltip.Trigger
      class="inline-flex cursor-help focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={status === "Failed"
        ? "Failed. Show failure details"
        : undefined}
    >
      {@render badge()}
    </Tooltip.Trigger>
    <Tooltip.Content
      role="tooltip"
      sideOffset={4}
      class="max-w-sm wrap-anywhere">{explanation}</Tooltip.Content
    >
  </Tooltip.Root>
{:else}
  {@render badge()}
{/if}
