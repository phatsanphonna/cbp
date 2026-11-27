<script lang="ts">
  import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
  import { Button } from '#lib/components/ui/button/index.js';
  import { cn } from '#lib/utils.js';
  import { useSidebar } from './context.svelte.js';
  import type { ComponentProps } from 'svelte';

  let {
    ref = $bindable(null),
    class: className,
    onclick,
    ...restProps
  }: ComponentProps<typeof Button> & {
    onclick?: (event: MouseEvent) => void;
  } = $props();

  const sidebar = useSidebar();
</script>

<Button
  bind:ref
  data-sidebar="trigger"
  data-slot="sidebar-trigger"
  variant="ghost"
  size="icon-sm"
  class={cn(className)}
  type="button"
  onclick={(event) => {
    onclick?.(event);
    sidebar.toggle();
  }}
  {...restProps}
>
  <PanelLeftIcon class="cn-rtl-flip" />
  <span class="sr-only">Toggle Sidebar</span>
</Button>
