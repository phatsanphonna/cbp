<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { subscribeToLiveEvents } from "#lib/hooks/subscribe-to-live-events.js";

  const labels = {
    checking: "Checking controller",
    online: "Controller online",
    offline: "Controller offline",
    "not-configured": "Controller not configured",
    unavailable: "Controller status unavailable",
  };
  let status = $state<keyof typeof labels>("checking");

  onMount(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unavailable = () => {
      clearTimeout(timer);
      status = "unavailable";
    };
    const unsubscribe = subscribeToLiveEvents(
      "controller",
      (event) => {
        clearTimeout(timer);
        try {
          const { status: reported, remaining } = JSON.parse(
            (event as MessageEvent<string>).data,
          );
          if (
            reported === "online" &&
            Number.isFinite(remaining) &&
            remaining > 0
          ) {
            status = "online";
            timer = setTimeout(() => {
              status = "offline";
            }, remaining);
          } else {
            status =
              reported === "offline" || reported === "not-configured"
                ? reported
                : "unavailable";
          }
        } catch {
          unavailable();
        }
      },
      unavailable,
    );

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  });
</script>

<Badge
  role="status"
  variant={status === "offline" || status === "unavailable"
    ? "destructive"
    : status === "online"
      ? "secondary"
      : "outline"}
>
  <span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
  {labels[status]}
</Badge>
