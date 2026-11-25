<script lang="ts">
  import { Badge } from "#lib/components/ui/badge/index.ts";

  let { severity }: { severity: "Info" | "Warning" | "High" | "Critical" } =
    $props();

  const variants = {
    Info: "outline",
    Warning: "warning",
    High: "destructive",
    Critical: "critical",
  } as const;
</script>

<Badge variant={variants[severity]}>{severity}</Badge>
