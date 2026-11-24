<script lang="ts">
  import { page } from "$app/state";
  import AppSidebar from "#lib/components/svelte/app-sidebar.svelte";
  import ControllerStatus from "#lib/components/svelte/controller-status.svelte";
  import ThemeToggle from "#lib/components/svelte/theme-toggle.svelte";
  import * as Sidebar from "#lib/components/ui/sidebar/index.ts";
  import { Toaster } from "#lib/components/ui/sonner/index.ts";
  import { ModeWatcher } from "mode-watcher";
  import theme from "./layout.css?inline";

  const themeMarkup = `<style>${theme}</style>`;
  const pageTitles: Record<string, string> = {
    "/": "Overview",
    "/hosts": "Hosts",
    "/hosts/new": "Add host",
    "/hosts/[id]": "Host details",
    "/certificates": "Certificates",
    "/certificates/[id]": "Certificate details",
    "/certificates/new": "Register certificate",
    "/deployments": "Deployments",
    "/deployments/[id]": "Deployment status",
    "/alerts": "Alerts",
    "/alerts/channels": "Notification channels",
    "/audit": "Audit log",
    "/users": "Users",
    "/users/new": "Create user",
    "/docs/controller": "Controller setup",
    "/docs/agent": "Agent setup",
  };
  const pageTitle = $derived(
    page.route.id ? pageTitles[page.route.id] : undefined,
  );

  let { children } = $props();
</script>

<svelte:head>
  {@html themeMarkup}
</svelte:head>

<ModeWatcher />
<Toaster position="top-center" closeButton />

{#if page.route.id === "/signin"}
  <div class="absolute end-4 top-4 z-10">
    <ThemeToggle />
  </div>
  {@render children()}
{:else}
  <Sidebar.Provider>
    <AppSidebar />
    <Sidebar.Inset class="min-w-0">
      <header
        class="flex h-14 items-center gap-2 border-b px-3 sm:gap-3 sm:px-4"
      >
        <Sidebar.Trigger />
        {#if pageTitle}
          <span class="min-w-0 truncate text-sm font-medium">{pageTitle}</span>
        {/if}
        <div class="ms-auto flex shrink-0 items-center gap-2">
          <ControllerStatus />
          <ThemeToggle />
        </div>
      </header>
      {@render children()}
    </Sidebar.Inset>
  </Sidebar.Provider>
{/if}
