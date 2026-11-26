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
    Send,
    Server,
    ShieldCheck,
    Terminal,
    UserRound,
    UsersRound,
  } from "@lucide/svelte";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import * as Avatar from "#lib/components/ui/avatar/index.ts";
  import * as Sidebar from "#lib/components/ui/sidebar/index.ts";

  const sidebar = Sidebar.useSidebar();
  const user = $derived(page.data.user);
  const hasPermission = (permission: string) =>
    Boolean(
      user?.isAdmin ||
        user?.permissions.includes("sudo") ||
        user?.permissions.includes(permission),
    );
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
      items: [
        { label: 'Ansible credentials', route: '/ansible-credentials', icon: KeyRound, permission: "credentials.manage" },
        { label: "Users", route: "/users", icon: UserRound, anyPermission: ["users.manage", "groups.manage", "permissions.manage"] },
        { label: "Groups", route: "/groups", icon: UsersRound, anyPermission: ["groups.manage", "permissions.manage"] },
      ],
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
  type NavigationLink = (typeof navigation)[number]['items'][number];
  function canSeeNavigationItem(item: NavigationLink) {
    if ("permission" in item) return hasPermission(item.permission);
    if ("anyPermission" in item)
      return item.anyPermission.some((permission) => hasPermission(permission));
    return true;
  }
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
    class="h-14 justify-center border-b border-sidebar-border px-4 group-data-[collapsible=icon]:px-[15px]"
  >
    <a
      href={overview}
      class="inline-flex w-full items-center gap-2.5 text-sm font-semibold transition-[gap] duration-300 ease-in-out group-data-[collapsible=icon]:gap-0"
      onclick={() => sidebar.setOpenMobile(false)}
    >
      <ShieldCheck size={18} class="shrink-0 text-sidebar-primary" aria-hidden="true" />
      <span
        class="max-w-40 overflow-hidden whitespace-nowrap opacity-100 transition-[max-width,opacity] duration-300 ease-in-out group-data-[collapsible=icon]:max-w-0 group-data-[collapsible=icon]:opacity-0"
        >CBP</span
      >
    </a>
  </Sidebar.Header>

  <Sidebar.Content>
    <nav aria-label="Main navigation">
      {#each navigation as group (group.id)}
        {#if !("adminOnly" in group) || group.items.some(canSeeNavigationItem)}
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
                  {#if canSeeNavigationItem(item)}
                    {@render navigationLink(item)}
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
        class="flex min-w-0 items-center gap-2.5 px-2 py-1.5 transition-[gap,padding] duration-300 ease-in-out group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0"
      >
        <Avatar.Root aria-hidden="true">
          {#if user.image}<Avatar.Image src={user.image} alt="" />{/if}
          <Avatar.Fallback>{initials}</Avatar.Fallback>
        </Avatar.Root>
        <div class="min-w-0 max-w-40 overflow-hidden opacity-100 transition-[max-width,opacity] duration-300 ease-in-out group-data-[collapsible=icon]:max-w-0 group-data-[collapsible=icon]:opacity-0">
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
