<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { Badge } from '#lib/components/ui/badge/index.ts';

  const labels = {
    checking: 'Checking controller',
    online: 'Controller online',
    offline: 'Controller offline',
    'not-configured': 'Controller not configured',
    unavailable: 'Controller status unavailable'
  };
  let status = $state<keyof typeof labels>('checking');

  onMount(() => {
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      try {
        const response = await fetch(resolve('/api/controller-status'), {
          cache: 'no-store',
          signal: AbortSignal.any([stop.signal, AbortSignal.timeout(6_000)])
        });
        if (!response.ok) throw new Error('Status request failed');
        const { status: reported } = await response.json();
        status = reported === 'online' || reported === 'offline' || reported === 'not-configured'
          ? reported
          : 'unavailable';
      } catch {
        if (!stop.signal.aborted) status = 'unavailable';
      }
      if (!stop.signal.aborted) timer = setTimeout(refresh, 10_000);
    }

    refresh();
    return () => {
      stop.abort();
      clearTimeout(timer);
    };
  });
</script>

<Badge role="status" variant={status === 'offline' ? 'destructive' : status === 'online' ? 'secondary' : 'outline'}>
  <span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
  {labels[status]}
</Badge>
