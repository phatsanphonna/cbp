<script lang="ts">
  import { mode, toggleMode } from "mode-watcher";
  import { Moon, Sun } from "@lucide/svelte";
  import { Button } from "#lib/components/ui/button/index.ts";

  const isDark = $derived(mode.current === "dark");
  const Icon = $derived(isDark ? Moon : Sun);
  const label = $derived(`Switch to ${isDark ? "light" : "dark"} theme`);
</script>

<Button
  variant="outline"
  size="icon-sm"
  onclick={toggleMode}
  aria-label={label}
  title={label}
>
  <Icon aria-hidden="true" />
</Button>
