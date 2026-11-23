<script lang="ts">
  import Moon from '@lucide/svelte/icons/moon';
  import Sun from '@lucide/svelte/icons/sun';
  import { onMount } from 'svelte';
  import { Button } from '#lib/components/ui/button/index.ts';

  let dark = $state(false);

  onMount(() => {
    dark = document.documentElement.classList.contains('dark');
  });

  function toggleTheme() {
    dark = document.documentElement.classList.toggle('dark');
    try {
      localStorage.setItem('cbp-theme', dark ? 'dark' : 'light');
    } catch {
      // The current page still reflects the selected theme.
    }
  }
</script>

<Button type="button" variant="ghost" size="icon" aria-label="Dark mode" aria-pressed={dark} onclick={toggleTheme}>
  <Moon class="dark:hidden" aria-hidden="true" />
  <Sun class="hidden dark:block" aria-hidden="true" />
</Button>
