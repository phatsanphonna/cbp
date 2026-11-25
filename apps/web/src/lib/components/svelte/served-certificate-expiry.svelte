<script lang="ts">
  type Timestamp = { iso: string; label: string };

  let {
    expiry,
    observedAt,
  }: { expiry: Timestamp | null; observedAt: Timestamp | null } = $props();
</script>

{#if expiry}
  <time
    datetime={expiry.iso}
    class:text-destructive={Date.parse(expiry.iso) <= Date.now()}
    >{expiry.label}</time
  >
  {#if observedAt}
    <p class="text-muted-foreground">
      Checked <time datetime={observedAt.iso}>{observedAt.label}</time>
    </p>
  {/if}
{:else}
  <span class="text-muted-foreground">Not observed</span>
{/if}
