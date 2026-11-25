<script lang="ts">
  import { setMode, userPrefersMode } from 'mode-watcher';
  import { Monitor, Moon, Sun } from '@lucide/svelte';
  import { Button } from '#lib/components/ui/button/index.ts';

  const labels = { system: 'System', light: 'Light', dark: 'Dark' };
  const icons = { system: Monitor, light: Sun, dark: Moon };
  const nextModes = { system: 'light', light: 'dark', dark: 'system' } as const;
  const current = $derived(userPrefersMode.current);
  const next = $derived(nextModes[current]);
  const Icon = $derived(icons[current]);
</script>

<Button
  variant="outline"
  size="icon-sm"
  onclick={() => setMode(next)}
  aria-label={`Color theme: ${labels[current]}. Switch to ${labels[next]}.`}
  title={`${labels[current]} theme. Switch to ${labels[next]}.`}
>
  <Icon aria-hidden="true" />
</Button>
