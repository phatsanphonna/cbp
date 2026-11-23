import { invalidate } from '$app/navigation';
import { onMount } from 'svelte';

export function refreshHostPing() {
  onMount(() => {
    let refreshing = false;
    const refresh = async () => {
      if (document.hidden || refreshing) return;
      refreshing = true;
      try {
        await invalidate('cbp:host-ping');
      } catch {
        // A later refresh can recover after navigation or a temporary connection failure.
      } finally {
        refreshing = false;
      }
    };

    const timer = setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  });
}
