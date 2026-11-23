<script lang="ts">
  import { onMount } from "svelte";
  import * as Select from "#lib/components/ui/select/index.ts";

  type Theme = "system" | "light" | "dark";
  const labels = { system: "System", light: "Light", dark: "Dark" };
  let theme = $state<Theme>("system");
  let systemTheme: MediaQueryList;

  function applyTheme() {
    document.documentElement.classList.toggle(
      "dark",
      theme === "dark" || (theme === "system" && systemTheme.matches),
    );
  }

  onMount(() => {
    systemTheme = matchMedia("(prefers-color-scheme: dark)");
    try {
      const saved = localStorage.getItem("cbp-theme");
      if (saved === "light" || saved === "dark") theme = saved;
    } catch {
      // Use the system preference when storage is unavailable.
    }
    applyTheme();
    systemTheme.addEventListener("change", applyTheme);
    return () => systemTheme.removeEventListener("change", applyTheme);
  });

  function selectTheme(value: string) {
    if (value !== "system" && value !== "light" && value !== "dark") return;
    theme = value;
    applyTheme();
    try {
      localStorage.setItem("cbp-theme", theme);
    } catch {
      // The current page still reflects the selected theme.
    }
  }
</script>

<Select.Root type="single" value={theme} onValueChange={selectTheme}>
  <Select.Trigger size="sm" aria-label="Color theme"
    >{labels[theme]}</Select.Trigger
  >
  <Select.Content align="end">
    <Select.Group>
      {#each Object.entries(labels) as [value, label] (value)}
        <Select.Item {value} {label} />
      {/each}
    </Select.Group>
  </Select.Content>
</Select.Root>
