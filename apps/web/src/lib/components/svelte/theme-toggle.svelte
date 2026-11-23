<script lang="ts">
  import { setMode, userPrefersMode } from "mode-watcher";
  import * as Select from "#lib/components/ui/select/index.ts";

  const labels = { system: "System", light: "Light", dark: "Dark" };

  function selectTheme(value: string) {
    if (value !== "system" && value !== "light" && value !== "dark") return;
    setMode(value);
  }
</script>

<Select.Root
  type="single"
  value={userPrefersMode.current}
  onValueChange={selectTheme}
>
  <Select.Trigger size="sm" aria-label="Color theme">
    {labels[userPrefersMode.current]}
  </Select.Trigger>
  <Select.Content align="end">
    <Select.Group>
      {#each Object.entries(labels) as [value, label] (value)}
        <Select.Item {value} {label} />
      {/each}
    </Select.Group>
  </Select.Content>
</Select.Root>
