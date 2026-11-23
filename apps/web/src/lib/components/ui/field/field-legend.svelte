<script lang="ts">
  import { cn, type WithElementRef } from "#lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    variant = "legend",
    children,
    required = false,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLLegendElement>> & {
    variant?: "legend" | "label";
    required?: boolean;
  } = $props();
</script>

<legend
  bind:this={ref}
  data-slot="field-legend"
  data-variant={variant}
  class={cn(
    "mb-2.5 font-medium data-[variant=label]:text-xs data-[variant=legend]:text-sm",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
  {#if required}<span aria-hidden="true" class="ms-0.5 text-destructive">*</span
    >{/if}
</legend>
