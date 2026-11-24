import { invalidate } from "$app/navigation";
import { subscribeToLiveEvents } from "./subscribe-to-live-events.js";

export function nextDeploymentExpiry(
  jobs: { status: string; expiresIn: number }[],
) {
  return Math.min(
    ...jobs
      .filter(({ status }) => status === "Queued" || status === "Running")
      .map(({ expiresIn }) => expiresIn),
  );
}

export function watchDeploymentUpdates(expiry: () => number | null) {
  const enabled = $derived(expiry() !== null);
  let refreshing = false;
  let refreshAgain = false;

  async function refresh() {
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        await invalidate("cbp:agent-deployments");
      } while (refreshAgain && enabled);
    } catch {
      // Reconnecting to the stream refreshes the current state.
    } finally {
      refreshing = false;
    }
  }

  $effect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeToLiveEvents("deployment", refresh);
    void refresh();
    return () => {
      unsubscribe();
      refreshAgain = false;
    };
  });

  $effect(() => {
    const remaining = expiry();
    if (remaining === null || !Number.isFinite(remaining)) return;
    // Keep the expiry visible even if the controller heartbeat stops.
    const timer = setTimeout(refresh, Math.max(0, remaining) + 100);
    return () => clearTimeout(timer);
  });
}
