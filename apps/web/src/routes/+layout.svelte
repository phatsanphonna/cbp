<script lang="ts">
  import { invalidate } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { Bell } from "@lucide/svelte";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
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
    "/docs/alert": "Alert guide",
    "/docs/controller": "Controller setup",
    "/docs/agent": "Agent setup",
  };
  const pageTitle = $derived(
    page.route.id ? pageTitles[page.route.id] : undefined,
  );

  let { children, data } = $props();

  const alertLabel = $derived(
    data.openAlertCount === null
      ? "View open alerts"
      : `${data.openAlertCount} open ${data.openAlertCount === 1 ? "alert" : "alerts"}`,
  );

  $effect(() => {
    if (!data.user) return;
    const timer = setInterval(
      () => void invalidate("cbp:open-alert-count"),
      60_000,
    );
    return () => clearInterval(timer);
  });
</script>

<svelte:head>
  {@html themeMarkup}
</svelte:head>

<ModeWatcher />
<Toaster position="top-center" closeButton richColors />

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
          <Button
            variant="outline"
            size="icon-sm"
            class="relative"
            href={resolve("/alerts") + "?status=open"}
            aria-label={alertLabel}
            title={alertLabel}
          >
            <Bell aria-hidden="true" />
            {#if data.openAlertCount !== null}
              <Badge
                variant={data.openAlertCount > 0 ? "warning" : "secondary"}
                class="pointer-events-none absolute -end-1 -top-2 h-4 min-w-4 px-1"
                aria-hidden="true"
              >
                {data.openAlertCount > 99 ? "99+" : data.openAlertCount}
              </Badge>
            {/if}
          </Button>
          <ThemeToggle />
        </div>
      </header>
      {@render children()}
    </Sidebar.Inset>
  </Sidebar.Provider>
{/if}
