<script lang="ts">
  import {
    Bell,
    BookOpen,
    FileBadge,
    History,
    KeyRound,
    LayoutDashboard,
    LogIn,
    LogOut,
    Network,
    RefreshCw,
    Send,
    Server,
    ShieldCheck,
    Terminal,
    Users,
  } from "@lucide/svelte";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import * as Avatar from "#lib/components/ui/avatar/index.ts";
  import * as Sidebar from "#lib/components/ui/sidebar/index.ts";

  const sidebar = Sidebar.useSidebar();
  const user = $derived(page.data.user);
  const initials = $derived(
    user?.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase(),
  );
  const overview = resolve("/");
  const navigation = [
    {
      id: "workspace",
      label: "Workspace",
      items: [
        { label: "Overview", route: "/", icon: LayoutDashboard },
        { label: "Certificates", route: "/certificates", icon: FileBadge },
        { label: "Hosts", route: "/hosts", icon: Server },
        { label: "Deployments", route: "/deployments", icon: Send },
        { label: "Renewals", icon: RefreshCw },
      ],
    },
    {
      id: "monitoring",
      label: "Monitoring",
      items: [
        { label: "Alerts", route: "/alerts", icon: Bell },
        { label: "Audit log", route: "/audit", icon: History },
      ],
    },
    {
      id: "administration",
      label: "Administration",
      adminOnly: true,
      items: [{ label: "Users", route: "/users", icon: Users }],
    },
    {
      id: "docs",
      label: "Docs",
      items: [
        { label: "Alert", route: "/docs/alert", icon: BookOpen },
        { label: "Controller", route: "/docs/controller", icon: Network },
        { label: "Agent", route: "/docs/agent", icon: Terminal },
      ],
    },
  ] as const;
  type NavigationLink = Extract<
    (typeof navigation)[number]["items"][number],
    { route: string }
  >;
</script>

{#snippet navigationLink(item: NavigationLink)}
  {@const current = page.route.id === item.route}
  {@const active =
    current || page.route.id?.startsWith(`${item.route}/`) === true}
  <Sidebar.MenuItem>
    <Sidebar.MenuButton isActive={active} tooltipContent={item.label}>
      {#snippet child({ props })}
        <a
          {...props}
          href={resolve(item.route)}
          aria-current={current ? "page" : undefined}
          onclick={() => sidebar.setOpenMobile(false)}
        >
          <item.icon aria-hidden="true" />
          <span
            class="transition-opacity duration-300 ease-in-out group-data-[collapsible=icon]:opacity-0"
          >
            {item.label}
          </span>
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </Sidebar.MenuItem>
{/snippet}

<Sidebar.Root collapsible="icon">
  <Sidebar.Header
    class="h-14 justify-center border-b border-sidebar-border px-4 group-data-[collapsible=icon]:px-0"
  >
    <a
      href={overview}
      class="inline-flex items-center gap-2.5 text-sm font-semibold transition-[gap] duration-300 ease-in-out group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
      onclick={() => sidebar.setOpenMobile(false)}
    >
      <ShieldCheck size={18} class="text-sidebar-primary" aria-hidden="true" />
      <span
        class="max-w-40 overflow-hidden whitespace-nowrap opacity-100 transition-[max-width,opacity] duration-300 ease-in-out group-data-[collapsible=icon]:max-w-0 group-data-[collapsible=icon]:opacity-0"
        >Certified by Pat</span
      >
    </a>
  </Sidebar.Header>

  <Sidebar.Content>
    <nav aria-label="Main navigation">
      {#each navigation as group (group.id)}
        {#if !("adminOnly" in group) || user?.isAdmin}
          <Sidebar.Group
            role="group"
            aria-labelledby={`sidebar-${group.id}-label`}
          >
            <Sidebar.GroupLabel id={`sidebar-${group.id}-label`}
              >{group.label}</Sidebar.GroupLabel
            >
            <Sidebar.GroupContent>
              <Sidebar.Menu>
                {#each group.items as item (item.label)}
                  {#if "route" in item}
                    {@render navigationLink(item)}
                  {:else}
                    <Sidebar.MenuItem>
                      <Sidebar.MenuButton
                        aria-disabled="true"
                        tabindex={-1}
                        tooltipContent={item.label}
                      >
                        <item.icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </Sidebar.MenuButton>
                    </Sidebar.MenuItem>
                  {/if}
                {/each}
              </Sidebar.Menu>
            </Sidebar.GroupContent>
          </Sidebar.Group>
        {/if}
      {/each}
    </nav>
  </Sidebar.Content>
  <Sidebar.Footer class="border-t border-sidebar-border">
    {#if user}
      <div
        class="flex min-w-0 items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0"
      >
        <Avatar.Root aria-hidden="true">
          {#if user.image}<Avatar.Image src={user.image} alt="" />{/if}
          <Avatar.Fallback>{initials}</Avatar.Fallback>
        </Avatar.Root>
        <div class="min-w-0 group-data-[collapsible=icon]:hidden">
          <p class="truncate text-xs font-medium">{user.name}</p>
          <p class="truncate text-xs text-muted-foreground">
            {user.username ? `@${user.username}` : user.email}
          </p>
        </div>
      </div>
    {/if}
    <Sidebar.Menu>
      {#if user}
        <Sidebar.MenuItem>
          <Sidebar.MenuButton
            isActive={page.route.id === "/account/password"}
            tooltipContent="Change password"
          >
            {#snippet child({ props })}
              <a
                {...props}
                href={resolve("/account/password")}
                onclick={() => sidebar.setOpenMobile(false)}
              >
                <KeyRound aria-hidden="true" />
                <span
                  class="transition-opacity duration-300 ease-in-out group-data-[collapsible=icon]:opacity-0"
                  >Change password</span
                >
              </a>
            {/snippet}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      {/if}
      <Sidebar.MenuItem>
        {#if user}
          <form method="POST" action={resolve("/signout")}>
            <Sidebar.MenuButton tooltipContent="Sign out">
              {#snippet child({ props })}
                <button {...props} type="submit">
                  <LogOut aria-hidden="true" />
                  <span
                    class="transition-opacity duration-300 ease-in-out group-data-[collapsible=icon]:opacity-0"
                    >Sign out</span
                  >
                </button>
              {/snippet}
            </Sidebar.MenuButton>
          </form>
        {:else}
          <Sidebar.MenuButton tooltipContent="Sign in">
            {#snippet child({ props })}
              <a {...props} href={resolve("/signin")}>
                <LogIn aria-hidden="true" />
                <span
                  class="transition-opacity duration-300 ease-in-out group-data-[collapsible=icon]:opacity-0"
                  >Sign in</span
                >
              </a>
            {/snippet}
          </Sidebar.MenuButton>
        {/if}
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>
</Sidebar.Root>
