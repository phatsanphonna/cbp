<script lang="ts">
  import { Bell, BookOpen, FileBadge, History, LayoutDashboard, LogIn, LogOut, RefreshCw, Server, ShieldCheck, Users } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import * as Avatar from '#lib/components/ui/avatar/index.ts';
  import * as Sidebar from '#lib/components/ui/sidebar/index.ts';

  const sidebar = Sidebar.useSidebar();
  const user = $derived(page.data.user);
  const initials = $derived(user?.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase());
  const overview = resolve('/');
  const navigation = [
    { label: 'Overview', route: '/', icon: LayoutDashboard },
    { label: 'Hosts', route: '/hosts', icon: Server },
    { label: 'Certificates', route: '/certificates', icon: FileBadge },
    { label: 'Alerts', route: '/alerts', icon: Bell },
    { label: 'Groups', route: '/groups', icon: Users },
    { label: 'Controller setup', route: '/docs/controller', icon: BookOpen }
  ] as const;
  const planned = [
    { label: 'Renewals', icon: RefreshCw },
    { label: 'Audit log', icon: History }
  ];
</script>

<Sidebar.Root>
  <Sidebar.Header class="h-14 justify-center border-b border-sidebar-border px-4">
    <a href={overview} class="inline-flex items-center gap-2.5 text-sm font-semibold" onclick={() => sidebar.setOpenMobile(false)}>
      <ShieldCheck size={18} class="text-sidebar-primary" aria-hidden="true" />
      Certified by Pat
    </a>
  </Sidebar.Header>

  <Sidebar.Content>
    <nav aria-label="Main navigation">
      <Sidebar.Group>
        <Sidebar.GroupContent>
          <Sidebar.Menu>
            {#each navigation as item (item.route)}
              {@const current = page.route.id === item.route}
              {@const active = current || page.route.id?.startsWith(`${item.route}/`) === true}
              <Sidebar.MenuItem>
                <Sidebar.MenuButton isActive={active}>
                  {#snippet child({ props })}
                    <a {...props} href={resolve(item.route)} aria-current={current ? 'page' : undefined} onclick={() => sidebar.setOpenMobile(false)}>
                      <item.icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </a>
                  {/snippet}
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            {/each}
            {#each planned as item (item.label)}
              <Sidebar.MenuItem>
                <Sidebar.MenuButton aria-disabled="true" tabindex={-1}>
                  <item.icon aria-hidden="true" />
                  <span>{item.label}</span>
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            {/each}
          </Sidebar.Menu>
        </Sidebar.GroupContent>
      </Sidebar.Group>
    </nav>
  </Sidebar.Content>
  <Sidebar.Footer class="border-t border-sidebar-border">
    {#if user}
      <div class="flex min-w-0 items-center gap-2.5 px-2 py-1.5">
        <Avatar.Root aria-hidden="true">
          {#if user.image}<Avatar.Image src={user.image} alt="" />{/if}
          <Avatar.Fallback>{initials}</Avatar.Fallback>
        </Avatar.Root>
        <div class="min-w-0">
          <p class="truncate text-xs font-medium">{user.name}</p>
          <p class="truncate text-xs text-muted-foreground">{user.username ? `@${user.username}` : user.email}</p>
        </div>
      </div>
    {/if}
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        {#if user}
          <form method="POST" action={resolve('/signout')}>
            <Sidebar.MenuButton>
              {#snippet child({ props })}
                <button {...props} type="submit"><LogOut aria-hidden="true" /><span>Sign out</span></button>
              {/snippet}
            </Sidebar.MenuButton>
          </form>
        {:else}
          <Sidebar.MenuButton>
            {#snippet child({ props })}
              <a {...props} href={resolve('/signin')}><LogIn aria-hidden="true" /><span>Sign in</span></a>
            {/snippet}
          </Sidebar.MenuButton>
        {/if}
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>
</Sidebar.Root>
