<script lang="ts">
  import { mode } from 'mode-watcher';
  import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';
  import Loader2Icon from '@lucide/svelte/icons/loader-2';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import OctagonXIcon from '@lucide/svelte/icons/octagon-x';
  import InfoIcon from '@lucide/svelte/icons/info';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

  let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
  theme={mode.current}
  class="toaster group"
  toastOptions={{
    classes: {
      toast: 'cn-toast',
    },
  }}
  {...restProps}
>
  {#snippet loadingIcon()}
    <Loader2Icon class="size-4 animate-spin" />
  {/snippet}
  {#snippet successIcon()}
    <CircleCheckIcon class="size-4" />
  {/snippet}
  {#snippet errorIcon()}
    <OctagonXIcon class="size-4" />
  {/snippet}
  {#snippet infoIcon()}
    <InfoIcon class="size-4" />
  {/snippet}
  {#snippet warningIcon()}
    <TriangleAlertIcon class="size-4" />
  {/snippet}
</Sonner>

<style>
  :global(.toaster[data-sonner-toaster][data-sonner-theme]) {
    --border-radius: var(--radius);
    --normal-bg: var(--popover);
    --normal-text: var(--popover-foreground);
    --normal-border: var(--border);
    --toast-close-button-start: unset;
    --toast-close-button-end: 0;
    --toast-close-button-transform: translate(35%, -35%);
    font-family: inherit;
  }

  :global(.toaster [data-sonner-toast][data-styled='true'] [data-close-button]) {
    border-radius: var(--radius);
  }

  :global(
    .toaster
      [data-sonner-toast][data-styled='true']:not([data-rich-colors='true'][data-type])
      [data-close-button]
  ) {
    border-color: var(--border);
    color: var(--popover-foreground);
  }

  :global(
    .toaster
      [data-sonner-toast][data-styled='true']:not([data-rich-colors='true'][data-type]):hover
      [data-close-button]:hover
  ) {
    background: var(--accent);
    border-color: var(--border);
    color: var(--accent-foreground);
  }

  :global(.toaster [data-sonner-toast][data-styled='true'] [data-close-button]:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
</style>
